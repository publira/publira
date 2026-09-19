package outbox_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

func TestWorkerProcessesTestEvent(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	event := insertTestEvent(t, ctx, queries, tenant.ID, "test:success", outbox.TestPayload{})

	w := startTestWorker(t, pg.DB, outbox.Config{})
	got := waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)
	if got.Attempts != 0 {
		t.Fatalf("attempts = %d, want 0", got.Attempts)
	}
	waitMetric(t, ctx, "done", &w.Metrics().Done, 1)
	waitMetric(t, ctx, "claimed", &w.Metrics().Claimed, 1)
}

func TestWorkerRetriesThenSucceeds(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	event := insertTestEvent(t, ctx, queries, tenant.ID, "test:retry-ok", outbox.TestPayload{FailUntilAttempt: 2})

	w := startTestWorker(t, pg.DB, outbox.Config{})
	got := waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)
	if got.Attempts != 2 {
		t.Fatalf("attempts = %d, want 2", got.Attempts)
	}
	waitMetric(t, ctx, "retry", &w.Metrics().Retry, 2)
}

func TestWorkerMarksDeadAfterMaxAttempts(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	event := insertTestEvent(t, ctx, queries, tenant.ID, "test:dead", outbox.TestPayload{Fail: true})

	w := startTestWorker(t, pg.DB, outbox.Config{MaxAttempts: 3})
	got := waitStatus(t, ctx, queries, event.ID, outbox.StatusDead)
	if got.Attempts != 3 {
		t.Fatalf("attempts = %d, want 3", got.Attempts)
	}
	if !got.LastError.Valid || got.LastError.String == "" {
		t.Fatal("dead event missing last_error")
	}
	waitMetric(t, ctx, "dead", &w.Metrics().Dead, 1)
}

func TestWorkerUnknownEventTypeGoesDead(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenant.ID, Valid: true},
		EventType:      "not_a_real_event",
		Payload:        json.RawMessage(`{"tenant_id":"` + tenant.ID.String() + `"}`),
		IdempotencyKey: "test:unknown",
		AvailableAt:    time.Now().UTC().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent: %v", err)
	}

	startTestWorker(t, pg.DB, outbox.Config{})
	got := waitStatus(t, ctx, queries, event.ID, outbox.StatusDead)
	if got.Attempts != 1 {
		t.Fatalf("attempts = %d, want 1 (permanent, no retries)", got.Attempts)
	}
}

func TestWorkerPicksUpPendingAfterRestart(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)

	first := insertTestEvent(t, ctx, queries, tenant.ID, "test:restart-1", outbox.TestPayload{})
	w := startTestWorker(t, pg.DB, outbox.Config{})
	waitStatus(t, ctx, queries, first.ID, outbox.StatusDone)

	stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer stopCancel()
	if err := w.Stop(stopCtx); err != nil {
		t.Fatalf("stop: %v", err)
	}

	second := insertTestEvent(t, ctx, queries, tenant.ID, "test:restart-2", outbox.TestPayload{})
	startTestWorker(t, pg.DB, outbox.Config{})
	waitStatus(t, ctx, queries, second.ID, outbox.StatusDone)
}

