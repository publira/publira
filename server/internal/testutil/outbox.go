package testutil

import (
	"context"
	"testing"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// ProcessPendingOutboxEvents does what the worker does with the pending events
// of the types handlers names: each one runs through its handler, oldest first,
// and is then marked done. A form that only records a request for the worker
// has led to nothing yet, so a case that asserts what it leads to calls this
// first.
func (e *PostgresEnv) ProcessPendingOutboxEvents(t *testing.T, handlers map[string]func(context.Context, dbmodels.OutboxEvent) error) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	eventTypes := make([]string, 0, len(handlers))
	for eventType := range handlers {
		eventTypes = append(eventTypes, eventType)
	}

	rows, err := e.DB.QueryContext(ctx, `
		SELECT id, tenant_id, event_type, payload FROM outbox_events
		WHERE status = 'pending' AND event_type = ANY($1)
		ORDER BY id
	`, eventTypes)
	if err != nil {
		t.Fatalf("read pending outbox events: %v", err)
	}
	var events []dbmodels.OutboxEvent
	for rows.Next() {
		var event dbmodels.OutboxEvent
		if err := rows.Scan(&event.ID, &event.TenantID, &event.EventType, &event.Payload); err != nil {
			t.Fatalf("scan pending outbox event: %v", err)
		}
		events = append(events, event)
	}
	if err := rows.Close(); err != nil {
		t.Fatalf("read pending outbox events: %v", err)
	}

	for _, event := range events {
		if err := handlers[event.EventType](ctx, event); err != nil {
			t.Fatalf("process %s %s: %v", event.EventType, event.ID, err)
		}
		if _, err := e.DB.ExecContext(ctx, `UPDATE outbox_events SET status = 'done' WHERE id = $1`, event.ID); err != nil {
			t.Fatalf("mark %s done: %v", event.ID, err)
		}
	}
}
