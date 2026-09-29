package outbox_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

// The admin and platform consoles' password reset forms record a request and
// answer; these handlers look the address up and issue the link. Like the
// reader handlers they run as publira_outbox, so the writes are checked against
// the grants the worker really has.

func adminResetEvent(t *testing.T, tenantID uuid.UUID, email string) dbmodels.OutboxEvent {
	t.Helper()

	return newReaderOutboxEvent(t, tenantID, outbox.EventTypeAdminPasswordResetRequest, outbox.AdminPasswordResetRequestPayload{
		TenantID: tenantID.String(),
		Email:    email,
	}, "test:admin-password-reset-request")
}

func platformResetEvent(t *testing.T, email string) dbmodels.OutboxEvent {
	t.Helper()

	body, err := json.Marshal(outbox.PlatformPasswordResetRequestPayload{Email: email})
	if err != nil {
		t.Fatalf("marshal platform password reset request payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		EventType:      outbox.EventTypePlatformPasswordResetRequest,
		Payload:        body,
		IdempotencyKey: "test:platform-password-reset-request",
		Status:         outbox.StatusPending,
		AvailableAt:    time.Now(),
	}
}

func TestAdminPasswordResetRequestIssuesALinkOnlyForARegisteredAddress(t *testing.T) {
	env := newReaderRequestEnv(t)
	admin := env.pg.SeedTenantAdmin(t, env.tenant.ID, "ADMINREQU001", "admin@reader-request.example.com", "Admin")
	handler := outbox.NewAdminPasswordResetRequestHandler(env.cfg)

	env.process(t, handler, adminResetEvent(t, env.tenant.ID, "stranger@reader-request.example.com"))
	if rows := env.count(t, `SELECT count(*) FROM outbox_events`); rows != 0 {
		t.Fatalf("queued events for an unknown address = %d, want none", rows)
	}

	registered := adminResetEvent(t, env.tenant.ID, admin.Email)
	env.process(t, handler, registered)
	// A retry of the committed request finds its mail queued and stops there.
	env.process(t, handler, registered)

	if tokens := env.count(t, `
		SELECT count(*) FROM user_password_reset_tokens WHERE user_id = $1 AND id = $2
	`, admin.ID, registered.ID); tokens != 1 {
		t.Fatalf("reset tokens named after the request = %d, want 1", tokens)
	}
	if mails := env.count(t, `
		SELECT count(*) FROM outbox_events
		WHERE event_type = 'admin_password_reset_email' AND tenant_id = $1 AND payload ->> 'token_id' = $2
	`, env.tenant.ID, registered.ID.String()); mails != 1 {
		t.Fatalf("queued admin reset mails = %d, want 1", mails)
	}
	if all := env.count(t, `SELECT count(*) FROM outbox_events`); all != 1 {
		t.Fatalf("queued events = %d, want only the admin reset mail", all)
	}
}

// An address held by an account in another tenant is an unknown address here.
func TestAdminPasswordResetRequestLooksOnlyInItsOwnTenant(t *testing.T) {
	env := newReaderRequestEnv(t)
	other := env.pg.SeedTenant(t, "READERREQ002", "other-request.example.com", "Other Tenant")
	admin := env.pg.SeedTenantAdmin(t, other.ID, "ADMINREQU001", "admin@other-request.example.com", "Admin")

	env.process(t, outbox.NewAdminPasswordResetRequestHandler(env.cfg), adminResetEvent(t, env.tenant.ID, admin.Email))

	if tokens := env.count(t, `SELECT count(*) FROM user_password_reset_tokens WHERE user_id = $1`, admin.ID); tokens != 0 {
		t.Fatalf("reset tokens for the other tenant's admin = %d, want none", tokens)
	}
}

func TestPlatformPasswordResetRequestIssuesALinkOnlyForARegisteredAddress(t *testing.T) {
	env := newReaderRequestEnv(t)
	operator := env.pg.SeedPlatformOperator(t, "PLATREQU0001", "operator@platform-request.example.com", "Operator")
	handler := outbox.NewPlatformPasswordResetRequestHandler(env.cfg)

	env.process(t, handler, platformResetEvent(t, "stranger@platform-request.example.com"))
	if rows := env.count(t, `SELECT count(*) FROM outbox_events`); rows != 0 {
		t.Fatalf("queued events for an unknown address = %d, want none", rows)
	}

	registered := platformResetEvent(t, operator.Email)
	env.process(t, handler, registered)
	env.process(t, handler, registered)

	if tokens := env.count(t, `
		SELECT count(*) FROM platform_user_password_reset_tokens WHERE platform_user_id = $1 AND id = $2
	`, operator.ID, registered.ID); tokens != 1 {
		t.Fatalf("reset tokens named after the request = %d, want 1", tokens)
	}
	if mails := env.count(t, `
		SELECT count(*) FROM outbox_events
		WHERE event_type = 'platform_password_reset_email' AND tenant_id IS NULL AND payload ->> 'token_id' = $1
	`, registered.ID.String()); mails != 1 {
		t.Fatalf("queued platform reset mails = %d, want 1", mails)
	}
	if all := env.count(t, `SELECT count(*) FROM outbox_events`); all != 1 {
		t.Fatalf("queued events = %d, want only the platform reset mail", all)
	}
}

func TestPlatformPasswordResetRequestNamingATenantIsRefused(t *testing.T) {
	env := newReaderRequestEnv(t)
	event := platformResetEvent(t, "operator@platform-request.example.com")
	event.TenantID = uuid.NullUUID{UUID: env.tenant.ID, Valid: true}

	err := outbox.NewPlatformPasswordResetRequestHandler(env.cfg)(context.Background(), event)
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent failure", err)
	}
}

