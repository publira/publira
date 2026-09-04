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

// recordingReaderMailer keeps what the handler asked to be delivered, which is
// the only place a test can see the recipient the stored rows decided on.
type recordingReaderMailer struct {
	recipients []string
	emails     []internalsmtp.RenderedEmail
}

func (m *recordingReaderMailer) SendRenderedEmail(
	_ context.Context,
	_ emailsettings.SMTPSettings,
	recipient string,
	email internalsmtp.RenderedEmail,
) error {
	m.recipients = append(m.recipients, recipient)
	m.emails = append(m.emails, email)
	return nil
}

type recordingReaderRenderer struct{ requests []emailrenderer.Request }

func (r *recordingReaderRenderer) Render(_ context.Context, request emailrenderer.Request) (emailrenderer.Email, error) {
	r.requests = append(r.requests, request)
	return emailrenderer.Email{Subject: "Reader", HTML: "<p>Reader</p>", Text: "Reader"}, nil
}

// readerEmailEnv is a tenant with somewhere to send through, which is what every
// reader auth mail needs before its own row is looked at.
func newReaderEmailEnv(t *testing.T) (*testutil.PostgresEnv, testutil.Tenant, emailsettings.SecretManager) {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newInvitationEncryptor(t)
	seedPlatformSMTPConfig(t, pg, encryptor)
	tenant := pg.SeedTenant(t, "READEROUT001", "reader-outbox.example.com", "Reader Outbox Tenant")
	return pg, tenant, encryptor
}

func newReaderOutboxEvent(t *testing.T, tenantID uuid.UUID, eventType string, payload any, idempotencyKey string) dbmodels.OutboxEvent {
	t.Helper()

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal %s payload: %v", eventType, err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      eventType,
		Payload:        body,
		IdempotencyKey: idempotencyKey,
		Status:         outbox.StatusPending,
		AvailableAt:    time.Now(),
	}
}

func seedReaderVerificationToken(
	t *testing.T,
	pg *testutil.PostgresEnv,
	tenantID, userID uuid.UUID,
	token string,
	expiresAt time.Time,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tokenID := uuid.Must(uuid.NewV7())
	if _, err := dbmodels.New(pg.DB).CreateUserEmailVerificationToken(ctx, dbmodels.CreateUserEmailVerificationTokenParams{
		ID:        tokenID,
		TenantID:  tenantID,
		UserID:    userID,
		TokenHash: auth.HashToken(token),
		ExpiresAt: expiresAt,
	}); err != nil {
		t.Fatalf("CreateUserEmailVerificationToken: %v", err)
	}
	return tokenID
}

func seedReaderPasswordResetToken(
	t *testing.T,
	pg *testutil.PostgresEnv,
	tenantID, userID uuid.UUID,
	token string,
	expiresAt time.Time,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tokenID := uuid.Must(uuid.NewV7())
	if _, err := dbmodels.New(pg.DB).CreateUserPasswordResetToken(ctx, dbmodels.CreateUserPasswordResetTokenParams{
		ID:        tokenID,
		TenantID:  tenantID,
		UserID:    userID,
		TokenHash: auth.HashToken(token),
		ExpiresAt: expiresAt,
	}); err != nil {
		t.Fatalf("CreateUserPasswordResetToken: %v", err)
	}
	return tokenID
}

