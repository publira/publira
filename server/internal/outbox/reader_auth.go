package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/tenanttz"
)

// The reader's auth mail. Every event carries the tenant whose storefront the
// account belongs to: the link points at that tenant's domain, and the language
// and SMTP settings the mail goes out with are the tenant's own.
const (
	EventTypeReaderEmailVerificationEmail       = "reader_email_verification_email"
	EventTypeReaderEmailChangeConfirmationEmail = "reader_email_change_confirmation_email"
	EventTypeReaderEmailChangedNoticeEmail      = "reader_email_changed_notice_email"
	EventTypeReaderPasswordResetEmail           = "reader_password_reset_email"
)

// ReaderEmailVerificationEmailPayload names the verification row the mail is
// about and carries the link's secret, which is the one thing the row cannot
// give back — it stores the hash alone.
type ReaderEmailVerificationEmailPayload struct {
	TenantID string `json:"tenant_id"`
	TokenID  string `json:"token_id"`
	Token    string `json:"token"`
}

// ReaderEmailChangeConfirmationEmailPayload is one event per address to
// confirm. Which side it addresses comes from the token the payload carries,
// since a change request writes one token hash per side.
type ReaderEmailChangeConfirmationEmailPayload struct {
	TenantID string `json:"tenant_id"`
	TokenID  string `json:"token_id"`
	Token    string `json:"token"`
}

// ReaderEmailChangedNoticeEmailPayload names the completed change request. The
// notice announces an address that is already stored, so it needs no token.
type ReaderEmailChangedNoticeEmailPayload struct {
	TenantID string `json:"tenant_id"`
	TokenID  string `json:"token_id"`
}

// ReaderPasswordResetEmailPayload names the reset row and carries the link's
// secret, as the verification payload does.
type ReaderPasswordResetEmailPayload struct {
	TenantID string `json:"tenant_id"`
	TokenID  string `json:"token_id"`
	Token    string `json:"token"`
}

// NewReaderEmailVerificationEmailHandler sends a new reader the link that
// activates their account. A verification row that is gone, already used, or
// expired is a sign-up this event no longer speaks for, and the event is
// dropped rather than delivered.
func NewReaderEmailVerificationEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("reader email verification email"); err != nil {
			return err
		}
		var payload ReaderEmailVerificationEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode reader email verification email payload: %w", err))
		}
		tenantID, tokenID, err := tenantAuthEventIDs(event, payload.TenantID, payload.TokenID)
		if err != nil {
			return Permanent(err)
		}
		if strings.TrimSpace(payload.Token) == "" {
			return Permanent(errors.New("reader email verification email payload has an empty token"))
		}

		verification, err := queries.GetUserEmailVerificationTokenByHashForTenant(ctx, dbmodels.GetUserEmailVerificationTokenByHashForTenantParams{
			TenantID:  tenantID,
			TokenHash: auth.HashToken(payload.Token),
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("load reader email verification token: %w", err)
		}
		if verification.ID != tokenID || verification.UsedAt.Valid || !verification.ExpiresAt.After(time.Now()) {
			return nil
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}
		reader, err := queries.GetUserByID(ctx, verification.UserID)
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("reader %s no longer exists", verification.UserID))
		}
		if err != nil {
			return fmt.Errorf("load reader: %w", err)
		}
		verifyURL, err := tenantSiteURL(delivery.tenant, "/verify", payload.Token)
		if err != nil {
			return Permanent(fmt.Errorf("build reader email verification url: %w", err))
		}

		rendered, err := cfg.Renderer.Render(ctx, emailrenderer.Request{
			Template: "reader_email_verification",
			Locale:   delivery.locale,
			Data: map[string]any{
				"expires_at":  verification.ExpiresAt.UTC().Format(time.RFC3339Nano),
				"tenant_name": delivery.tenantName,
				"verify_url":  verifyURL,
			},
			TimeZone: delivery.timeZone,
		})
		if err != nil {
			return fmt.Errorf("render reader email verification email: %w", err)
		}
		if err := sendRenderedEmail(ctx, cfg.Mailer, delivery.settings, reader.Email, rendered); err != nil {
			return fmt.Errorf("send reader email verification email: %w", err)
		}
		return nil
	}
}

