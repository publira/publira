package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/mfaflow"
)

// The admin console's auth mail. An admin account belongs to a tenant just as a
// reader's does, so every event names that tenant: the link points into the
// tenant's admin console, and the language and SMTP settings are the tenant's
// own. The rows are the same user_* token tables the reader handlers reload.
const (
	EventTypeAdminPasswordResetEmail           = "admin_password_reset_email"
	EventTypeAdminEmailChangeConfirmationEmail = "admin_email_change_confirmation_email"
	EventTypeAdminEmailChangedNoticeEmail      = "admin_email_changed_notice_email"
	EventTypeAdminMfaChangedNoticeEmail        = "admin_mfa_changed_notice_email"
)

// AdminPasswordResetEmailPayload names the reset row the mail is about and
// carries the link's secret, which is the one thing the row cannot give back —
// it stores the hash alone.
type AdminPasswordResetEmailPayload struct {
	TenantID string `json:"tenant_id"`
	TokenID  string `json:"token_id"`
	Token    string `json:"token"`
}

// AdminEmailChangeConfirmationEmailPayload is one event per address to
// confirm. Which side it addresses comes from the token the payload carries,
// since a change request writes one token hash per side.
type AdminEmailChangeConfirmationEmailPayload struct {
	TenantID string `json:"tenant_id"`
	TokenID  string `json:"token_id"`
	Token    string `json:"token"`
}

// AdminEmailChangedNoticeEmailPayload names the completed change request. The
// notice announces an address that is already stored, so it needs no token.
type AdminEmailChangedNoticeEmailPayload struct {
	TenantID string `json:"tenant_id"`
	TokenID  string `json:"token_id"`
}

// AdminMfaChangedNoticeEmailPayload names the console account whose second
// factors changed, what changed, and when. The change leaves nothing behind
// that a handler could read it back from, a removed passkey least of all, so
// the payload is the record of it.
type AdminMfaChangedNoticeEmailPayload struct {
	TenantID  string `json:"tenant_id"`
	UserID    string `json:"user_id"`
	Change    string `json:"change"`
	ChangedAt string `json:"changed_at"`
}

// AdminMfaChangedNoticeEmailEvent is the payload and the idempotency key of
// the notice that change was made to userID's second factors at changedAt.
// Every change is a notice of its own, so the key names the event rather than
// anything the change is about.
func AdminMfaChangedNoticeEmailEvent(tenantID, userID uuid.UUID, change mfaflow.Change, changedAt time.Time) ([]byte, string, error) {
	payload, err := json.Marshal(AdminMfaChangedNoticeEmailPayload{
		TenantID:  tenantID.String(),
		UserID:    userID.String(),
		Change:    string(change),
		ChangedAt: changedAt.UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return nil, "", fmt.Errorf("marshal %s payload: %w", EventTypeAdminMfaChangedNoticeEmail, err)
	}
	key, err := uuid.NewV7()
	if err != nil {
		return nil, "", fmt.Errorf("generate %s key: %w", EventTypeAdminMfaChangedNoticeEmail, err)
	}
	return payload, EventTypeAdminMfaChangedNoticeEmail + ":" + key.String(), nil
}

// NewAdminPasswordResetEmailHandler sends a tenant administrator the link that
// sets a new password. A token row that is gone, completed, or expired is a
// request this event no longer speaks for, and the event is dropped rather than
// delivered.
func NewAdminPasswordResetEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("admin password reset email"); err != nil {
			return err
		}
		var payload AdminPasswordResetEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode admin password reset email payload: %w", err))
		}
		tenantID, tokenID, err := tenantAuthEventIDs(event, payload.TenantID, payload.TokenID)
		if err != nil {
			return Permanent(err)
		}
		if strings.TrimSpace(payload.Token) == "" {
			return Permanent(errors.New("admin password reset email payload has an empty token"))
		}

		resetToken, err := queries.GetUserPasswordResetTokenByHashForTenant(ctx, dbmodels.GetUserPasswordResetTokenByHashForTenantParams{
			TenantID:  tenantID,
			TokenHash: auth.HashToken(payload.Token),
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("load admin password reset token: %w", err)
		}
		if resetToken.ID != tokenID || resetToken.CompletedAt.Valid || !resetToken.ExpiresAt.After(time.Now()) {
			return nil
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}
		admin, err := queries.GetUserByID(ctx, resetToken.UserID)
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("admin user %s no longer exists", resetToken.UserID))
		}
		if err != nil {
			return fmt.Errorf("load admin user: %w", err)
		}
		resetURL, err := tenantAdminConsoleURL(delivery.tenant, "/confirm-password", payload.Token)
		if err != nil {
			return fmt.Errorf("build admin password reset url: %w", err)
		}

		return deliverEmail(ctx, cfg, delivery.settings, admin.Email, emailrenderer.Request{
			Template: "admin_console_password_reset",
			Locale:   delivery.locale,
			Data: map[string]any{
				"expires_at":  resetToken.ExpiresAt.UTC().Format(time.RFC3339Nano),
				"reset_url":   resetURL,
				"tenant_name": delivery.tenantName,
			},
			TimeZone: delivery.timeZone,
		})
	}
}

