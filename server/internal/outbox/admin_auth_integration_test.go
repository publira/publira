package outbox_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

// newAdminEmailEnv is a tenant with somewhere to send through, which is what
// every admin console auth mail needs before its own row is looked at. The
// admin rows live in the same token tables the reader handlers reload, so the
// seeding helpers are shared with the reader tests.
func newAdminEmailEnv(t *testing.T) (*testutil.PostgresEnv, testutil.Tenant, emailsettings.SecretManager) {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	encryptor := newInvitationEncryptor(t)
	seedPlatformSMTPConfig(t, pg, encryptor)
	tenant := pg.SeedTenant(t, "ADMINOUT0001", "admin-outbox.example.com", "Admin Outbox Tenant")
	return pg, tenant, encryptor
}

func TestAdminPasswordResetEmailRendersTheStoredRequest(t *testing.T) {
	pg, tenant, encryptor := newAdminEmailEnv(t)
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMINOUTB001", "admin@example.com", "Admin")
	tokenID := seedReaderPasswordResetToken(t, pg, tenant.ID, admin.ID, "reset-token", time.Now().Add(time.Hour))

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewAdminPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeAdminPasswordResetEmail,
		outbox.AdminPasswordResetEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "reset-token"},
		"admin_password_reset_email:"+tokenID.String())

	if err := handler(context.Background(), event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 1 {
		t.Fatalf("render requests = %d, want 1", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "admin_console_password_reset" {
		t.Fatalf("template = %q, want admin_console_password_reset", request.Template)
	}
	if request.Locale != tenant.DefaultLocale {
		t.Fatalf("locale = %q, want the tenant's %q", request.Locale, tenant.DefaultLocale)
	}
	if url, _ := request.Data["reset_url"].(string); url != "https://"+tenant.AdminDomain+"/confirm-password?token=reset-token" {
		t.Fatalf("reset_url = %v, want a link into the admin domain", request.Data["reset_url"])
	}
	if request.Data["tenant_name"] != tenant.Name {
		t.Fatalf("tenant_name = %v, want %q", request.Data["tenant_name"], tenant.Name)
	}
	if _, ok := request.Data["expires_at"].(string); !ok {
		t.Fatalf("expires_at = %v, want an RFC3339 string", request.Data["expires_at"])
	}
	if len(mailer.recipients) != 1 || mailer.recipients[0] != admin.Email {
		t.Fatalf("recipients = %v, want [%s]", mailer.recipients, admin.Email)
	}
	if mailer.emails[0].HTML == "" || mailer.emails[0].Text == "" {
		t.Fatalf("delivered email = %+v, want both alternatives", mailer.emails[0])
	}
}

// A second request deletes the pending rows, and a completed or expired one has
// nothing left to announce, so the mail for it must not go out.
func TestAdminPasswordResetEmailSkipsASpentRequest(t *testing.T) {
	cases := []struct {
		name      string
		expiresAt time.Time
		spend     func(context.Context, *dbmodels.Queries, uuid.UUID, uuid.UUID) error
	}{
		{
			name:      "superseded",
			expiresAt: time.Now().Add(time.Hour),
			spend: func(ctx context.Context, q *dbmodels.Queries, userID, _ uuid.UUID) error {
				return q.DeleteUserPasswordResetTokensByUserID(ctx, userID)
			},
		},
		{
			name:      "completed",
			expiresAt: time.Now().Add(time.Hour),
			spend: func(ctx context.Context, q *dbmodels.Queries, _, tokenID uuid.UUID) error {
				return q.MarkUserPasswordResetTokenCompleted(ctx, tokenID)
			},
		},
		{
			name:      "expired",
			expiresAt: time.Now().Add(-time.Hour),
			spend:     func(context.Context, *dbmodels.Queries, uuid.UUID, uuid.UUID) error { return nil },
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pg, tenant, encryptor := newAdminEmailEnv(t)
			admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMINOUTB002", "admin@example.com", "Admin")
			tokenID := seedReaderPasswordResetToken(t, pg, tenant.ID, admin.ID, "stale-token", tc.expiresAt)

			ctx := context.Background()
			if err := tc.spend(ctx, dbmodels.New(pg.DB), admin.ID, tokenID); err != nil {
				t.Fatalf("spend the request: %v", err)
			}

			renderer := &recordingReaderRenderer{}
			mailer := &recordingReaderMailer{}
			handler := outbox.NewAdminPasswordResetEmailHandler(outbox.EmailHandlerConfig{
				DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
			})
			event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeAdminPasswordResetEmail,
				outbox.AdminPasswordResetEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "stale-token"},
				"admin_password_reset_email:"+tokenID.String())

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
func TestAdminPasswordResetEmailFailsPermanentlyOnAnUnusableLocale(t *testing.T) {
	pg, tenant, encryptor := newAdminEmailEnv(t)
	setTenantDefaultLocale(t, pg, tenant.ID, "fr")
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMINOUTB003", "admin@example.com", "Admin")
	tokenID := seedReaderPasswordResetToken(t, pg, tenant.ID, admin.ID, "reset-token", time.Now().Add(time.Hour))

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewAdminPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeAdminPasswordResetEmail,
		outbox.AdminPasswordResetEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "reset-token"},
		"admin_password_reset_email:"+tokenID.String())

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

// An SMTP outage is a condition that clears on its own, so a delivery failure
// leaves the event pending rather than burning the administrator's only link.
func TestAdminPasswordResetEmailRetriesWhenDeliveryFails(t *testing.T) {
	pg, tenant, encryptor := newAdminEmailEnv(t)
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMINOUTB004", "admin@example.com", "Admin")
	tokenID := seedReaderPasswordResetToken(t, pg, tenant.ID, admin.ID, "reset-token", time.Now().Add(time.Hour))

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{failure: errors.New("smtp is unreachable")}
	handler := outbox.NewAdminPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeAdminPasswordResetEmail,
		outbox.AdminPasswordResetEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "reset-token"},
		"admin_password_reset_email:"+tokenID.String())

	err := handler(context.Background(), event)
	if err == nil {
		t.Fatal("handler returned no error for a mailer that refused the message")
	}
	if outbox.IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable failure", err)
	}
}