func seedReaderEmailChangeToken(
	t *testing.T,
	pg *testutil.PostgresEnv,
	tenantID, userID uuid.UUID,
	currentEmail, newEmail, currentToken, newToken string,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tokenID := uuid.Must(uuid.NewV7())
	if _, err := dbmodels.New(pg.DB).CreateUserEmailChangeToken(ctx, dbmodels.CreateUserEmailChangeTokenParams{
		ID:                    tokenID,
		TenantID:              tenantID,
		UserID:                userID,
		CurrentEmail:          currentEmail,
		NewEmail:              newEmail,
		CurrentEmailTokenHash: auth.HashToken(currentToken),
		NewEmailTokenHash:     auth.HashToken(newToken),
		ExpiresAt:             time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("CreateUserEmailChangeToken: %v", err)
	}
	return tokenID
}

func TestReaderEmailVerificationEmailRendersTheStoredSignup(t *testing.T) {
	pg, tenant, encryptor := newReaderEmailEnv(t)
	reader := pg.SeedUnverifiedEndUser(t, tenant.ID, "READEROUTB01", "reader@example.com", "Reader")
	tokenID := seedReaderVerificationToken(t, pg, tenant.ID, reader.ID, "verify-token", time.Now().Add(time.Hour))

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewReaderEmailVerificationEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderEmailVerificationEmail,
		outbox.ReaderEmailVerificationEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "verify-token"},
		"reader_email_verification_email:"+tokenID.String())

	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 1 {
		t.Fatalf("render requests = %d, want 1", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "reader_email_verification" {
		t.Fatalf("template = %q, want reader_email_verification", request.Template)
	}
	if request.Locale != tenant.DefaultLocale {
		t.Fatalf("locale = %q, want the tenant's %q", request.Locale, tenant.DefaultLocale)
	}
	if url, _ := request.Data["verify_url"].(string); url != "https://"+tenant.Domain+"/verify?token=verify-token" {
		t.Fatalf("verify_url = %v", request.Data["verify_url"])
	}
	if request.Data["tenant_name"] != tenant.Name {
		t.Fatalf("tenant_name = %v, want %q", request.Data["tenant_name"], tenant.Name)
	}
	if _, ok := request.Data["expires_at"].(string); !ok {
		t.Fatalf("expires_at = %v, want an RFC3339 string", request.Data["expires_at"])
	}
	if len(mailer.recipients) != 1 || mailer.recipients[0] != reader.Email {
		t.Fatalf("recipients = %v, want [%s]", mailer.recipients, reader.Email)
	}
	if mailer.emails[0].HTML == "" || mailer.emails[0].Text == "" {
		t.Fatalf("delivered email = %+v, want both alternatives", mailer.emails[0])
	}
}

// An address confirmed before the worker got to the event has nothing left to
// announce, and neither has one whose link has already expired.
func TestReaderEmailVerificationEmailSkipsASpentRequest(t *testing.T) {
	cases := []struct {
		name      string
		expiresAt time.Time
		markUsed  bool
	}{
		{name: "already used", expiresAt: time.Now().Add(time.Hour), markUsed: true},
		{name: "expired", expiresAt: time.Now().Add(-time.Hour)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pg, tenant, encryptor := newReaderEmailEnv(t)
			reader := pg.SeedUnverifiedEndUser(t, tenant.ID, "READEROUTB02", "reader@example.com", "Reader")
			tokenID := seedReaderVerificationToken(t, pg, tenant.ID, reader.ID, "verify-token", tc.expiresAt)

			ctx := context.Background()
			if tc.markUsed {
				if err := dbmodels.New(pg.DB).MarkUserEmailVerificationTokenUsed(ctx, tokenID); err != nil {
					t.Fatalf("MarkUserEmailVerificationTokenUsed: %v", err)
				}
			}

			renderer := &recordingReaderRenderer{}
			mailer := &recordingReaderMailer{}
			handler := outbox.NewReaderEmailVerificationEmailHandler(outbox.EmailHandlerConfig{
				DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
			})
			event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderEmailVerificationEmail,
				outbox.ReaderEmailVerificationEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "verify-token"},
				"reader_email_verification_email:"+tokenID.String())

			if err := handler(ctx, event); err != nil {
				t.Fatalf("handler: %v", err)
			}
			if len(renderer.requests) != 0 || len(mailer.recipients) != 0 {
				t.Fatalf("rendered %d and sent %d, want neither", len(renderer.requests), len(mailer.recipients))
			}
		})
	}
}

