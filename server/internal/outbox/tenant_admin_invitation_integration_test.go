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

// recordingInvitationRenderer captures what the handler asked for, so a test can
// assert which language the invitation was rendered in.
type recordingInvitationRenderer struct{ requests []emailrenderer.Request }

func (r *recordingInvitationRenderer) Render(_ context.Context, request emailrenderer.Request) (emailrenderer.Email, error) {
	r.requests = append(r.requests, request)
	return emailrenderer.Email{Subject: "Invitation", HTML: "<p>Invitation</p>", Text: "Invitation"}, nil
}

type recordingInvitationMailer struct{ sent int }

func (m *recordingInvitationMailer) SendRenderedEmail(context.Context, emailsettings.SMTPSettings, string, internalsmtp.RenderedEmail) error {
	m.sent++
	return nil
}

func newInvitationEncryptor(t *testing.T) emailsettings.SecretManager {
	t.Helper()

	encryptor, err := secretcrypto.NewManager(map[string][]byte{"test": make([]byte, 32)}, "test")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return encryptor
}

// seedPlatformSMTPConfig gives the handler somewhere to send through. A test
// that leaves it out is exercising an invitation whose delivery settings cannot
// be resolved.
func seedPlatformSMTPConfig(t *testing.T, pg *testutil.PostgresEnv, encryptor emailsettings.SecretManager) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	password, err := encryptor.EncryptString("smtp-password")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := dbmodels.New(pg.DB).UpsertPlatformSMTPConfig(ctx, dbmodels.UpsertPlatformSMTPConfigParams{
		Host: "smtp.example.com", Port: 587, Username: "mailer", PasswordEncrypted: password,
		Encryption: "starttls", FromAddress: "no-reply@example.com",
	}); err != nil {
		t.Fatalf("UpsertPlatformSMTPConfig: %v", err)
	}
}

// seedInvitationEvent prepares what the invitation handler reloads: the
// invitation itself and the outbox event carrying its token.
func seedInvitationEvent(t *testing.T, pg *testutil.PostgresEnv, tenant testutil.Tenant, idempotencyKey string) dbmodels.OutboxEvent {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queries := dbmodels.New(pg.DB)
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
		IdempotencyKey: idempotencyKey, AvailableAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent: %v", err)
	}
	return event
}

// setTenantDefaultLocale writes a value the API would refuse, which is the only
// way a tenant row can come to name a locale no catalog covers.
func setTenantDefaultLocale(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, defaultLocale string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := pg.DB.ExecContext(ctx, `UPDATE tenants SET default_locale = $2 WHERE id = $1`, tenantID, defaultLocale); err != nil {
		t.Fatalf("update tenants.default_locale: %v", err)
	}
}

// The invitation is worded in the language the tenant saved. The job has no
// request of its own to take one from, which is exactly why it must not invent
// one.
func TestTenantAdminInvitationEmailUsesTheTenantDefaultLocale(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "OUTBOXINV003", "outbox-locale.example.com", "Outbox Locale Tenant")
	setTenantDefaultLocale(t, pg, tenant.ID, "en")
	encryptor := newInvitationEncryptor(t)
	seedPlatformSMTPConfig(t, pg, encryptor)
	event := seedInvitationEvent(t, pg, tenant, "tenant-admin-invitation-locale")

	renderer := &recordingInvitationRenderer{}
	handler := outbox.NewTenantAdminInvitationHandler(outbox.TenantAdminInvitationHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: &recordingInvitationMailer{}, Renderer: renderer,
	})
	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 1 {
		t.Fatalf("render requests = %d, want 1", len(renderer.requests))
	}
	if renderer.requests[0].Locale != "en" {
		t.Fatalf("render locale = %q, want the stored en", renderer.requests[0].Locale)
	}
}

// A tenant naming a locale no catalog covers will not start rendering after a
// retry, and mailing the invitee in another language is not the fallback: the
// event fails permanently, for an operator to look at.
func TestTenantAdminInvitationEmailFailsPermanentlyOnAnUnusableLocale(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "OUTBOXINV004", "outbox-bad-locale.example.com", "Outbox Bad Locale Tenant")
	setTenantDefaultLocale(t, pg, tenant.ID, "fr")
	encryptor := newInvitationEncryptor(t)
	seedPlatformSMTPConfig(t, pg, encryptor)
	event := seedInvitationEvent(t, pg, tenant, "tenant-admin-invitation-bad-locale")

	renderer := &recordingInvitationRenderer{}
	mailer := &recordingInvitationMailer{}
	handler := outbox.NewTenantAdminInvitationHandler(outbox.TenantAdminInvitationHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	err := handler(context.Background(), event)
	if err == nil {
		t.Fatal("handler returned no error for a tenant locale no catalog covers")
	}
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent failure", err)
	}
	if len(renderer.requests) != 0 {
		t.Fatalf("render requests = %d, want none", len(renderer.requests))
	}
	if mailer.sent != 0 {
		t.Fatalf("mails sent = %d, want none", mailer.sent)
	}
}

// The locale is resolved before the SMTP settings, so an outage that would fail
// retriably cannot disguise a tenant locale that no retry can fix. Without that
// ordering this event would be retried forever on the SMTP error alone.
func TestTenantAdminInvitationEmailFailsPermanentlyOnAnUnusableLocaleWithoutSMTPSettings(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "OUTBOXINV005", "outbox-no-smtp.example.com", "Outbox No SMTP Tenant")
	setTenantDefaultLocale(t, pg, tenant.ID, "fr")
	event := seedInvitationEvent(t, pg, tenant, "tenant-admin-invitation-no-smtp")

	renderer := &recordingInvitationRenderer{}
	mailer := &recordingInvitationMailer{}
	handler := outbox.NewTenantAdminInvitationHandler(outbox.TenantAdminInvitationHandlerConfig{
		DB: pg.DB, Encryptor: newInvitationEncryptor(t), Mailer: mailer, Renderer: renderer,
	})
	err := handler(context.Background(), event)
	if err == nil {
		t.Fatal("handler returned no error for a tenant locale no catalog covers")
	}
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent failure rather than a retriable SMTP one", err)
	}
	if mailer.sent != 0 {
		t.Fatalf("mails sent = %d, want none", mailer.sent)
	}
}
