package outbox_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/testutil"
)

type invitationRendererStub struct{}

func (invitationRendererStub) Render(context.Context, emailrenderer.Request) (emailrenderer.Email, error) {
	return emailrenderer.Email{Subject: "Invitation", HTML: "<p>Invitation</p>", Text: "Invitation"}, nil
}

type retryingInvitationMailer struct{ attempts atomic.Int32 }

func (m *retryingInvitationMailer) SendRenderedEmail(context.Context, emailsettings.SMTPSettings, string, internalsmtp.RenderedEmail) error {
	if m.attempts.Add(1) == 1 {
		return errors.New("smtp unavailable")
	}
	return nil
}

func TestWorkerRetriesTenantAdminInvitationEmail(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "OUTBOXINV001", "outbox-invitation.example.com", "Outbox Invitation Tenant")
	queries := dbmodels.New(pg.DB)
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"test": make([]byte, 32)}, "test")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	password, err := encryptor.EncryptString("smtp-password")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := queries.UpsertPlatformSMTPConfig(ctx, dbmodels.UpsertPlatformSMTPConfigParams{
		Host: "smtp.example.com", Port: 587, Username: "mailer", PasswordEncrypted: password,
		Encryption: "starttls", FromAddress: "no-reply@example.com",
	}); err != nil {
		t.Fatalf("UpsertPlatformSMTPConfig: %v", err)
	}

	token := "invite-token"
	invitation, err := queries.CreateTenantAdminInvitation(ctx, dbmodels.CreateTenantAdminInvitationParams{
		ID: uuid.Must(uuid.NewV7()), TenantID: tenant.ID, Email: "admin@example.com",
		TokenHash: auth.HashToken(token), ExpiresAt: time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateTenantAdminInvitation: %v", err)
	}
	payload, err := json.Marshal(outbox.TenantAdminInvitationPayload{TenantID: tenant.ID.String(), InvitationID: invitation.ID.String(), Token: token})
	if err != nil {
		t.Fatalf("Marshal payload: %v", err)
	}
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID: uuid.Must(uuid.NewV7()), TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
		EventType: outbox.EventTypeTenantAdminInvitationEmail, Payload: payload,
		IdempotencyKey: "tenant-admin-invitation-retry", AvailableAt: time.Now().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent: %v", err)
	}

	mailer := &retryingInvitationMailer{}
	handlers := outbox.DefaultRegistry()
	handlers.Register(outbox.EventTypeTenantAdminInvitationEmail, outbox.NewTenantAdminInvitationHandler(outbox.TenantAdminInvitationHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: invitationRendererStub{},
	}))
	worker := startTestWorker(t, pg.DB, outbox.Config{Handlers: handlers})
	got := waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)
	if got.Attempts != 1 {
		t.Fatalf("attempts = %d, want 1", got.Attempts)
	}
	if mailer.attempts.Load() != 2 {
		t.Fatalf("mailer attempts = %d, want 2", mailer.attempts.Load())
	}
	if worker.Metrics().Retry.Load() < 1 {
		t.Fatalf("retry metric = %d, want at least 1", worker.Metrics().Retry.Load())
	}
}

func TestTenantAdminInvitationOutboxEventIsIdempotent(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()
	tenant := pg.SeedTenant(t, "OUTBOXINV002", "outbox-idempotent.example.com", "Outbox Idempotent Tenant")
	queries := dbmodels.New(pg.DB)
	payload, err := json.Marshal(outbox.TenantAdminInvitationPayload{TenantID: tenant.ID.String(), InvitationID: uuid.Must(uuid.NewV7()).String(), Token: "invite-token"})
	if err != nil {
		t.Fatalf("Marshal payload: %v", err)
	}
	params := dbmodels.InsertOutboxEventParams{TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true}, EventType: outbox.EventTypeTenantAdminInvitationEmail, Payload: payload, IdempotencyKey: "tenant-admin-invitation-idempotent", AvailableAt: time.Now()}
	params.ID = uuid.Must(uuid.NewV7())
	if _, err := queries.InsertOutboxEvent(ctx, params); err != nil {
		t.Fatalf("first InsertOutboxEvent: %v", err)
	}
	params.ID = uuid.Must(uuid.NewV7())
	if _, err := queries.InsertOutboxEvent(ctx, params); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("duplicate InsertOutboxEvent error = %v, want sql.ErrNoRows", err)
	}
	var count int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM outbox_events WHERE idempotency_key = $1", params.IdempotencyKey).Scan(&count); err != nil {
		t.Fatalf("count outbox events: %v", err)
	}
	if count != 1 {
		t.Fatalf("outbox event count = %d, want 1", count)
	}
}