// A tenant locale no catalog covers will not start rendering after a retry, so
// the event fails permanently instead of looping.
func TestReaderEmailVerificationEmailFailsPermanentlyOnAnUnusableLocale(t *testing.T) {
	pg, tenant, encryptor := newReaderEmailEnv(t)
	setTenantDefaultLocale(t, pg, tenant.ID, "fr")
	reader := pg.SeedUnverifiedEndUser(t, tenant.ID, "READEROUTB03", "reader@example.com", "Reader")
	tokenID := seedReaderVerificationToken(t, pg, tenant.ID, reader.ID, "verify-token", time.Now().Add(time.Hour))

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewReaderEmailVerificationEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderEmailVerificationEmail,
		outbox.ReaderEmailVerificationEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "verify-token"},
		"reader_email_verification_email:"+tokenID.String())

	err := handler(context.Background(), event)
	if err == nil {
		t.Fatal("handler returned no error for a tenant locale no catalog covers")
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
func TestReaderEmailVerificationEmailRetriesWithoutASecretManager(t *testing.T) {
	pg, tenant, _ := newReaderEmailEnv(t)
	reader := pg.SeedUnverifiedEndUser(t, tenant.ID, "READEROUTB04", "reader@example.com", "Reader")
	tokenID := seedReaderVerificationToken(t, pg, tenant.ID, reader.ID, "verify-token", time.Now().Add(time.Hour))

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewReaderEmailVerificationEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: nil, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderEmailVerificationEmail,
		outbox.ReaderEmailVerificationEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "verify-token"},
		"reader_email_verification_email:"+tokenID.String())

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

// One tenant's event must never reach another tenant's rows, so a payload whose
// tenant disagrees with the event's column is refused outright.
func TestReaderEmailVerificationEmailRejectsAMismatchedTenant(t *testing.T) {
	pg, tenant, encryptor := newReaderEmailEnv(t)
	reader := pg.SeedUnverifiedEndUser(t, tenant.ID, "READEROUTB05", "reader@example.com", "Reader")
	tokenID := seedReaderVerificationToken(t, pg, tenant.ID, reader.ID, "verify-token", time.Now().Add(time.Hour))

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewReaderEmailVerificationEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderEmailVerificationEmail,
		outbox.ReaderEmailVerificationEmailPayload{
			TenantID: uuid.Must(uuid.NewV7()).String(),
			TokenID:  tokenID.String(),
			Token:    "verify-token",
		},
		"reader_email_verification_email:"+tokenID.String())

	err := handler(context.Background(), event)
	if err == nil {
		t.Fatal("handler returned no error for a payload naming another tenant")
	}
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent failure", err)
	}
	if len(renderer.requests) != 0 || len(mailer.recipients) != 0 {
		t.Fatalf("rendered %d and sent %d, want neither", len(renderer.requests), len(mailer.recipients))
	}
}

