package tickerjobs_test

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
	"github.com/publira/publira/server/internal/tickerjobs"
)

// The jobs run inside the worker, on the ticker role's own connection, while
// River's own tables belong to the worker's. Both halves are here: the work has
// to happen, and it has to happen through a row in river_job rather than a
// ticker of its own.

func TestWorkerPublishesADueEpisodeAsAPeriodicJob(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TICKJOBS0001", "tickerjobs.example.com", "Ticker Jobs Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "TICKJOBSSER1", Title: "Ticker Jobs Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "TICKJOBSEP01",
		Title:       "Ticker Jobs Episode",
		Status:      testutil.EpisodeStatusScheduled,
		ScheduledAt: time.Now().Add(-time.Minute),
	})

	startWorkerWithTickerJobs(t, pg)

	waitFor(t, ctx, "the scheduled episode to be published", func() bool {
		var status string
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT status FROM episode_listings WHERE episode_id = $1", episode.ID,
		).Scan(&status); err != nil {
			t.Fatalf("read listing status: %v", err)
		}
		return status == "published"
	})

	assertJobRan(t, ctx, pg, "ticker.publish_episodes")
}

func TestWorkerAppliesAPassedFreeWindowAsAPeriodicJob(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TICKJOBS0002", "windows.tickerjobs.example.com", "Ticker Windows Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "TICKJOBSSER2", Title: "Ticker Windows Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "TICKJOBSEP02",
		Title:    "Ticker Windows Episode",
		Price:    500,
		Status:   testutil.EpisodeStatusPublished,
	})
	windowID := pg.SeedEpisodeFreeWindow(t, tenant.ID, episode.ID, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))

	startWorkerWithTickerJobs(t, pg)

	waitFor(t, ctx, "the passed free window boundary to be recorded", func() bool {
		var startApplied sql.NullTime
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT start_revalidated_at FROM episode_free_windows WHERE id = $1", windowID,
		).Scan(&startApplied); err != nil {
			t.Fatalf("read free window: %v", err)
		}
		return startApplied.Valid
	})

	assertJobRan(t, ctx, pg, "ticker.apply_free_windows")
}

func TestWorkerEnqueuesEveryTickerJob(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	startWorkerWithTickerJobs(t, pg)

	for _, kind := range []string{"ticker.publish_episodes", "ticker.apply_free_windows", "ticker.roll_tenant_day"} {
		assertJobRan(t, ctx, pg, kind)
	}
}

// startWorkerWithTickerJobs boots the worker the way outbox-worker does: River
// on the superuser pool that owns its schema, and the jobs on the ticker role's
// own connection.
func startWorkerWithTickerJobs(t *testing.T, pg *testutil.PostgresEnv) {
	t.Helper()

	jobs, err := tickerjobs.New(tickerjobs.Config{
		DB:                 pg.OpenTickerDB(t),
		Logger:             slog.New(slog.NewTextHandler(io.Discard, nil)),
		PublishInterval:    100 * time.Millisecond,
		FreeWindowInterval: 100 * time.Millisecond,
		TenantDayInterval:  100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("build ticker jobs: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	worker, err := outbox.Start(ctx, pg.DB, outbox.Config{
		Logger:            slog.New(slog.NewTextHandler(io.Discard, nil)),
		Periodic:          jobs,
		DrainInterval:     50 * time.Millisecond,
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

// assertJobRan is the half of the move an operator cares about: the run is a
// river_job row they can query, not a line in one process's log.
func assertJobRan(t *testing.T, ctx context.Context, pg *testutil.PostgresEnv, kind string) {
	t.Helper()
	waitFor(t, ctx, "a "+kind+" row in river_job", func() bool {
		var rows int
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT count(*) FROM river_job WHERE kind = $1", kind,
		).Scan(&rows); err != nil {
			t.Fatalf("count %s jobs: %v", kind, err)
		}
		return rows > 0
	})
}

func waitFor(t *testing.T, ctx context.Context, what string, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if done() {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("waiting for %s: %v", what, ctx.Err())
		case <-time.After(50 * time.Millisecond):
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}