// NewReaderEmailChangeConfirmationEmailHandler sends one side of an address
// change its confirmation link. The stored token hashes decide which side, so a
// mail can never invite the wrong address to confirm.
func NewReaderEmailChangeConfirmationEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("reader email change confirmation email"); err != nil {
			return err
		}
		var payload ReaderEmailChangeConfirmationEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode reader email change confirmation email payload: %w", err))
		}
		tenantID, tokenID, err := tenantAuthEventIDs(event, payload.TenantID, payload.TokenID)
		if err != nil {
			return Permanent(err)
		}
		if strings.TrimSpace(payload.Token) == "" {
			return Permanent(errors.New("reader email change confirmation email payload has an empty token"))
		}

		changeToken, err := queries.GetUserEmailChangeTokenByHashForTenant(ctx, dbmodels.GetUserEmailChangeTokenByHashForTenantParams{
			TenantID:              tenantID,
			CurrentEmailTokenHash: auth.HashToken(payload.Token),
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("load reader email change token: %w", err)
		}
		if changeToken.ID != tokenID || changeToken.CompletedAt.Valid || !changeToken.ExpiresAt.After(time.Now()) {
			return nil
		}
		recipient := changeToken.CurrentEmail
		if changeToken.MatchedTarget == "new_email" {
			recipient = changeToken.NewEmail
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}
		confirmURL, err := tenantSiteURL(delivery.tenant, "/confirm-email", payload.Token)
		if err != nil {
			return Permanent(fmt.Errorf("build reader email change confirmation url: %w", err))
		}

		rendered, err := cfg.Renderer.Render(ctx, emailrenderer.Request{
			Template: "reader_email_change_confirmation",
			Locale:   delivery.locale,
			Data: map[string]any{
				"confirm_url":    confirmURL,
				"current_email":  changeToken.CurrentEmail,
				"expires_at":     changeToken.ExpiresAt.UTC().Format(time.RFC3339Nano),
				"new_email":      changeToken.NewEmail,
				"recipient_kind": changeToken.MatchedTarget,
				"tenant_name":    delivery.tenantName,
			},
			TimeZone: delivery.timeZone,
		})
		if err != nil {
			return fmt.Errorf("render reader email change confirmation email: %w", err)
		}
		if err := sendRenderedEmail(ctx, cfg.Mailer, delivery.settings, recipient, rendered); err != nil {
			return fmt.Errorf("send reader email change confirmation email: %w", err)
		}
		return nil
	}
}

// NewReaderEmailChangedNoticeEmailHandler tells the previous address that the
// change went through. The completed request row holds both addresses, so the
// notice names what was actually stored rather than what was asked for.
func NewReaderEmailChangedNoticeEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("reader email changed notice email"); err != nil {
			return err
		}
		var payload ReaderEmailChangedNoticeEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode reader email changed notice email payload: %w", err))
		}
		tenantID, tokenID, err := tenantAuthEventIDs(event, payload.TenantID, payload.TokenID)
		if err != nil {
			return Permanent(err)
		}

		changeToken, err := queries.GetUserEmailChangeTokenByIDForTenant(ctx, dbmodels.GetUserEmailChangeTokenByIDForTenantParams{
			TenantID: tenantID,
			ID:       tokenID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("reader email change request %s no longer exists", tokenID))
		}
		if err != nil {
			return fmt.Errorf("load reader email change token: %w", err)
		}
		// The event is written in the transaction that completes the change, so
		// an incomplete row means the payload names something else entirely.
		if !changeToken.CompletedAt.Valid {
			return Permanent(fmt.Errorf("reader email change request %s is not completed", tokenID))
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}

		rendered, err := cfg.Renderer.Render(ctx, emailrenderer.Request{
			Template: "reader_email_changed_notice",
			Locale:   delivery.locale,
			Data: map[string]any{
				"new_email":      changeToken.NewEmail,
				"previous_email": changeToken.CurrentEmail,
				"tenant_name":    delivery.tenantName,
			},
			TimeZone: delivery.timeZone,
		})
		if err != nil {
			return fmt.Errorf("render reader email changed notice email: %w", err)
		}
		if err := sendRenderedEmail(ctx, cfg.Mailer, delivery.settings, changeToken.CurrentEmail, rendered); err != nil {
			return fmt.Errorf("send reader email changed notice email: %w", err)
		}
		return nil
	}
}