// Both sides of a change confirm, and the token decides which side a given
// event addresses.
func TestReaderEmailChangeConfirmationEmailAddressesTheSideItsTokenBelongsTo(t *testing.T) {
	pg, tenant, encryptor := newReaderEmailEnv(t)
	reader := pg.SeedEndUser(t, tenant.ID, "READEROUTB06", "reader@example.com", "Reader")
	tokenID := seedReaderEmailChangeToken(t, pg, tenant.ID, reader.ID,
		"reader@example.com", "moved@example.com", "current-token", "new-token")

	cases := []struct {
		name          string
		token         string
		wantRecipient string
		wantKind      string
	}{
		{name: "current address", token: "current-token", wantRecipient: "reader@example.com", wantKind: "current_email"},
		{name: "new address", token: "new-token", wantRecipient: "moved@example.com", wantKind: "new_email"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			renderer := &recordingReaderRenderer{}
			mailer := &recordingReaderMailer{}
			handler := outbox.NewReaderEmailChangeConfirmationEmailHandler(outbox.EmailHandlerConfig{
				DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
			})
			event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderEmailChangeConfirmationEmail,
				outbox.ReaderEmailChangeConfirmationEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: tc.token},
				"reader_email_change_confirmation_email:"+tokenID.String()+":"+tc.wantKind)

			if err := handler(context.Background(), event); err != nil {
				t.Fatalf("handler: %v", err)
			}
			if len(renderer.requests) != 1 {
				t.Fatalf("render requests = %d, want 1", len(renderer.requests))
			}
			request := renderer.requests[0]
			if request.Template != "reader_email_change_confirmation" {
				t.Fatalf("template = %q", request.Template)
			}
			if kind, _ := request.Data["recipient_kind"].(string); kind != tc.wantKind {
				t.Fatalf("recipient_kind = %v, want %s", request.Data["recipient_kind"], tc.wantKind)
			}
			if url, _ := request.Data["confirm_url"].(string); url != "https://"+tenant.Domain+"/confirm-email?token="+tc.token {
				t.Fatalf("confirm_url = %v", request.Data["confirm_url"])
			}
			if request.Data["current_email"] != "reader@example.com" || request.Data["new_email"] != "moved@example.com" {
				t.Fatalf("addresses = %v / %v", request.Data["current_email"], request.Data["new_email"])
			}
			if len(mailer.recipients) != 1 || mailer.recipients[0] != tc.wantRecipient {
				t.Fatalf("recipients = %v, want [%s]", mailer.recipients, tc.wantRecipient)
			}
		})
	}
}

// A second request deletes the pending rows, so the mail for the first one has
// nothing left to invite anyone to confirm.
func TestReaderEmailChangeConfirmationEmailSkipsASupersededRequest(t *testing.T) {
	pg, tenant, encryptor := newReaderEmailEnv(t)
	reader := pg.SeedEndUser(t, tenant.ID, "READEROUTB07", "reader@example.com", "Reader")
	tokenID := seedReaderEmailChangeToken(t, pg, tenant.ID, reader.ID,
		"reader@example.com", "moved@example.com", "stale-current", "stale-new")

	ctx := context.Background()
	if err := dbmodels.New(pg.DB).DeleteUserEmailChangeTokensByUserID(ctx, reader.ID); err != nil {
		t.Fatalf("DeleteUserEmailChangeTokensByUserID: %v", err)
	}

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewReaderEmailChangeConfirmationEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderEmailChangeConfirmationEmail,
		outbox.ReaderEmailChangeConfirmationEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "stale-current"},
		"reader_email_change_confirmation_email:"+tokenID.String()+":current_email")

	if err := handler(ctx, event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 0 || len(mailer.recipients) != 0 {
		t.Fatalf("rendered %d and sent %d, want neither", len(renderer.requests), len(mailer.recipients))
	}
}

