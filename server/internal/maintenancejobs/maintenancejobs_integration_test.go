package maintenancejobs_test

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/maintenancejobs"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

// The worker starts the chain on its own and every link enqueues the next, so
// a worker that comes back after days away rebuilds each of them as far as
// the recommend features without anything else enqueueing a job.
func TestWorkerCatchesUpTheDaysItMissed(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "MAINTJOBS001", "maintenancejobs.example.com", "Maintenance Jobs Tenant")
	if _, err := pg.DB.ExecContext(ctx, "UPDATE tenants SET timezone = 'UTC' WHERE id = $1", tenant.ID); err != nil {
		t.Fatalf("set tenant time zone: %v", err)
	}
	now := time.Now().UTC()
	stoppedOn := time.Date(now.Year(), now.Month(), now.Day()-4, 0, 0, 0, 0, time.UTC)
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO daily_rebuild_progress (
			tenant_id, episode_reads_projected_at, content_stats_through, rankings_through, recommend_features_through
		) VALUES ($1, $2, $3, $3, $3)
	`, tenant.ID, stoppedOn.Add(time.Hour), stoppedOn); err != nil {
		t.Fatalf("seed daily rebuild progress: %v", err)
	}

	startWorkerWithMaintenanceJobs(t, pg)

	// Yesterday is taken from the instant the worker's projection recorded, so
	// a midnight during the test moves the expectation with it.
	var yesterday time.Time
	waitFor(t, ctx, "the chain to reach yesterday", func() bool {
		var projectedAt, through time.Time
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT episode_reads_projected_at, recommend_features_through FROM daily_rebuild_progress WHERE tenant_id = $1", tenant.ID,
		).Scan(&projectedAt, &through); err != nil {
			t.Fatalf("read daily rebuild progress: %v", err)
		}
		projectedAt = projectedAt.UTC()
		yesterday = time.Date(projectedAt.Year(), projectedAt.Month(), projectedAt.Day()-1, 0, 0, 0, 0, time.UTC)
		return through.Format(time.DateOnly) == yesterday.Format(time.DateOnly)
	})
	missedDays := int(yesterday.Sub(stoppedOn).Hours() / 24)

	var rankedDays int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(DISTINCT period_end) FROM content_ranking_snapshots
		WHERE tenant_id = $1 AND ranking_key = 'daily' AND period_end > $2
	`, tenant.ID, stoppedOn).Scan(&rankedDays); err != nil {
		t.Fatalf("count ranked days: %v", err)
	}
	if rankedDays != missedDays {
		t.Fatalf("ranked %d missed days, want %d", rankedDays, missedDays)
	}

	for _, kind := range []string{
		"maintenance.project_episode_reads",
		"maintenance.aggregate_content_stats",
		"maintenance.aggregate_rankings",
		"maintenance.build_recommend_features",
	} {
		waitFor(t, ctx, "a completed "+kind+" row in river_job", func() bool {
			var rows int
			if err := pg.DB.QueryRowContext(ctx,
				"SELECT count(*) FROM river_job WHERE kind = $1 AND state = 'completed'", kind,
			).Scan(&rows); err != nil {
				t.Fatalf("count %s jobs: %v", kind, err)
			}
			return rows > 0
		})
	}
}

// startWorkerWithMaintenanceJobs boots the worker the way cmd/worker does:
// River on the superuser pool that owns its schema, and the jobs on the
// maintenance role's own connection.
func startWorkerWithMaintenanceJobs(t *testing.T, pg *testutil.PostgresEnv) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	jobs, err := maintenancejobs.New(maintenancejobs.Config{DB: pg.OpenContentStatsDB(t), Logger: logger})
	if err != nil {
		t.Fatalf("build maintenance jobs: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	worker, err := outbox.Start(ctx, pg.DB, outbox.Config{
		Logger:            logger,
		Periodic:          []outbox.PeriodicRegistrar{jobs},
		DrainInterval:     time.Hour,
		FetchCooldown:     10 * time.Millisecond,
		FetchPollInterval: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("start worker: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer stopCancel()
		if err := worker.Stop(stopCtx); err != nil {
			t.Errorf("stop worker: %v", err)
		}
	})
}

func waitFor(t *testing.T, ctx context.Context, what string, done func() bool) {
	t.Helper()
	for {
		if done() {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("waiting for %s: %v", what, ctx.Err())
		case <-time.After(50 * time.Millisecond):
		}
	}
}