// One tenant's event must never reach another tenant's rows, so a payload whose
// tenant disagrees with the event's column is refused outright.
func TestAdminPasswordResetEmailRejectsAMismatchedTenant(t *testing.T) {
	pg, tenant, encryptor := newAdminEmailEnv(t)
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMINOUTB005", "admin@example.com", "Admin")
	tokenID := seedReaderPasswordResetToken(t, pg, tenant.ID, admin.ID, "reset-token", time.Now().Add(time.Hour))

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewAdminPasswordResetEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeAdminPasswordResetEmail,
		outbox.AdminPasswordResetEmailPayload{
			TenantID: uuid.Must(uuid.NewV7()).String(),
			TokenID:  tokenID.String(),
			Token:    "reset-token",
		},
		"admin_password_reset_email:"+tokenID.String())

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
func TestAdminEmailChangeConfirmationEmailAddressesTheSideItsTokenBelongsTo(t *testing.T) {
	pg, tenant, encryptor := newAdminEmailEnv(t)
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMINOUTB006", "admin@example.com", "Admin")
	tokenID := seedReaderEmailChangeToken(t, pg, tenant.ID, admin.ID,
		"admin@example.com", "moved@example.com", "current-token", "new-token")

	cases := []struct {
		name          string
		token         string
		wantRecipient string
		wantKind      string
	}{
		{name: "current address", token: "current-token", wantRecipient: "admin@example.com", wantKind: "current_email"},
		{name: "new address", token: "new-token", wantRecipient: "moved@example.com", wantKind: "new_email"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			renderer := &recordingReaderRenderer{}
			mailer := &recordingReaderMailer{}
			handler := outbox.NewAdminEmailChangeConfirmationEmailHandler(outbox.EmailHandlerConfig{
				DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
			})
			event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeAdminEmailChangeConfirmationEmail,
				outbox.AdminEmailChangeConfirmationEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: tc.token},
				"admin_email_change_confirmation_email:"+tokenID.String()+":"+tc.wantKind)

			if err := handler(context.Background(), event); err != nil {
				t.Fatalf("handler: %v", err)
			}
			if len(renderer.requests) != 1 {
				t.Fatalf("render requests = %d, want 1", len(renderer.requests))
			}
			request := renderer.requests[0]
			if request.Template != "admin_console_email_change_confirmation" {
				t.Fatalf("template = %q", request.Template)
			}
			if kind, _ := request.Data["recipient_kind"].(string); kind != tc.wantKind {
				t.Fatalf("recipient_kind = %v, want %s", request.Data["recipient_kind"], tc.wantKind)
			}
			if url, _ := request.Data["confirm_url"].(string); url != "https://"+tenant.AdminDomain+"/confirm-email?token="+tc.token {
				t.Fatalf("confirm_url = %v, want a link into the admin domain", request.Data["confirm_url"])
			}
			if request.Data["current_email"] != "admin@example.com" || request.Data["new_email"] != "moved@example.com" {
				t.Fatalf("addresses = %v / %v", request.Data["current_email"], request.Data["new_email"])
			}
			if request.Data["tenant_name"] != tenant.Name {
				t.Fatalf("tenant_name = %v, want %q", request.Data["tenant_name"], tenant.Name)
			}
			if len(mailer.recipients) != 1 || mailer.recipients[0] != tc.wantRecipient {
				t.Fatalf("recipients = %v, want [%s]", mailer.recipients, tc.wantRecipient)
			}
		})
	}
}