// Requests for one address handled at once still leave one live link, as the
// reader's do.
func TestConsolePasswordResetRequestsKeepOneLinkUnderConcurrentProcessing(t *testing.T) {
	t.Run("admin", func(t *testing.T) {
		env := newReaderRequestEnv(t)
		admin := env.pg.SeedTenantAdmin(t, env.tenant.ID, "ADMINREQU001", "admin@reader-request.example.com", "Admin")
		handler := outbox.NewAdminPasswordResetRequestHandler(env.cfg)

		for range testutil.ConcurrentBursts {
			testutil.RunConcurrently(t, testutil.ConcurrentRequests, func() error {
				return handler(context.Background(), adminResetEvent(t, env.tenant.ID, admin.Email))
			})
			if live := env.count(t, `
				SELECT count(*) FROM user_password_reset_tokens WHERE user_id = $1 AND completed_at IS NULL
			`, admin.ID); live != 1 {
				t.Fatalf("live tokens = %d, want 1", live)
			}
		}
	})
	t.Run("platform", func(t *testing.T) {
		env := newReaderRequestEnv(t)
		operator := env.pg.SeedPlatformOperator(t, "PLATREQU0001", "operator@platform-request.example.com", "Operator")
		handler := outbox.NewPlatformPasswordResetRequestHandler(env.cfg)

		for range testutil.ConcurrentBursts {
			testutil.RunConcurrently(t, testutil.ConcurrentRequests, func() error {
				return handler(context.Background(), platformResetEvent(t, operator.Email))
			})
			if live := env.count(t, `
				SELECT count(*) FROM platform_user_password_reset_tokens WHERE platform_user_id = $1 AND completed_at IS NULL
			`, operator.ID); live != 1 {
				t.Fatalf("live tokens = %d, want 1", live)
			}
		}
	})
}

// A request the worker drains is gone from the row once done, whether or not an
// account holds the address, and one left behind by a worker that died holding
// it is completed by the next.
func TestConsolePasswordResetRequestsSurviveTheWorkerAndDropTheAddress(t *testing.T) {
	env := newReaderRequestEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin := env.pg.SeedTenantAdmin(t, env.tenant.ID, "ADMINREQU001", "admin@reader-request.example.com", "Admin")
	operator := env.pg.SeedPlatformOperator(t, "PLATREQU0001", "operator@platform-request.example.com", "Operator")

	queries := dbmodels.New(env.pg.DB)
	insert := func(tenantID uuid.NullUUID, eventType string, payload any) dbmodels.OutboxEvent {
		t.Helper()
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		id := uuid.Must(uuid.NewV7())
		event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
			ID:             id,
			TenantID:       tenantID,
			EventType:      eventType,
			Payload:        body,
			IdempotencyKey: eventType + ":" + id.String(),
			AvailableAt:    time.Now().UTC().Add(-time.Second),
		})
		if err != nil {
			t.Fatalf("InsertOutboxEvent: %v", err)
		}
		return event
	}
	tenant := uuid.NullUUID{UUID: env.tenant.ID, Valid: true}
	events := []dbmodels.OutboxEvent{
		insert(tenant, outbox.EventTypeAdminPasswordResetRequest,
			outbox.AdminPasswordResetRequestPayload{TenantID: env.tenant.ID.String(), Email: admin.Email}),
		insert(tenant, outbox.EventTypeAdminPasswordResetRequest,
			outbox.AdminPasswordResetRequestPayload{TenantID: env.tenant.ID.String(), Email: "stranger@reader-request.example.com"}),
		insert(uuid.NullUUID{}, outbox.EventTypePlatformPasswordResetRequest,
			outbox.PlatformPasswordResetRequestPayload{Email: operator.Email}),
		insert(uuid.NullUUID{}, outbox.EventTypePlatformPasswordResetRequest,
			outbox.PlatformPasswordResetRequestPayload{Email: "stranger@platform-request.example.com"}),
	}
	stranded := events[2]
	if _, err := env.pg.DB.ExecContext(ctx, `
		UPDATE outbox_events
		SET status = 'processing', updated_at = NOW() - interval '1 minute'
		WHERE id = $1
	`, stranded.ID); err != nil {
		t.Fatalf("leave the request claimed: %v", err)
	}

	handlers := outbox.NewRegistry()
	handlers.Register(outbox.EventTypeAdminPasswordResetRequest, outbox.NewAdminPasswordResetRequestHandler(env.cfg))
	handlers.Register(outbox.EventTypePlatformPasswordResetRequest, outbox.NewPlatformPasswordResetRequestHandler(env.cfg))
	startTestWorker(t, env.pg.DB, outbox.Config{Handlers: handlers, StaleProcessing: 50 * time.Millisecond})
	for _, event := range events {
		done := waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)
		if strings.Contains(string(done.Payload), "@") {
			t.Fatalf("payload of the done %s still holds the address: %s", event.EventType, done.Payload)
		}
	}

	if tokens := env.count(t, `SELECT count(*) FROM user_password_reset_tokens WHERE user_id = $1`, admin.ID); tokens != 1 {
		t.Fatalf("admin reset tokens = %d, want 1", tokens)
	}
	if tokens := env.count(t, `
		SELECT count(*) FROM platform_user_password_reset_tokens WHERE platform_user_id = $1 AND id = $2
	`, operator.ID, stranded.ID); tokens != 1 {
		t.Fatalf("platform reset tokens from the stranded request = %d, want 1", tokens)
	}
}