func TestWorkerRecoversStaleProcessing(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	event := insertTestEvent(t, ctx, queries, tenant.ID, "test:stale", outbox.TestPayload{})

	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE outbox_events
		SET status = 'processing', updated_at = NOW() - interval '1 minute'
		WHERE id = $1
	`, event.ID); err != nil {
		t.Fatalf("stick processing: %v", err)
	}

	startTestWorker(t, pg.DB, outbox.Config{StaleProcessing: 50 * time.Millisecond})
	got := waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)
	// An event whose payload holds no secret pays nothing for someone else's
	// crash: the reclaim leaves its retry budget alone.
	if got.Attempts != 0 {
		t.Fatalf("attempts = %d, want 0", got.Attempts)
	}
}

func TestWorkerKeepsNonAuthTokenWhenDone(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	const rawToken = "keep-done-token"
	event := insertRawTestEvent(t, ctx, queries, tenant.ID, "test:keep-done", map[string]any{
		"tenant_id": tenant.ID.String(),
		"token":     rawToken,
	})

	startTestWorker(t, pg.DB, outbox.Config{})
	got := waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)
	assertPayloadKeepsToken(t, got.Payload, rawToken, tenant.ID.String())
}

func TestWorkerKeepsNonAuthTokenWhenDead(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	const rawToken = "keep-dead-token"
	event := insertRawTestEvent(t, ctx, queries, tenant.ID, "test:keep-dead", map[string]any{
		"tenant_id": tenant.ID.String(),
		"token":     rawToken,
		"fail":      true,
	})

	startTestWorker(t, pg.DB, outbox.Config{MaxAttempts: 1})
	got := waitStatus(t, ctx, queries, event.ID, outbox.StatusDead)
	assertPayloadKeepsToken(t, got.Payload, rawToken, tenant.ID.String())
}

func TestWorkerProcessesPlatformEvent(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queries := dbmodels.New(pg.DB)
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		EventType:      outbox.EventTypeTest,
		Payload:        json.RawMessage(`{}`),
		IdempotencyKey: "test:platform",
		AvailableAt:    time.Now().UTC().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent: %v", err)
	}

	startTestWorker(t, pg.DB, outbox.Config{})
	waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)
}

func insertRawTestEvent(
	t *testing.T,
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	key string,
	payload map[string]any,
) dbmodels.OutboxEvent {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeTest,
		Payload:        body,
		IdempotencyKey: key,
		AvailableAt:    time.Now().UTC().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent %s: %v", key, err)
	}
	return event
}

func assertPayloadKeepsToken(t *testing.T, payload json.RawMessage, rawToken, tenantID string) {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatalf("decode payload %s: %v", payload, err)
	}
	if body["token"] != rawToken {
		t.Fatalf("payload token = %v, want %s", body["token"], rawToken)
	}
	if body["tenant_id"] != tenantID {
		t.Fatalf("payload tenant_id = %v, want %s", body["tenant_id"], tenantID)
	}
}

func insertTestEvent(
	t *testing.T,
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	key string,
	payload outbox.TestPayload,
) dbmodels.OutboxEvent {
	t.Helper()
	if payload.TenantID == "" {
		payload.TenantID = tenantID.String()
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeTest,
		Payload:        body,
		IdempotencyKey: key,
		AvailableAt:    time.Now().UTC().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent %s: %v", key, err)
	}
	return event
}

func startTestWorker(t *testing.T, db *sql.DB, cfg outbox.Config) *outbox.Worker {
	t.Helper()
	cfg.DrainInterval = 50 * time.Millisecond
	cfg.FetchCooldown = 10 * time.Millisecond
	cfg.FetchPollInterval = 20 * time.Millisecond
	if cfg.RetryDelay == nil {
		cfg.RetryDelay = func(int) time.Duration { return time.Millisecond }
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	w, err := outbox.Start(ctx, db, cfg)
	if err != nil {
		t.Fatalf("start worker: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer stopCancel()
		if err := w.Stop(stopCtx); err != nil {
			t.Errorf("stop worker: %v", err)
		}
	})
	return w
}

func waitStatus(
	t *testing.T,
	ctx context.Context,
	queries *dbmodels.Queries,
	id uuid.UUID,
	want string,
) dbmodels.OutboxEvent {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	var last dbmodels.OutboxEvent
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			t.Fatalf("wait %s: %v (last status %q)", want, err, last.Status)
		}
		got, err := queries.GetOutboxEvent(ctx, id)
		if err == nil {
			last = got
			if got.Status == want {
				return got
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("event %s status = %q, want %q (attempts=%d last_error=%q)", id, last.Status, want, last.Attempts, last.LastError.String)
	return last
}

// waitMetric polls a worker counter the way waitStatus polls a row: the worker
// commits a status before it records the metric, so a test that has seen the
// row can still be ahead of the counter.
func waitMetric(t *testing.T, ctx context.Context, name string, counter *atomic.Int64, atLeast int64) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			t.Fatalf("wait %s metric: %v (last value %d)", name, err, counter.Load())
		}
		if counter.Load() >= atLeast {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("%s metric = %d, want at least %d", name, counter.Load(), atLeast)
}

// A worker that dies between claiming an auth-mail event and finishing it
// leaves the raw token in payload with no failure recorded. The reclaim is
// what ends that: it charges the retry budget, and the reclaim that exhausts
// it marks the row dead and drops the token.
func TestWorkerStaleReclaimBoundsAuthMailToken(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXWK001", "outbox-worker.example.com", "Outbox Worker Tenant")
	queries := dbmodels.New(pg.DB)
	const rawToken = "raw-stale-auth-token"
	body, err := json.Marshal(map[string]any{
		"tenant_id":     tenant.ID.String(),
		"invitation_id": uuid.Must(uuid.NewV7()).String(),
		"token":         rawToken,
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenant.ID, Valid: true},
		EventType:      "tenant_admin_invitation_email",
		Payload:        body,
		IdempotencyKey: "test:stale-auth",
		AvailableAt:    time.Now().UTC().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent: %v", err)
	}

	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE outbox_events
		SET status = 'processing', updated_at = NOW() - interval '1 minute'
		WHERE id = $1
	`, event.ID); err != nil {
		t.Fatalf("stick processing: %v", err)
	}

	// One attempt of budget, so the first reclaim is the one that exhausts it.
	w := startTestWorker(t, pg.DB, outbox.Config{MaxAttempts: 1, StaleProcessing: 50 * time.Millisecond})
	got := waitStatus(t, ctx, queries, event.ID, outbox.StatusDead)
	if got.Attempts != 1 {
		t.Fatalf("attempts = %d, want 1", got.Attempts)
	}
	// The event never reached a handler, so only the reclaim can have killed
	// it; an unknown-event-type death would say so instead.
	if !strings.Contains(got.LastError.String, "reclaimed from processing") {
		t.Fatalf("last_error = %q, want the stale reclaim reason", got.LastError.String)
	}
	if strings.Contains(string(got.Payload), rawToken) {
		t.Fatalf("payload still contains the raw token: %s", got.Payload)
	}
	waitMetric(t, ctx, "dead", &w.Metrics().Dead, 1)
}
