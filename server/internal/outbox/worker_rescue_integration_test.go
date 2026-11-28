package outbox_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverdatabasesql"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

// A worker killed while a drain ran leaves that drain's river_job row running,
// and every later drain is skipped as its duplicate. The next worker's rescuer
// retries the row once it has been running for a minute, so the outbox is
// claimed again then rather than after River's default hour.
func TestWorkerResumesDrainingAfterAKilledWorkerLeftADrainRunning(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	leaveJobRunning(t, ctx, pg.DB, outbox.DrainArgs{})
	event := insertTestEvent(t, ctx, queries, tenant.ID, "test:rescued-drain", outbox.TestPayload{})

	startTestWorker(t, pg.DB, outbox.Config{})
	waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)
}

// A worker killed while a process job ran leaves the event processing and the
// job running. The stale reclaim returns the event to pending, but each drain
// that claims it finds the running job and hands it back, until the rescuer
// retries that job a minute after it started. The retried job may find the
// event still processing and handle it itself, or find it pending and leave it
// to the next drain; either way it is done.
func TestWorkerProcessesAnEventAgainAfterAKilledWorkerLeftItsJobRunning(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	event := insertTestEvent(t, ctx, queries, tenant.ID, "test:rescued-process", outbox.TestPayload{})
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE outbox_events
		SET status = 'processing', updated_at = NOW() - interval '2 minutes'
		WHERE id = $1
	`, event.ID); err != nil {
		t.Fatalf("stick processing: %v", err)
	}
	leaveJobRunning(t, ctx, pg.DB, outbox.ProcessArgs{EventID: event.ID})

	startTestWorker(t, pg.DB, outbox.Config{StaleProcessing: 50 * time.Millisecond})
	waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)
}

// A handler still running when Stop's deadline nears has its context
// cancelled, so its attempt is recorded and its river_job row is finished
// rather than left running for the rescuer.
func TestWorkerStoppedAtItsDeadlineLeavesNoJobRunning(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	event := insertUnknownTypeEvent(t, ctx, queries, tenant.ID, "test:stopped")

	started := make(chan struct{})
	handlers := outbox.NewRegistry()
	handlers.Register(unknownEventType, func(ctx context.Context, _ dbmodels.OutboxEvent) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	})
	w := startTestWorker(t, pg.DB, outbox.Config{Handlers: handlers, JobTimeout: time.Minute})
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("handler never started")
	}

	stopCtx, stopCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer stopCancel()
	if err := w.Stop(stopCtx); err != nil {
		t.Fatalf("stop: %v", err)
	}

	var running int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM river_job WHERE state = 'running'").Scan(&running); err != nil {
		t.Fatalf("count running jobs: %v", err)
	}
	if running != 0 {
		t.Fatalf("running river_job rows = %d, want 0", running)
	}
	got, err := queries.GetOutboxEvent(ctx, event.ID)
	if err != nil {
		t.Fatalf("GetOutboxEvent: %v", err)
	}
	if got.Status != outbox.StatusPending || got.Attempts != 1 {
		t.Fatalf("event status = %q attempts = %d, want pending with the cut-off attempt charged", got.Status, got.Attempts)
	}
}

// leaveJobRunning inserts args as River would and marks the row as a worker
// killed two minutes into it would leave it: running, with no outcome.
func leaveJobRunning(t *testing.T, ctx context.Context, db *sql.DB, args river.JobArgs) {
	t.Helper()
	if err := outbox.Migrate(ctx, db); err != nil {
		t.Fatalf("migrate river: %v", err)
	}
	client, err := river.NewClient(riverdatabasesql.New(db), &river.Config{})
	if err != nil {
		t.Fatalf("river insert client: %v", err)
	}
	res, err := client.Insert(ctx, args, nil)
	if err != nil {
		t.Fatalf("insert %s: %v", args.Kind(), err)
	}
	if _, err := db.ExecContext(ctx, `
		UPDATE river_job
		SET state = 'running', attempt = 1,
			attempted_at = NOW() - interval '2 minutes',
			attempted_by = ARRAY['killed-worker']
		WHERE id = $1
	`, res.Job.ID); err != nil {
		t.Fatalf("leave %s running: %v", args.Kind(), err)
	}
}