// A second request deletes the pending rows, so the mail for the first one has
// nothing left to invite anyone to confirm.
func TestAdminEmailChangeConfirmationEmailSkipsASupersededRequest(t *testing.T) {
	pg, tenant, encryptor := newAdminEmailEnv(t)
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMINOUTB007", "admin@example.com", "Admin")
	tokenID := seedReaderEmailChangeToken(t, pg, tenant.ID, admin.ID,
		"admin@example.com", "moved@example.com", "stale-current", "stale-new")

	ctx := context.Background()
	if err := dbmodels.New(pg.DB).DeleteUserEmailChangeTokensByUserID(ctx, admin.ID); err != nil {
		t.Fatalf("DeleteUserEmailChangeTokensByUserID: %v", err)
	}

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewAdminEmailChangeConfirmationEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeAdminEmailChangeConfirmationEmail,
		outbox.AdminEmailChangeConfirmationEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String(), Token: "stale-current"},
		"admin_email_change_confirmation_email:"+tokenID.String()+":current_email")

	if err := handler(ctx, event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 0 || len(mailer.recipients) != 0 {
		t.Fatalf("rendered %d and sent %d, want neither", len(renderer.requests), len(mailer.recipients))
	}
}

func TestAdminEmailChangedNoticeEmailGoesToThePreviousAddress(t *testing.T) {
	pg, tenant, encryptor := newAdminEmailEnv(t)
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMINOUTB008", "admin@example.com", "Admin")
	tokenID := seedReaderEmailChangeToken(t, pg, tenant.ID, admin.ID,
		"admin@example.com", "moved@example.com", "current-token", "new-token")

	ctx := context.Background()
	if err := dbmodels.New(pg.DB).MarkUserEmailChangeCompleted(ctx, tokenID); err != nil {
		t.Fatalf("MarkUserEmailChangeCompleted: %v", err)
	}

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewAdminEmailChangedNoticeEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeAdminEmailChangedNoticeEmail,
		outbox.AdminEmailChangedNoticeEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String()},
		"admin_email_changed_notice_email:"+tokenID.String())

	if err := handler(ctx, event); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if len(renderer.requests) != 1 {
		t.Fatalf("render requests = %d, want 1", len(renderer.requests))
	}
	request := renderer.requests[0]
	if request.Template != "admin_console_email_changed_notice" {
		t.Fatalf("template = %q", request.Template)
	}
	if request.Data["previous_email"] != "admin@example.com" || request.Data["new_email"] != "moved@example.com" {
		t.Fatalf("addresses = %v / %v", request.Data["previous_email"], request.Data["new_email"])
	}
	if request.Data["tenant_name"] != tenant.Name {
		t.Fatalf("tenant_name = %v, want %q", request.Data["tenant_name"], tenant.Name)
	}
	if len(mailer.recipients) != 1 || mailer.recipients[0] != "admin@example.com" {
		t.Fatalf("recipients = %v, want [admin@example.com]", mailer.recipients)
	}
}

// The notice is written in the transaction that completes the change, so a row
// that is not completed is not the request this event names.
func TestAdminEmailChangedNoticeEmailFailsPermanentlyOnAnIncompleteRequest(t *testing.T) {
	pg, tenant, encryptor := newAdminEmailEnv(t)
	admin := pg.SeedTenantAdmin(t, tenant.ID, "ADMINOUTB009", "admin@example.com", "Admin")
	tokenID := seedReaderEmailChangeToken(t, pg, tenant.ID, admin.ID,
		"admin@example.com", "moved@example.com", "current-token", "new-token")

	renderer := &recordingReaderRenderer{}
	mailer := &recordingReaderMailer{}
	handler := outbox.NewAdminEmailChangedNoticeEmailHandler(outbox.EmailHandlerConfig{
		DB: pg.DB, Encryptor: encryptor, Mailer: mailer, Renderer: renderer,
	})
	event := newReaderOutboxEvent(t, tenant.ID, outbox.EventTypeAdminEmailChangedNoticeEmail,
		outbox.AdminEmailChangedNoticeEmailPayload{TenantID: tenant.ID.String(), TokenID: tokenID.String()},
		"admin_email_changed_notice_email:"+tokenID.String())

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
