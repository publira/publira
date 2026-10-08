package outbox_test

import (
	"context"
	"encoding/json"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/tenantstatus"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	suspensionMessageEvent = "suspension_test_message"
	suspensionUpkeepEvent  = "suspension_test_upkeep"
)

// A message to a suspended tenant's readers or staff is marked done without
// being sent, while the tenant's other events still run and another tenant's
// messages still go out. Once the tenant is resumed its messages are sent
// again; the ones dropped while it was suspended stay dropped.
func TestWorkerDropsMessagesToASuspendedTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	suspended := pg.SeedTenant(t, "OUTBOXSUS001", "outbox-suspended.example.com", "Suspended Tenant")
	active := pg.SeedTenant(t, "OUTBOXACT001", "outbox-active.example.com", "Active Tenant")
	pg.SetTenantStatus(t, suspended.ID, tenantstatus.Suspended)
	queries := dbmodels.New(pg.DB)

	var mu sync.Mutex
	var ran []string
	record := func(_ context.Context, event dbmodels.OutboxEvent) error {
		mu.Lock()
		defer mu.Unlock()
		ran = append(ran, event.IdempotencyKey)
		return nil
	}
	handlers := outbox.NewRegistry()
	handlers.RegisterMessage(suspensionMessageEvent, record)
	handlers.Register(suspensionUpkeepEvent, record)

	dropped := insertSuspensionEvent(t, ctx, queries, suspended.ID, suspensionMessageEvent, "suspended:message")
	upkeep := insertSuspensionEvent(t, ctx, queries, suspended.ID, suspensionUpkeepEvent, "suspended:upkeep")
	other := insertSuspensionEvent(t, ctx, queries, active.ID, suspensionMessageEvent, "active:message")

	startTestWorker(t, pg.DB, outbox.Config{Handlers: handlers})
	for _, event := range []dbmodels.OutboxEvent{dropped, upkeep, other} {
		waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)
	}

	pg.SetTenantStatus(t, suspended.ID, tenantstatus.Active)
	resumed := insertSuspensionEvent(t, ctx, queries, suspended.ID, suspensionMessageEvent, "resumed:message")
	waitStatus(t, ctx, queries, resumed.ID, outbox.StatusDone)

	mu.Lock()
	defer mu.Unlock()
	slices.Sort(ran)
	if want := []string{"active:message", "resumed:message", "suspended:upkeep"}; !slices.Equal(ran, want) {
		t.Fatalf("handlers ran for %v, want %v", ran, want)
	}
}

func insertSuspensionEvent(t *testing.T, ctx context.Context, queries *dbmodels.Queries, tenantID uuid.UUID, eventType, key string) dbmodels.OutboxEvent {
	t.Helper()
	body, err := json.Marshal(map[string]string{"tenant_id": tenantID.String()})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      eventType,
		Payload:        body,
		IdempotencyKey: key,
		AvailableAt:    time.Now().UTC().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent %s: %v", key, err)
	}
	return event
}