func TestReaderEmailChangedNoticeEmailGoesToThePreviousAddress(t *testing.T) {
	pg, tenant, encryptor := newReaderEmailEnv(t)
	reader := pg.SeedEndUser(t, tenant.ID, "READEROUTB08", "reader@example.com", "Reader")
	tokenID := seedReaderEmailChangeToken(t, pg, tenant.ID, reader.ID,
		"reader@example.com", "moved@example.com", "current-token", "new-token")

	ctx := context.Background()
	if err := dbmodels.New(pg.DB).MarkUserEmailChangeCompleted(ctx, tokenID); err != nil {
		t.Fatalf("MarkUserEmailChangeCompleted: %v", err)
	}

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewReaderEmailChangedNoticeEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderEmailChangedNoticeEmail,
		outbox.ReaderEmailChangedNoticeEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String()},
		"reader_email_changed_notice_email:"+tokenID.String())

	if err := handler(ctx, event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 1 {
		t.Fatalf("render requests = %d, want 1", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "reader_email_changed_notice" {
		t.Fatalf("template = %q", request.Template)
	}
	if request.Data["previous_email"] != "reader@example.com" || request.Data["new_email"] != "moved@example.com" {
		t.Fatalf("addresses = %v / %v", request.Data["previous_email"], request.Data["new_email"])
	}
	if len(mailer.recipients) != 1 || mailer.recipients[0] != "reader@example.com" {
		t.Fatalf("recipients = %v, want [reader@example.com]", mailer.recipients)
	}
}

// The notice is written in the transaction that completes the change, so a row
// that is not completed is not the request this event names.
func TestReaderEmailChangedNoticeEmailFailsPermanentlyOnAnIncompleteRequest(t *testing.T) {
	pg, tenant, encryptor := newReaderEmailEnv(t)
	reader := pg.SeedEndUser(t, tenant.ID, "READEROUTB09", "reader@example.com", "Reader")
	tokenID := seedReaderEmailChangeToken(t, pg, tenant.ID, reader.ID,
		"reader@example.com", "moved@example.com", "current-token", "new-token")

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewReaderEmailChangedNoticeEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderEmailChangedNoticeEmail,
		outbox.ReaderEmailChangedNoticeEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String()},
		"reader_email_changed_notice_email:"+tokenID.String())

	err := handler(context.Background(), event)
	if err == nil {
		t.Fatal("handler returned no error for an incomplete change request")
	}
	if !outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a permanent failure", err)
	}
	if len(mailer.recipients) != 0 {
		t.Fatalf("sent %d, want none", len(mailer.recipients))
	}
}

func TestReaderPasswordResetEmailRendersTheStoredRequest(t *testing.T) {
	pg, tenant, encryptor := newReaderEmailEnv(t)
	reader := pg.SeedEndUser(t, tenant.ID, "READEROUTB10", "reader@example.com", "Reader")
	tokenID := seedReaderPasswordResetToken(t, pg, tenant.ID, reader.ID, "reset-token", time.Now().Add(time.Hour))

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewReaderPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderPasswordResetEmail,
		outbox.ReaderPasswordResetEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "reset-token"},
		"reader_password_reset_email:"+tokenID.String())

	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 1 {
		t.Fatalf("render requests = %d, want 1", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "reader_password_reset" {
		t.Fatalf("template = %q, want reader_password_reset", request.Template)
	}
	if url, _ := request.Data["reset_url"].(string); url != "https://"+tenant.Domain+"/confirm-password?token=reset-token" {
		t.Fatalf("reset_url = %v", request.Data["reset_url"])
	}
	if len(mailer.recipients) != 1 || mailer.recipients[0] != reader.Email {
		t.Fatalf("recipients = %v, want [%s]", mailer.recipients, reader.Email)
	}
	if mailer.emails[0].HTML == "" || mailer.emails[0].Text == "" {
		t.Fatalf("delivered email = %+v, want both alternatives", mailer.emails[0])
	}
}

// A second request deletes the pending rows, so the mail for the first one has
// nothing left to announce and must not go out.
func TestReaderPasswordResetEmailSkipsASupersededRequest(t *testing.T) {
	pg, tenant, encryptor := newReaderEmailEnv(t)
	reader := pg.SeedEndUser(t, tenant.ID, "READEROUTB11", "reader@example.com", "Reader")
	tokenID := seedReaderPasswordResetToken(t, pg, tenant.ID, reader.ID, "stale-token", time.Now().Add(time.Hour))

	ctx := context.Background()
	if err := dbmodels.New(pg.DB).DeleteUserPasswordResetTokensByUserID(ctx, reader.ID); err != nil {
		t.Fatalf("DeleteUserPasswordResetTokensByUserID: %v", err)
	}

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewReaderPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeReaderPasswordResetEmail,
		outbox.ReaderPasswordResetEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "stale-token"},
		"reader_password_reset_email:"+tokenID.String())

	if err := handler(ctx, event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 0 || len(mailer.recipients) != 0 {
		t.Fatalf("rendered %d and sent %d, want neither", len(renderer.requests), len(mailer.recipients))
	}
}