// NewAdminEmailChangeConfirmationEmailHandler sends one side of an address
// change its confirmation link. The stored token hashes decide which side, so a
// mail can never invite the wrong address to confirm.
func NewAdminEmailChangeConfirmationEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("admin email change confirmation email"); err != nil {
			return err
		}
		var payload AdminEmailChangeConfirmationEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode admin email change confirmation email payload: %w", err))
		}
		tenantID, tokenID, err := tenantAuthEventIDs(event, payload.TenantID, payload.TokenID)
		if err != nil {
			return Permanent(err)
		}
		if strings.TrimSpace(payload.Token) == "" {
			return Permanent(errors.New("admin email change confirmation email payload has an empty token"))
		}

		changeToken, err := queries.GetUserEmailChangeTokenByHashForTenant(ctx, dbmodels.GetUserEmailChangeTokenByHashForTenantParams{
			TenantID:              tenantID,
			CurrentEmailTokenHash: auth.HashToken(payload.Token),
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("load admin email change token: %w", err)
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
		confirmURL, err := tenantAdminConsoleURL(delivery.tenant, "/confirm-email", payload.Token)
		if err != nil {
			return fmt.Errorf("build admin email change confirmation url: %w", err)
		}

		return deliverEmail(ctx, cfg, delivery.settings, recipient, emailrenderer.Request{
			Template: "admin_console_email_change_confirmation",
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
	}
}

// NewAdminEmailChangedNoticeEmailHandler tells the previous address that the
// change went through. The completed request row holds both addresses, so the
// notice names what was actually stored rather than what was asked for.
func NewAdminEmailChangedNoticeEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("admin email changed notice email"); err != nil {
			return err
		}
		var payload AdminEmailChangedNoticeEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode admin email changed notice email payload: %w", err))
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
			return Permanent(fmt.Errorf("admin email change request %s no longer exists", tokenID))
		}
		if err != nil {
			return fmt.Errorf("load admin email change token: %w", err)
		}
		// The event is written in the transaction that completes the change, so
		// an incomplete row means the payload names something else entirely.
		if !changeToken.CompletedAt.Valid {
			return Permanent(fmt.Errorf("admin email change request %s is not completed", tokenID))
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}

		return deliverEmail(ctx, cfg, delivery.settings, changeToken.CurrentEmail, emailrenderer.Request{
			Template: "admin_console_email_changed_notice",
			Locale:   delivery.locale,
			Data: map[string]any{
				"new_email":      changeToken.NewEmail,
				"previous_email": changeToken.CurrentEmail,
				"tenant_name":    delivery.tenantName,
			},
			TimeZone: delivery.timeZone,
		})
	}
}

// adminMfaChanges are the changes a tenant console account is told of.
var adminMfaChanges = []mfaflow.Change{
	mfaflow.ChangeTotpEnabled,
	mfaflow.ChangeTotpDisabled,
	mfaflow.ChangePasskeyRegistered,
	mfaflow.ChangePasskeyRemoved,
	mfaflow.ChangeRecoveryCodesRegenerated,
}

// NewAdminMfaChangedNoticeEmailHandler tells a console account that one of
// its second factors was added or removed, at the address the account holds
// when the mail goes out. An account deleted since has nobody left to tell.
func NewAdminMfaChangedNoticeEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("admin mfa changed notice email"); err != nil {
			return err
		}
		var payload AdminMfaChangedNoticeEmailPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode admin mfa changed notice email payload: %w", err))
		}
		tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
		if err != nil {
			return Permanent(err)
		}
		userID, change, changedAt, err := decodeMfaChange(event, payload.UserID, payload.Change, payload.ChangedAt, adminMfaChanges)
		if err != nil {
			return Permanent(err)
		}

		admin, err := queries.GetUserByID(ctx, userID)
		if errors.Is(err, sql.ErrNoRows) {
			cfg.logDroppedAuthEmail(ctx, event, userID.String(), "user_not_found")
			return nil
		}
		if err != nil {
			return fmt.Errorf("load admin user: %w", err)
		}
		if !admin.TenantID.Valid || admin.TenantID.UUID != tenantID {
			return Permanent(fmt.Errorf("admin user %s is not a member of tenant %s", userID, tenantID))
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}

		return deliverEmail(ctx, cfg, delivery.settings, admin.Email, emailrenderer.Request{
			Template: "admin_console_mfa_changed_notice",
			Locale:   delivery.locale,
			Data: map[string]any{
				"change":      string(change),
				"changed_at":  changedAt.UTC().Format(time.RFC3339Nano),
				"tenant_name": delivery.tenantName,
			},
			TimeZone: delivery.timeZone,
		})
	}
}

// decodeMfaChange checks the account, the change, and the time a second
// factor notice names. A change outside allowed is one this console's
// accounts cannot make, so no mail for it has copy to say it in.
func decodeMfaChange(
	event dbmodels.OutboxEvent,
	accountID, change, changedAt string,
	allowed []mfaflow.Change,
) (uuid.UUID, mfaflow.Change, time.Time, error) {
	parsedID, err := uuid.Parse(accountID)
	if err != nil {
		return uuid.Nil, "", time.Time{}, fmt.Errorf("%s payload has an invalid account id", event.EventType)
	}
	if !slices.Contains(allowed, mfaflow.Change(change)) {
		return uuid.Nil, "", time.Time{}, fmt.Errorf("%s payload has an unknown change %q", event.EventType, change)
	}
	at, err := time.Parse(time.RFC3339Nano, changedAt)
	if err != nil {
		return uuid.Nil, "", time.Time{}, fmt.Errorf("%s payload has an invalid changed_at: %w", event.EventType, err)
	}
	return parsedID, mfaflow.Change(change), at, nil
}
