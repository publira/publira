package outbox_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/outbox"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/testutil"
)

// recordingPlatformMailer keeps what the handler asked to be delivered, which is
// the only place a test can see the recipient the stored rows decided on.
type recordingPlatformMailer struct {
	recipients []string
	emails     []internalsmtp.RenderedEmail
}

func (m *recordingPlatformMailer) SendRenderedEmail(
	_ context.Context,
	_ emailsettings.SMTPSettings,
	recipient string,
	email internalsmtp.RenderedEmail,
) error {
	m.recipients = append(m.recipients, recipient)
	m.emails = append(m.emails, email)
	return nil
}

type recordingPlatformRenderer struct{ requests []emailrenderer.Request }

func (r *recordingPlatformRenderer) Render(_ context.Context, request emailrenderer.Request) (emailrenderer.Email, error) {
	r.requests = append(r.requests, request)
	return emailrenderer.Email{Subject: "Platform Console", HTML: "<p>Platform Console</p>", Text: "Platform Console"}, nil
}

func newPlatformEmailEnv(t *testing.T) (*testutil.PostgresEnv, emailsettings.SecretManager) {
	t.Helper()

	// The console origin is read from the environment when the link is built, so
	// pin it rather than asserting the built-in default and depending on the
	// variable being unset — the E2E stack exports it.
	t.Setenv("PUBLIRA_PLATFORM_APP_URL", "http://platform.localhost:3080")

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newInvitationEncryptor(t)
	seedPlatformSMTPConfig(t, pg, encryptor)
	seedPlatformConfig(t, pg, "Asia/Tokyo", "ja")
	return pg, encryptor
}

