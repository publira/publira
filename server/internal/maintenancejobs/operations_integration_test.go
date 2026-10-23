package maintenancejobs_test

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverdatabasesql"

	"github.com/publira/publira/server/internal/maintenancejobs"
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

// Each replica's River client runs one maintenance pass at a time, and two
// replicas are two clients, so the turn is taken install-wide as well. While
// one replica's orphan image sweep is held in the middle of its pass, the
// royalty close the other replica picks up waits for it rather than running
// beside it, and waiting is not a failure: once the sweep ends, every pass
// completes with no error recorded against it.
func TestTwoWorkersRunOneMaintenancePassAtATime(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	source := newHeldSource()
	startWorkerWithMaintenanceJobs(t, pg, source)
	startWorkerWithMaintenanceJobs(t, pg, source)

	select {
	case <-source.entered:
	case <-ctx.Done():
		t.Fatalf("waiting for the orphan image sweep to start: %v", ctx.Err())
	}
	var sweepStarted time.Time
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT attempted_at FROM river_job WHERE kind = 'maintenance.purge_orphan_images' AND state = 'running'",
	).Scan(&sweepStarted); err != nil {
		t.Fatalf("read the running sweep: %v", err)
	}

	inserter, err := river.NewClient(riverdatabasesql.New(pg.DB), &river.Config{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("build an insert-only client: %v", err)
	}
	inserted, err := inserter.Insert(ctx, maintenancejobs.CloseRoyaltyStatementsArgs{}, nil)
	if err != nil {
		t.Fatalf("enqueue a royalty close: %v", err)
	}
	closeID := inserted.Job.ID

	waitFor(t, ctx, "the royalty close to be turned away or to finish while the sweep runs", func() bool {
		var snoozes int
		var finalized bool
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT coalesce((metadata->>'snoozes')::int, 0), finalized_at IS NOT NULL FROM river_job WHERE id = $1", closeID,
		).Scan(&snoozes, &finalized); err != nil {
			t.Fatalf("read the royalty close: %v", err)
		}
		return snoozes >= 2 || finalized
	})
	var ranBeside int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(*) FROM river_job
		WHERE queue = 'maintenance' AND kind <> 'maintenance.purge_orphan_images'
			AND state = 'completed' AND attempted_at > $1
	`, sweepStarted).Scan(&ranBeside); err != nil {
		t.Fatalf("count passes that ran beside the sweep: %v", err)
	}
	if ranBeside != 0 {
		t.Fatalf("%d maintenance passes started and completed while the orphan image sweep was running, want none", ranBeside)
	}

	close(source.release)
	waitFor(t, ctx, "every maintenance pass to finish", func() bool {
		var inFlight int
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT count(*) FROM river_job WHERE queue = 'maintenance' AND finalized_at IS NULL",
		).Scan(&inFlight); err != nil {
			t.Fatalf("count in-flight maintenance jobs: %v", err)
		}
		return inFlight == 0
	})

	// The Google Play sync is left out: these workers are given no Google Play
	// client, so it fails on its own whoever holds the turn.
	rows, err := pg.DB.QueryContext(ctx, `
		SELECT kind, state::text FROM river_job
		WHERE queue = 'maintenance' AND kind <> 'maintenance.sync_google_play_voided_purchases'
			AND (state <> 'completed' OR cardinality(errors) > 0)
	`)
	if err != nil {
		t.Fatalf("list maintenance passes that did not complete cleanly: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	for rows.Next() {
		var kind, state string
		if err := rows.Scan(&kind, &state); err != nil {
			t.Fatalf("scan maintenance pass: %v", err)
		}
		t.Errorf("%s ended %s or recorded an error, want every pass completed with none", kind, state)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list maintenance passes that did not complete cleanly: %v", err)
	}
	if countJobs(t, ctx, pg.DB, "maintenance.close_royalty_statements", "completed") == 0 {
		t.Fatal("the royalty close never completed")
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

// heldSource holds the orphan image sweep that resolves it until release is
// closed, and then hands it a bucket with nothing in it. entered is closed once
// a sweep is waiting.
type heldSource struct {
	entered chan struct{}
	release chan struct{}
	once    *sync.Once
}

func newHeldSource() heldSource {
	return heldSource{entered: make(chan struct{}), release: make(chan struct{}), once: &sync.Once{}}
}

func (s heldSource) Reclaimer(ctx context.Context) (storage.Reclaimer, string, error) {
	s.once.Do(func() { close(s.entered) })
	select {
	case <-s.release:
		return emptyBucket{}, "held", nil
	case <-ctx.Done():
		return nil, "", ctx.Err()
	}
}

type emptyBucket struct{}

func (emptyBucket) List(context.Context, storage.ListRequest) (storage.ListResult, error) {
	return storage.ListResult{}, nil
}

func (emptyBucket) Delete(context.Context, []string) error { return nil }
