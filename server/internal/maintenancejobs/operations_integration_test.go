package maintenancejobs_test

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/testutil"
)

var everyKind = []string{
	"maintenance.project_episode_reads",
	"maintenance.aggregate_content_stats",
	"maintenance.aggregate_rankings",
	"maintenance.build_recommend_features",
	"maintenance.purge_content_events",
	"maintenance.purge_ranking_snapshots",
	"maintenance.purge_mfa_challenges",
	"maintenance.purge_withdrawn_comments",
	"maintenance.purge_orphan_images",
	"maintenance.close_royalty_statements",
}

// Two workers against one database are what a deployment with more than one
// replica runs, and each of them schedules every job. No run of a kind may
// start while another run of the same kind is still going, or two passes
// would rebuild or drain the same rows at once.
func TestTwoWorkersNeverRunOneKindConcurrently(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "MAINTREPLICA", "maintenancereplica.example.com", "Maintenance Replica Tenant")
	if _, err := pg.DB.ExecContext(ctx, "UPDATE tenants SET timezone = 'UTC' WHERE id = $1", tenant.ID); err != nil {
		t.Fatalf("set tenant time zone: %v", err)
	}

	started := time.Now()
	startWorkerWithMaintenanceJobs(t, pg, notConfigured{})
	startWorkerWithMaintenanceJobs(t, pg, notConfigured{})

	waitFor(t, ctx, "every kind to finish a run and nothing left in flight", func() bool {
		for _, kind := range everyKind {
			if countFinalized(t, ctx, pg, kind) == 0 {
				return false
			}
		}
		var inFlight int
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT count(*) FROM river_job WHERE queue = 'maintenance' AND finalized_at IS NULL",
		).Scan(&inFlight); err != nil {
			t.Fatalf("count in-flight maintenance jobs: %v", err)
		}
		return inFlight == 0
	})
	ended := time.Now()

	for _, kind := range everyKind {
		rows, err := pg.DB.QueryContext(ctx, `
			SELECT attempted_at, finalized_at FROM river_job
			WHERE kind = $1 AND attempted_at IS NOT NULL
			ORDER BY attempted_at
		`, kind)
		if err != nil {
			t.Fatalf("list %s runs: %v", kind, err)
		}
		var previousEnd time.Time
		for rows.Next() {
			var start, end time.Time
			if err := rows.Scan(&start, &end); err != nil {
				t.Fatalf("scan %s run: %v", kind, err)
			}
			if start.Before(previousEnd) {
				t.Fatalf("a %s run started at %s, before the previous one ended at %s", kind, start, previousEnd)
			}
			previousEnd = end
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("list %s runs: %v", kind, err)
		}
		_ = rows.Close()
	}

	for kind, interval := range purgeKinds {
		want := int(ended.Truncate(interval).Sub(started.Truncate(interval))/interval) + 1
		if got := countJobs(t, ctx, pg.DB, kind, ""); got > want {
			t.Fatalf("%s rows = %d, want at most %d from two workers inside one interval", kind, got, want)
		}
	}
}

// A pass that fails is kept as its river_job row, with the error naming the
// tenant it failed on, and is retried rather than dropped. The tenants it did
// not fail on carry on down the chain in the meantime.
func TestAFailedPassStaysInRiverJobWithItsError(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	broken := pg.SeedTenant(t, "MAINTBROKEN1", "maintenancebroken.example.com", "Maintenance Broken Tenant")
	healthy := pg.SeedTenant(t, "MAINTHEALTH1", "maintenancehealthy.example.com", "Maintenance Healthy Tenant")
	// A zone no time zone database knows: the tenant's day cannot be resolved,
	// so every pass that needs it fails for this tenant alone.
	if _, err := pg.DB.ExecContext(ctx, "UPDATE tenants SET timezone = 'Nowhere/Invalid' WHERE id = $1", broken.ID); err != nil {
		t.Fatalf("break tenant time zone: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, "UPDATE tenants SET timezone = 'UTC' WHERE id = $1", healthy.ID); err != nil {
		t.Fatalf("set tenant time zone: %v", err)
	}

	startWorkerWithMaintenanceJobs(t, pg, notConfigured{})

	kind := "maintenance.project_episode_reads"
	waitFor(t, ctx, "a failed "+kind+" row that is kept for retry", func() bool {
		return countJobs(t, ctx, pg.DB, kind, "retryable") > 0
	})
	var named bool
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM river_job, unnest(errors) AS failure
			WHERE kind = $1 AND state = 'retryable' AND strpos(failure->>'error', $2) > 0
		)
	`, kind, broken.ID.String()).Scan(&named); err != nil {
		t.Fatalf("read the failed row's errors: %v", err)
	}
	if !named {
		t.Fatalf("no retryable %s row records an error naming tenant %s", kind, broken.ID)
	}

	waitFor(t, ctx, "the healthy tenant's chain to reach its yesterday", func() bool {
		var reached bool
		if err := pg.DB.QueryRowContext(ctx, `
			SELECT recommend_features_through = (episode_reads_projected_at AT TIME ZONE 'UTC')::date - 1
			FROM daily_rebuild_progress WHERE tenant_id = $1
		`, healthy.ID).Scan(&reached); err != nil {
			return false
		}
		return reached
	})
}

// notConfigured is a platform that has saved no object store, which cancels
// the orphan image sweep and leaves every other job alone.
type notConfigured struct{}

func (notConfigured) Reclaimer(context.Context) (storage.Reclaimer, string, error) {
	return nil, "", storage.ErrNotConfigured
}

// countFinalized counts the runs of kind River has finished with, whether they
// completed, were cancelled, or were discarded.
func countFinalized(t *testing.T, ctx context.Context, pg *testutil.PostgresEnv, kind string) int {
	t.Helper()
	var rows int
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT count(*) FROM river_job WHERE kind = $1 AND finalized_at IS NOT NULL", kind,
	).Scan(&rows); err != nil {
		t.Fatalf("count finalized %s jobs: %v", kind, err)
	}
	return rows
}