func seedPlatformConfig(t *testing.T, pg *testutil.PostgresEnv, timezone, defaultLocale string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO platform_config (singleton, default_timezone, default_locale)
		VALUES (TRUE, $1, $2)
		ON CONFLICT (singleton) DO UPDATE
		SET default_timezone = EXCLUDED.default_timezone, default_locale = EXCLUDED.default_locale
	`, timezone, defaultLocale); err != nil {
		t.Fatalf("seed platform_config: %v", err)
	}
}

func newPlatformOutboxEvent(t *testing.T, eventType string, payload any, idempotencyKey string) dbmodels.OutboxEvent {
	t.Helper()

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal %s payload: %v", eventType, err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		EventType:      eventType,
		Payload:        body,
		IdempotencyKey: idempotencyKey,
		Status:         outbox.StatusPending,
		AvailableAt:    time.Now(),
	}
}

func seedPlatformOperator(t *testing.T, pg *testutil.PostgresEnv, publicID, email string) dbmodels.PlatformUser {
	t.Helper()

	operator := pg.SeedPlatformOperator(t, publicID, email, "Platform Operator")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	user, err := dbmodels.New(pg.DB).GetPlatformUserByID(ctx, operator.ID)
	if err != nil {
		t.Fatalf("GetPlatformUserByID: %v", err)
	}
	return user
}

func seedPlatformPasswordResetToken(t *testing.T, pg *testutil.PostgresEnv, userID uuid.UUID, token string, expiresAt time.Time) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tokenID := uuid.Must(uuid.NewV7())
	if _, err := dbmodels.New(pg.DB).CreatePlatformUserPasswordResetToken(ctx, dbmodels.CreatePlatformUserPasswordResetTokenParams{
		ID:             tokenID,
		PlatformUserID: userID,
		TokenHash:      auth.HashToken(token),
		ExpiresAt:      expiresAt,
	}); err != nil {
		t.Fatalf("CreatePlatformUserPasswordResetToken: %v", err)
	}
	return tokenID
}

func seedPlatformEmailChangeToken(
	t *testing.T,
	pg *testutil.PostgresEnv,
	userID uuid.UUID,
	currentEmail, newEmail, currentToken, newToken string,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tokenID := uuid.Must(uuid.NewV7())
	if _, err := dbmodels.New(pg.DB).CreatePlatformUserEmailChangeToken(ctx, dbmodels.CreatePlatformUserEmailChangeTokenParams{
		ID:                    tokenID,
		PlatformUserID:        userID,
		CurrentEmail:          currentEmail,
		NewEmail:              newEmail,
		CurrentEmailTokenHash: auth.HashToken(currentToken),
		NewEmailTokenHash:     auth.HashToken(newToken),
		ExpiresAt:             time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("CreatePlatformUserEmailChangeToken: %v", err)
	}
	return tokenID
}

func TestPlatformPasswordResetEmailRendersTheStoredRequest(t *testing.T) {
	pg, encryptor := newPlatformEmailEnv(t)
	operator := seedPlatformOperator(t, pg, "PLATOUTBOX01", "operator@example.com")
	tokenID := seedPlatformPasswordResetToken(t, pg, operator.ID, "reset-token", time.Now().Add(time.Hour))

	renderer := &recordingPlatformRenderer{}
	mailer := &recordingPlatformMailer{}
	handler := outbox.NewPlatformPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newPlatformOutboxEvent(t, outbox.EventTypePlatformPasswordResetEmail,
		outbox.PlatformPasswordResetEmailPayload{TokenID: tokenID.String(), Token: "reset-token"},
		"platform_password_reset_email:"+tokenID.String())

	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 1 {
		t.Fatalf("render requests = %d, want 1", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "platform_console_password_reset" {
		t.Fatalf("template = %q, want platform_console_password_reset", request.Template)
	}
	if request.Locale != "ja" || request.TimeZone != "Asia/Tokyo" {
		t.Fatalf("locale/time zone = %q/%q, want the platform defaults", request.Locale, request.TimeZone)
	}
	if url, _ := request.Data["reset_url"].(string); url != "http://platform.localhost:3080/confirm-password?token=reset-token" {
		t.Fatalf("reset_url = %v", request.Data["reset_url"])
	}
	if _, ok := request.Data["expires_at"].(string); !ok {
		t.Fatalf("expires_at = %v, want an RFC3339 string", request.Data["expires_at"])
	}
	if len(mailer.recipients) != 1 || mailer.recipients[0] != operator.Email {
		t.Fatalf("recipients = %v, want [%s]", mailer.recipients, operator.Email)
	}
	if mailer.emails[0].HTML == "" || mailer.emails[0].Text == "" {
		t.Fatalf("delivered email = %+v, want both alternatives", mailer.emails[0])
	}
}

// A second request deletes the pending rows, so the mail for the first one has
// nothing left to announce and must not go out.
func TestPlatformPasswordResetEmailSkipsASupersededRequest(t *testing.T) {
	pg, encryptor := newPlatformEmailEnv(t)
	operator := seedPlatformOperator(t, pg, "PLATOUTBOX02", "operator@example.com")
	tokenID := seedPlatformPasswordResetToken(t, pg, operator.ID, "stale-token", time.Now().Add(time.Hour))

	ctx := context.Background()
	if err := dbmodels.New(pg.DB).DeletePlatformUserPasswordResetTokensByUserID(ctx, operator.ID); err != nil {
		t.Fatalf("DeletePlatformUserPasswordResetTokensByUserID: %v", err)
	}

	renderer := &recordingPlatformRenderer{}
	mailer := &recordingPlatformMailer{}
	handler := outbox.NewPlatformPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newPlatformOutboxEvent(t, outbox.EventTypePlatformPasswordResetEmail,
		outbox.PlatformPasswordResetEmailPayload{TokenID: tokenID.String(), Token: "stale-token"},
		"platform_password_reset_email:"+tokenID.String())

	if err := handler(ctx, event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 0 || len(mailer.recipients) != 0 {
		t.Fatalf("rendered %d and sent %d, want neither", len(renderer.requests), len(mailer.recipients))
	}
}

// A platform default locale no catalog covers will not start rendering after a
// retry, so the event fails permanently instead of looping.
func TestPlatformPasswordResetEmailFailsPermanentlyOnAnUnusableLocale(t *testing.T) {
	pg, encryptor := newPlatformEmailEnv(t)
	seedPlatformConfig(t, pg, "Asia/Tokyo", "fr")
	operator := seedPlatformOperator(t, pg, "PLATOUTBOX03", "operator@example.com")
	tokenID := seedPlatformPasswordResetToken(t, pg, operator.ID, "reset-token", time.Now().Add(time.Hour))

	renderer := &recordingPlatformRenderer{}
	mailer := &recordingPlatformMailer{}
	handler := outbox.NewPlatformPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newPlatformOutboxEvent(t, outbox.EventTypePlatformPasswordResetEmail,
		outbox.PlatformPasswordResetEmailPayload{TokenID: tokenID.String(), Token: "reset-token"},
		"platform_password_reset_email:"+tokenID.String())

	err := handler(context.Background(), event)
	if err == nil {
		t.Fatal("handler returned no error for a platform locale no catalog covers")
	}
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent failure", err)
	}
	if len(renderer.requests) != 0 || len(mailer.recipients) != 0 {
		t.Fatalf("rendered %d and sent %d, want neither", len(renderer.requests), len(mailer.recipients))
	}
}

// A worker started without encryption keys has no manager to decrypt the stored
// SMTP password with. That has to surface as a retriable failure — an operator
// restarting the process with the keys makes the event deliverable — rather than
// as a panic from a nil manager reaching the decryption path.
func TestPlatformPasswordResetEmailRetriesWithoutASecretManager(t *testing.T) {
	pg, _ := newPlatformEmailEnv(t)
	operator := seedPlatformOperator(t, pg, "PLATOUTBOX08", "operator@example.com")
	tokenID := seedPlatformPasswordResetToken(t, pg, operator.ID, "reset-token", time.Now().Add(time.Hour))

	renderer := &recordingPlatformRenderer{}
	mailer := &recordingPlatformMailer{}
	handler := outbox.NewPlatformPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: nil, Mailer: mailer, Renderer: renderer,
	})
	event := newPlatformOutboxEvent(t, outbox.EventTypePlatformPasswordResetEmail,
		outbox.PlatformPasswordResetEmailPayload{TokenID: tokenID.String(), Token: "reset-token"},
		"platform_password_reset_email:"+tokenID.String())

	err := handler(context.Background(), event)
	if err == nil {
		t.Fatal("handler returned no error without a secret manager")
	}
	if outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable failure", err)
	}
	if len(renderer.requests) != 0 || len(mailer.recipients) != 0 {
		t.Fatalf("rendered %d and sent %d, want neither", len(renderer.requests), len(mailer.recipients))
	}
}

// Both sides of a change confirm, and the token decides which side a given
// event addresses.
func TestPlatformEmailChangeConfirmationEmailAddressesTheSideItsTokenBelongsTo(t *testing.T) {
	pg, encryptor := newPlatformEmailEnv(t)
	operator := seedPlatformOperator(t, pg, "PLATOUTBOX04", "operator@example.com")
	tokenID := seedPlatformEmailChangeToken(t, pg, operator.ID, "operator@example.com", "moved@example.com", "current-token", "new-token")

	cases := []struct {
		name          string
		token         string
		wantRecipient string
		wantKind      string
	}{
		{name: "current address", token: "current-token", wantRecipient: "operator@example.com", wantKind: "current_email"},
		{name: "new address", token: "new-token", wantRecipient: "moved@example.com", wantKind: "new_email"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			renderer := &recordingPlatformRenderer{}
			mailer := &recordingPlatformMailer{}
			handler := outbox.NewPlatformEmailChangeConfirmationEmailHandler(outbox.EmailHandlerConfig{
				DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
			})
			event := newPlatformOutboxEvent(t, outbox.EventTypePlatformEmailChangeConfirmationEmail,
				outbox.PlatformEmailChangeConfirmationEmailPayload{TokenID: tokenID.String(), Token: tc.token},
				"platform_email_change_confirmation_email:"+tokenID.String()+":"+tc.wantKind)

			if err := handler(context.Background(), event); err != nil {
				t.Fatalf("handler: %v", err)
			}
			if len(renderer.requests) != 1 {
				t.Fatalf("render requests = %d, want 1", len(renderer.requests))
			}
			request := renderer.requests[0]
			if request.Template != "platform_console_email_change_confirmation" {
				t.Fatalf("template = %q", request.Template)
			}
			if kind, _ := request.Data["recipient_kind"].(string); kind != tc.wantKind {
				t.Fatalf("recipient_kind = %v, want %s", request.Data["recipient_kind"], tc.wantKind)
			}
			if url, _ := request.Data["confirm_url"].(string); url != "http://platform.localhost:3080/confirm-email?token="+tc.token {
				t.Fatalf("confirm_url = %v", request.Data["confirm_url"])
			}
			if request.Data["current_email"] != "operator@example.com" || request.Data["new_email"] != "moved@example.com" {
				t.Fatalf("addresses = %v / %v", request.Data["current_email"], request.Data["new_email"])
			}
			if len(mailer.recipients) != 1 || mailer.recipients[0] != tc.wantRecipient {
				t.Fatalf("recipients = %v, want [%s]", mailer.recipients, tc.wantRecipient)
			}
		})
	}
}

func TestPlatformEmailChangedNoticeEmailGoesToThePreviousAddress(t *testing.T) {
	pg, encryptor := newPlatformEmailEnv(t)
	operator := seedPlatformOperator(t, pg, "PLATOUTBOX05", "operator@example.com")
	tokenID := seedPlatformEmailChangeToken(t, pg, operator.ID, "operator@example.com", "moved@example.com", "current-token", "new-token")

	ctx := context.Background()
	if err := dbmodels.New(pg.DB).MarkPlatformUserEmailChangeCompleted(ctx, tokenID); err != nil {
		t.Fatalf("MarkPlatformUserEmailChangeCompleted: %v", err)
	}

	renderer := &recordingPlatformRenderer{}
	mailer := &recordingPlatformMailer{}
	handler := outbox.NewPlatformEmailChangedNoticeEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newPlatformOutboxEvent(t, outbox.EventTypePlatformEmailChangedNoticeEmail,
		outbox.PlatformEmailChangedNoticeEmailPayload{TokenID: tokenID.String()},
		"platform_email_changed_notice_email:"+tokenID.String())

	if err := handler(ctx, event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 1 {
		t.Fatalf("render requests = %d, want 1", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "platform_console_email_changed_notice" {
		t.Fatalf("template = %q", request.Template)
	}
	if request.Data["previous_email"] != "operator@example.com" || request.Data["new_email"] != "moved@example.com" {
		t.Fatalf("addresses = %v / %v", request.Data["previous_email"], request.Data["new_email"])
	}
	if len(mailer.recipients) != 1 || mailer.recipients[0] != "operator@example.com" {
		t.Fatalf("recipients = %v, want the previous address", mailer.recipients)
	}
}

// An event naming a tenant is a payload no platform mail could have produced,
// and no retry turns it into one.
func TestPlatformAuthEmailFailsPermanentlyOnATenantScopedEvent(t *testing.T) {
	pg, encryptor := newPlatformEmailEnv(t)
	tenant := pg.SeedTenant(t, "PLATOUTBOX06", "platform-outbox.example.com", "Platform Outbox Tenant")

	mailer := &recordingPlatformMailer{}
	handler := outbox.NewPlatformPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: &recordingPlatformRenderer{},
	})
	event := newPlatformOutboxEvent(t, outbox.EventTypePlatformPasswordResetEmail,
		outbox.PlatformPasswordResetEmailPayload{TokenID: uuid.Must(uuid.NewV7()).String(), Token: "reset-token"},
		"platform_password_reset_email:tenant-scoped")
	event.TenantID = uuid.NullUUID{UUID: tenant.ID, Valid: true}

	err := handler(context.Background(), event)
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent failure", err)
	}
	if len(mailer.recipients) != 0 {
		t.Fatalf("recipients = %v, want none", mailer.recipients)
	}
}

// The worker claims across tenants, so a row with no tenant of its own is
// picked up and delivered like any other.
func TestWorkerDeliversTenantlessPlatformPasswordResetEmail(t *testing.T) {
	pg, encryptor := newPlatformEmailEnv(t)
	operator := seedPlatformOperator(t, pg, "PLATOUTBOX07", "operator@example.com")
	tokenID := seedPlatformPasswordResetToken(t, pg, operator.ID, "reset-token", time.Now().Add(time.Hour))

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	queries := dbmodels.New(pg.DB)
	payload, err := json.Marshal(outbox.PlatformPasswordResetEmailPayload{TokenID: tokenID.String(), Token: "reset-token"})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	event, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		EventType:      outbox.EventTypePlatformPasswordResetEmail,
		Payload:        payload,
		IdempotencyKey: "platform_password_reset_email:" + tokenID.String(),
		AvailableAt:    time.Now().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("InsertOutboxEvent: %v", err)
	}
	if event.TenantID.Valid {
		t.Fatalf("tenant_id = %s, want null", event.TenantID.UUID)
	}

	mailer := &recordingPlatformMailer{}
	handlers := outbox.DefaultRegistry()
	handlers.Register(outbox.EventTypePlatformPasswordResetEmail, outbox.NewPlatformPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: &recordingPlatformRenderer{},
	}))
	startTestWorker(t, pg.DB, outbox.Config{Handlers: handlers})
	waitStatus(t, ctx, queries, event.ID, outbox.StatusDone)

	if len(mailer.recipients) != 1 || mailer.recipients[0] != operator.Email {
		t.Fatalf("recipients = %v, want [%s]", mailer.recipients, operator.Email)
	}
}
