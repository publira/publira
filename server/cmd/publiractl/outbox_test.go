package main

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/tenantwebhooks"
	"github.com/publira/publira/server/internal/testutil"
)

// outboxCommand runs one outbox command against the database
// PUBLIRA_PLATFORM_DB_URL names, and answers its exit status, stdout, and
// stderr.
func outboxCommand(args ...string) (int, string, string) {
	var stdout, stderr bytes.Buffer
	code := runGroup(&outboxGroup, args, pipedConsole("", &stderr), &stdout)
	return code, stdout.String(), stderr.String()
}

// insertOutboxEvent writes an outbox event of eventType in status, as the
// worker leaves one after attempts attempts, and answers its ID. A nil tenant
// writes a platform event.
func insertOutboxEvent(t *testing.T, pg *testutil.PostgresEnv, tenantID *uuid.UUID, eventType, status string, attempts int) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	payload := map[string]string{}
	var tenant uuid.NullUUID
	if tenantID != nil {
		payload["tenant_id"] = tenantID.String()
		tenant = uuid.NullUUID{UUID: *tenantID, Valid: true}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	if _, err := pg.DB.ExecContext(context.Background(), `
		INSERT INTO outbox_events (id, tenant_id, event_type, payload, idempotency_key, status, attempts, available_at, last_error)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '1 day', 'dial tcp: connection refused')
	`, id, tenant, eventType, body, eventType+":"+id.String(), status, attempts); err != nil {
		t.Fatalf("insert outbox event: %v", err)
	}
	return id
}

type outboxEventState struct {
	status      string
	attempts    int
	availableAt time.Time
}

func readOutboxEvent(t *testing.T, pg *testutil.PostgresEnv, id uuid.UUID) outboxEventState {
	t.Helper()
	var state outboxEventState
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT status, attempts, available_at FROM outbox_events WHERE id = $1`, id).
		Scan(&state.status, &state.attempts, &state.availableAt); err != nil {
		t.Fatalf("read outbox event %s: %v", id, err)
	}
	return state
}

// An operator lists what the worker gave up on, and requeues it once whatever
// killed it is fixed: each event is due at once, on a whole retry budget. The
// events whose payload lost what they would send, and the webhook deliveries
// a Tenant admin resends from the console, stay dead.
func TestOutboxListAndRequeue(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	tenantA := pg.SeedTenant(t, "OUTBOXAAAAAA", "outbox-a.example.com", "Outbox A").ID
	tenantB := pg.SeedTenant(t, "OUTBOXBBBBBB", "outbox-b.example.com", "Outbox B").ID

	reply := insertOutboxEvent(t, pg, &tenantA, outbox.EventTypeContactMessageReplyEmail, outbox.StatusDead, outbox.DefaultMaxAttempts)
	receipt := insertOutboxEvent(t, pg, &tenantB, outbox.EventTypePurchaseReceipt, outbox.StatusDead, outbox.DefaultMaxAttempts)
	revalidation := insertOutboxEvent(t, pg, nil, outbox.EventTypeNextCacheRevalidation, outbox.StatusDead, outbox.DefaultMaxAttempts)
	passwordReset := insertOutboxEvent(t, pg, &tenantA, outbox.EventTypeReaderPasswordResetEmail, outbox.StatusDead, outbox.DefaultMaxAttempts)
	webhook := insertOutboxEvent(t, pg, &tenantA, tenantwebhooks.OutboxEventType, outbox.StatusDead, tenantwebhooks.MaxAttempts)
	pending := insertOutboxEvent(t, pg, &tenantA, outbox.EventTypePurchaseReceipt, outbox.StatusPending, 3)

	code, listed, stderr := outboxCommand("list")
	if code != 0 {
		t.Fatalf("list: exit code = %d\n%s", code, stderr)
	}
	for _, id := range []uuid.UUID{reply, receipt, revalidation, passwordReset, webhook} {
		if !strings.Contains(listed, id.String()) {
			t.Errorf("list = %q, want the dead event %s", listed, id)
		}
	}
	if strings.Contains(listed, pending.String()) {
		t.Errorf("list = %q, want no pending event", listed)
	}
	if !strings.Contains(listed, "OUTBOXAAAAAA") || !strings.Contains(listed, "dial tcp: connection refused") {
		t.Errorf("list = %q, want each event's tenant and last error", listed)
	}
	if code, listed, _ := outboxCommand("list", "--tenant", "outbox-b.example.com"); code != 0 || !strings.Contains(listed, receipt.String()) || strings.Contains(listed, reply.String()) {
		t.Errorf("list --tenant: exit code = %d, output = %q, want tenant B's event alone", code, listed)
	}

	// Leaving every flag out is not a way to requeue every dead event.
	if code, _, stderr := outboxCommand("requeue"); code != 1 || !strings.Contains(stderr, "--all") {
		t.Fatalf("requeue with no flag: exit code = %d, stderr = %q, want 1 naming --all", code, stderr)
	}
	if got := readOutboxEvent(t, pg, reply); got.status != outbox.StatusDead {
		t.Fatalf("after a refused requeue, the event is %s, want dead", got.status)
	}

	before := time.Now()
	if code, out, stderr := outboxCommand("requeue", "--event", reply.String()); code != 0 || !strings.Contains(out, "Requeued 1 dead event\n") {
		t.Fatalf("requeue --event: exit code = %d, output = %q\n%s", code, out, stderr)
	}
	got := readOutboxEvent(t, pg, reply)
	if got.status != outbox.StatusPending || got.attempts != 0 {
		t.Fatalf("requeued event = %+v, want pending with no attempts spent", got)
	}
	if got.availableAt.After(time.Now()) || got.availableAt.Before(before.Add(-time.Minute)) {
		t.Fatalf("requeued event is due at %s, want now", got.availableAt)
	}

	for _, tc := range []struct {
		id   uuid.UUID
		want string
	}{
		{id: passwordReset, want: "nothing left to send"},
		{id: webhook, want: "resends the delivery from the console"},
		{id: pending, want: "it is pending"},
		{id: uuid.Must(uuid.NewV7()), want: "no outbox event has that ID"},
	} {
		if code, _, stderr := outboxCommand("requeue", "--event", tc.id.String()); code != 1 || !strings.Contains(stderr, tc.want) {
			t.Errorf("requeue --event %s: exit code = %d, stderr = %q, want 1 saying %q", tc.id, code, stderr, tc.want)
		}
	}

	if code, out, stderr := outboxCommand("requeue", "--all"); code != 0 || !strings.Contains(out, "Requeued 2 dead events\n") {
		t.Fatalf("requeue --all: exit code = %d, output = %q\n%s", code, out, stderr)
	}
	for id, want := range map[uuid.UUID]string{
		receipt:       outbox.StatusPending,
		revalidation:  outbox.StatusPending,
		passwordReset: outbox.StatusDead,
		webhook:       outbox.StatusDead,
	} {
		if got := readOutboxEvent(t, pg, id); got.status != want {
			t.Errorf("after requeue --all, event %s is %s, want %s", id, got.status, want)
		}
	}
	if got := readOutboxEvent(t, pg, pending); got.attempts != 3 {
		t.Errorf("a pending event has %d attempts after requeue --all, want its 3 kept", got.attempts)
	}
}