// NewReaderPasswordResetEmailHandler sends the reader's password reset link. A
// token row that is gone, completed, or expired is a request this event no
// longer speaks for, and the event is dropped rather than delivered.
func NewReaderPasswordResetEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("reader password reset email"); err != nil {
			return err
		}
		var payload ReaderPasswordResetEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode reader password reset email payload: %w", err))
		}
		tenantID, tokenID, err := tenantAuthEventIDs(event, payload.TenantID, payload.TokenID)
		if err != nil {
			return Permanent(err)
		}
		if strings.TrimSpace(payload.Token) == "" {
			return Permanent(errors.New("reader password reset email payload has an empty token"))
		}

		resetToken, err := queries.GetUserPasswordResetTokenByHashForTenant(ctx, dbmodels.GetUserPasswordResetTokenByHashForTenantParams{
			TenantID:  tenantID,
			TokenHash: auth.HashToken(payload.Token),
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("load reader password reset token: %w", err)
		}
		if resetToken.ID != tokenID || resetToken.CompletedAt.Valid || !resetToken.ExpiresAt.After(time.Now()) {
			return nil
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}
		reader, err := queries.GetUserByID(ctx, resetToken.UserID)
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("reader %s no longer exists", resetToken.UserID))
		}
		if err != nil {
			return fmt.Errorf("load reader: %w", err)
		}
		resetURL, err := tenantSiteURL(delivery.tenant, "/confirm-password", payload.Token)
		if err != nil {
			return Permanent(fmt.Errorf("build reader password reset url: %w", err))
		}

		rendered, err := cfg.Renderer.Render(ctx, emailrenderer.Request{
			Template: "reader_password_reset",
			Locale:   delivery.locale,
			Data: map[string]any{
				"expires_at":  resetToken.ExpiresAt.UTC().Format(time.RFC3339Nano),
				"reset_url":   resetURL,
				"tenant_name": delivery.tenantName,
			},
			TimeZone: delivery.timeZone,
		})
		if err != nil {
			return fmt.Errorf("render reader password reset email: %w", err)
		}
		if err := sendRenderedEmail(ctx, cfg.Mailer, delivery.settings, reader.Email, rendered); err != nil {
			return fmt.Errorf("send reader password reset email: %w", err)
		}
		return nil
	}
}

// tenantAuthEventIDs checks what every tenant-scoped auth event shares, the
// reader's and the admin console's alike: the tenant the row belongs to is named
// by both the event and its payload — the table's own check constraint requires
// them to agree — and its token_id points at a row the handler can reload.
func tenantAuthEventIDs(event dbmodels.OutboxEvent, tenantID, tokenID string) (uuid.UUID, uuid.UUID, error) {
	parsedTenant, err := uuid.Parse(tenantID)
	if err != nil || !event.TenantID.Valid || parsedTenant != event.TenantID.UUID {
		return uuid.Nil, uuid.Nil, fmt.Errorf("%s payload has an invalid tenant_id", event.EventType)
	}
	parsedToken, err := uuid.Parse(tokenID)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("%s payload has an invalid token_id", event.EventType)
	}
	return parsedTenant, parsedToken, nil
}

// tenantDelivery is what every tenant-scoped auth mail needs beyond its own
// row: the tenant the link points into, the language and zone the mail is
// written in, and where to hand the message to.
type tenantDelivery struct {
	locale     string
	settings   emailsettings.SMTPSettings
	tenant     dbmodels.Tenant
	tenantName string
	timeZone   string
}

// resolveTenantDelivery reads the locale before the SMTP settings on purpose. A
// tenant locale no catalog covers will not start rendering after a retry, and an
// SMTP outage must not disguise it as a failure that can.
func resolveTenantDelivery(
	ctx context.Context,
	queries *dbmodels.Queries,
	tenantID uuid.UUID,
	encryptor emailsettings.SecretManager,
) (tenantDelivery, error) {
	tenant, err := queries.GetTenantByID(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return tenantDelivery{}, Permanent(fmt.Errorf("tenant %s no longer exists", tenantID))
	}
	if err != nil {
		return tenantDelivery{}, fmt.Errorf("load tenant: %w", err)
	}
	tenantLocale, err := locale.Resolve(tenant.DefaultLocale)
	if err != nil {
		return tenantDelivery{}, Permanent(fmt.Errorf("resolve default locale of tenant %s: %w", tenantID, err))
	}
	settings, err := resolveSMTPSettings(ctx, queries, tenantID, encryptor)
	if err != nil {
		return tenantDelivery{}, fmt.Errorf("resolve smtp settings: %w", err)
	}
	tenantName := strings.TrimSpace(tenant.Name)
	if tenantName == "" {
		tenantName = "Publira"
	}
	return tenantDelivery{
		locale:     tenantLocale,
		settings:   settings,
		tenant:     tenant,
		tenantName: tenantName,
		timeZone:   tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries)),
	}, nil
}

// tenantSiteURL builds a link into the tenant's own storefront. The worker runs
// outside the request that produced the event, so the origin comes from the
// tenant's configured domain rather than from an incoming Host header.
func tenantSiteURL(tenant dbmodels.Tenant, path, token string) (string, error) {
	domain := strings.TrimSpace(tenant.Domain)
	domain = strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(domain, "https://"), "http://"), "/")
	if domain == "" {
		return "", errors.New("tenant domain is not configured")
	}
	return "https://" + domain + path + "?token=" + url.QueryEscape(token), nil
}
