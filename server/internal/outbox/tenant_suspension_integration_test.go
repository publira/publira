package outbox_test

import (
	"context"
	"encoding/json"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
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

// A sign-up the API accepted just before the tenant was suspended still opens
// its account: the request is not a message, only the verification mail it
// queues is, and that mail is what gets dropped.
func TestWorkerCarriesOutASignUpForASuspendedTenantAndDropsItsMail(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXSUS001", "outbox-suspended.example.com", "Suspended Tenant")
	queries := dbmodels.New(pg.DB)
	hash, err := auth.HashPassword("newcomer-password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	userID := uuid.Must(uuid.NewV7())
	signup := insertSuspensionPayload(t, ctx, queries, tenant.ID, outbox.EventTypeReaderSignupRequest, "suspended:signup", outbox.ReaderSignupRequestPayload{
		TenantID:     tenant.ID.String(),
		UserID:       userID.String(),
		Email:        "newcomer@outbox-suspended.example.com",
		Name:         "Newcomer",
		PasswordHash: hash,
	})
	pg.SetTenantStatus(t, tenant.ID, tenantstatus.Suspended)

	var sent atomic.Int32
	handlers := outbox.NewRegistry()
	handlers.Register(outbox.EventTypeReaderSignupRequest, outbox.NewReaderSignupRequestHandler(outbox.EmailHandlerConfig{DB: pg.OpenOutboxDB(t)}))
	handlers.RegisterMessage(outbox.EventTypeReaderEmailVerificationEmail, func(context.Context, dbmodels.OutboxEvent) error {
		sent.Add(1)
		return nil
	})

	startTestWorker(t, pg.DB, outbox.Config{Handlers: handlers})
	waitStatus(t, ctx, queries, signup.ID, outbox.StatusDone)

	var mailID uuid.UUID
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT event.id FROM outbox_events event
		JOIN user_email_verification_tokens token ON token.id = (event.payload ->> 'token_id')::uuid
		WHERE event.event_type = $1 AND token.user_id = $2
	`, outbox.EventTypeReaderEmailVerificationEmail, userID).Scan(&mailID); err != nil {
		t.Fatalf("read the verification mail the sign-up queued: %v", err)
	}
	waitStatus(t, ctx, queries, mailID, outbox.StatusDone)
	if got := sent.Load(); got != 0 {
		t.Fatalf("verification mails sent = %d, want 0", got)
	}
}

func insertSuspensionEvent(t *testing.T, ctx context.Context, queries *dbmodels.Queries, tenantID uuid.UUID, eventType, key string) dbmodels.OutboxEvent {
	t.Helper()
	return insertSuspensionPayload(t, ctx, queries, tenantID, eventType, key, map[string]string{"tenant_id": tenantID.String()})
}

func insertSuspensionPayload(t *testing.T, ctx context.Context, queries *dbmodels.Queries, tenantID uuid.UUID, eventType, key string, payload any) dbmodels.OutboxEvent {
	t.Helper()
	body, err := json.Marshal(payload)
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
