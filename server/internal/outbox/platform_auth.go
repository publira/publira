package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
)

// The platform console's own auth mail. These events carry no tenant_id: the
// platform operator belongs to no tenant, so the handlers resolve the platform
// SMTP settings and the platform default locale and time zone.
const (
	EventTypePlatformPasswordResetEmail           = "platform_password_reset_email"
	EventTypePlatformEmailChangeConfirmationEmail = "platform_email_change_confirmation_email"
	EventTypePlatformEmailChangedNoticeEmail      = "platform_email_changed_notice_email"
	EventTypePlatformOperatorRoleGrantedEmail     = "platform_operator_role_granted_email"
)

// PlatformPasswordLinkOperatorAdded is the purpose of the password link mailed
// to an operator whose account a Super admin just created. The account starts
// with a password nobody is told, so the link is how its first password is set:
// it is issued, expires, and is consumed exactly as a reset link is, and only
// the mail around it says why it came.
const PlatformPasswordLinkOperatorAdded = "operator_added"

const defaultPlatformAppURL = "http://platform.localhost:3080"

// platformUserStatusActive is the platform_users status of an account that can
// sign in; a suspended or an inactive one cannot.
const platformUserStatusActive = "active"

// PlatformPasswordResetEmailPayload names the token row the mail is about and
// carries the link's secret, which is the one thing the row cannot give back.
type PlatformPasswordResetEmailPayload struct {
	TokenID string `json:"token_id"`
	Token   string `json:"token"`
	// Purpose picks the mail, as PlatformPasswordResetRequestPayload.Purpose
	// does: empty for a reset.
	Purpose string `json:"purpose,omitempty"`
}

// PlatformEmailChangeConfirmationEmailPayload is one event per address to
// confirm. Which side it addresses comes from the token the payload carries,
// since a change request writes one token hash per side.
type PlatformEmailChangeConfirmationEmailPayload struct {
	TokenID string `json:"token_id"`
	Token   string `json:"token"`
}

// PlatformEmailChangedNoticeEmailPayload names the completed change request.
// The notice announces an address that is already stored, so it needs no token.
type PlatformEmailChangedNoticeEmailPayload struct {
	TokenID string `json:"token_id"`
}

// PlatformOperatorRoleGrantedEmailPayload names the platform user a Super admin
// gave a role to when the address already had an account. That account has a
// password of its own, so the mail carries no link that sets one.
type PlatformOperatorRoleGrantedEmailPayload struct {
	PlatformUserID string `json:"platform_user_id"`
}

// NewPlatformPasswordResetEmailHandler sends the platform operator's password
// link: a reset, or the first password of an account just added. A token row
// that is gone, completed, or expired is a request this event no longer speaks
// for, and the event is dropped rather than delivered.
func NewPlatformPasswordResetEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("platform password reset email"); err != nil {
			return err
		}
		payload, tokenID, err := decodePlatformPasswordResetEmailPayload(event)
		if err != nil {
			return Permanent(err)
		}

		resetToken, err := queries.GetPlatformUserPasswordResetTokenByHash(ctx, auth.HashToken(payload.Token))
		if errors.Is(err, sql.ErrNoRows) {
			cfg.logDroppedAuthEmail(ctx, event, tokenID.String(), "token_not_found")
			return nil
		}
		if err != nil {
			return fmt.Errorf("load platform password reset token: %w", err)
		}
		if resetToken.ID != tokenID {
			cfg.logDroppedAuthEmail(ctx, event, tokenID.String(), "token_id_mismatch")
			return nil
		}
		if resetToken.CompletedAt.Valid {
			cfg.logDroppedAuthEmail(ctx, event, tokenID.String(), "token_completed")
			return nil
		}
		if !resetToken.ExpiresAt.After(time.Now()) {
			cfg.logDroppedAuthEmail(ctx, event, tokenID.String(), "token_expired")
			return nil
		}

		delivery, err := resolvePlatformDelivery(ctx, queries, cfg.Encryptor)
		if err != nil {
			return err
		}
		operator, err := queries.GetPlatformUserByID(ctx, resetToken.PlatformUserID)
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("platform user %s no longer exists", resetToken.PlatformUserID))
		}
		if err != nil {
			return fmt.Errorf("load platform user: %w", err)
		}
		// A reset was asked for by whoever holds the address, so it goes out
		// whatever the account's status. The mail to an added operator says the
		// account is ready to use, which stops being true once it is suspended
		// or deactivated.
		if payload.Purpose == PlatformPasswordLinkOperatorAdded && operator.Status != platformUserStatusActive {
			cfg.logDroppedAuthEmail(ctx, event, tokenID.String(), "operator_not_active")
			return nil
		}
		resetURL, err := platformConsoleURL("/confirm-password", payload.Token)
		if err != nil {
			return fmt.Errorf("build platform password reset url: %w", err)
		}
		expiresAt := resetToken.ExpiresAt.UTC().Format(time.RFC3339Nano)

		request := emailrenderer.Request{
			Template: "platform_console_password_reset",
			Locale:   delivery.locale,
			Data: map[string]any{
				"expires_at": expiresAt,
				"reset_url":  resetURL,
			},
			TimeZone: delivery.timeZone,
		}
		if payload.Purpose == PlatformPasswordLinkOperatorAdded {
			request.Template = "platform_console_operator_added"
			request.Data = map[string]any{
				"expires_at":       expiresAt,
				"set_password_url": resetURL,
			}
		}
		return deliverEmail(ctx, cfg, delivery.settings, operator.Email, request)
	}
}

// NewPlatformOperatorRoleGrantedEmailHandler tells a platform user who already
// had an account that a Super admin gave it a role, so they can now sign in to
// the console with the password they have.
func NewPlatformOperatorRoleGrantedEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("platform operator role granted email"); err != nil {
			return err
		}
		userID, err := decodePlatformOperatorRoleGrantedEmailPayload(event)
		if err != nil {
			return Permanent(err)
		}

		operator, err := queries.GetPlatformUserByID(ctx, userID)
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("platform user %s no longer exists", userID))
		}
		if err != nil {
			return fmt.Errorf("load platform user: %w", err)
		}
		// The mail says the account can sign in. A role is only ever replaced,
		// never taken away, so the account's status is what can make that
		// untrue between the grant and the delivery.
		if operator.Status != platformUserStatusActive {
			cfg.logDroppedAuthEmail(ctx, event, userID.String(), "operator_not_active")
			return nil
		}

		delivery, err := resolvePlatformDelivery(ctx, queries, cfg.Encryptor)
		if err != nil {
			return err
		}
		signInURL, err := platformConsoleURL("/login", "")
		if err != nil {
			return fmt.Errorf("build platform sign-in url: %w", err)
		}

		return deliverEmail(ctx, cfg, delivery.settings, operator.Email, emailrenderer.Request{
			Template: "platform_console_operator_role_granted",
			Locale:   delivery.locale,
			Data: map[string]any{
				"sign_in_url": signInURL,
			},
			TimeZone: delivery.timeZone,
		})
	}
}

// NewPlatformEmailChangeConfirmationEmailHandler sends one side of an address
// change its confirmation link. The stored token hashes decide which side, so a
// mail can never invite the wrong address to confirm.
func NewPlatformEmailChangeConfirmationEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("platform email change confirmation email"); err != nil {
			return err
		}
		payload, tokenID, err := decodePlatformEmailChangeConfirmationEmailPayload(event)
		if err != nil {
			return Permanent(err)
		}

		changeToken, err := queries.GetPlatformUserEmailChangeTokenByHash(ctx, auth.HashToken(payload.Token))
		if errors.Is(err, sql.ErrNoRows) {
			cfg.logDroppedAuthEmail(ctx, event, tokenID.String(), "token_not_found")
			return nil
		}
		if err != nil {
			return fmt.Errorf("load platform email change token: %w", err)
		}
		if changeToken.ID != tokenID {
			cfg.logDroppedAuthEmail(ctx, event, tokenID.String(), "token_id_mismatch")
			return nil
		}
		if changeToken.CompletedAt.Valid {
			cfg.logDroppedAuthEmail(ctx, event, tokenID.String(), "token_completed")
			return nil
		}
		if !changeToken.ExpiresAt.After(time.Now()) {
			cfg.logDroppedAuthEmail(ctx, event, tokenID.String(), "token_expired")
			return nil
		}
		recipient := changeToken.CurrentEmail
		if changeToken.MatchedTarget == "new_email" {
			recipient = changeToken.NewEmail
		}

		delivery, err := resolvePlatformDelivery(ctx, queries, cfg.Encryptor)
		if err != nil {
			return err
		}
		confirmURL, err := platformConsoleURL("/confirm-email", payload.Token)
		if err != nil {
			return fmt.Errorf("build platform email change confirmation url: %w", err)
		}

		return deliverEmail(ctx, cfg, delivery.settings, recipient, emailrenderer.Request{
			Template: "platform_console_email_change_confirmation",
			Locale:   delivery.locale,
			Data: map[string]any{
				"confirm_url":    confirmURL,
				"current_email":  changeToken.CurrentEmail,
				"expires_at":     changeToken.ExpiresAt.UTC().Format(time.RFC3339Nano),
				"new_email":      changeToken.NewEmail,
				"recipient_kind": changeToken.MatchedTarget,
			},
			TimeZone: delivery.timeZone,
		})
	}
}

// NewPlatformEmailChangedNoticeEmailHandler tells the previous address that the
// change went through. The completed request row holds both addresses, so the
// notice names what was actually stored rather than what was asked for.
func NewPlatformEmailChangedNoticeEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("platform email changed notice email"); err != nil {
			return err
		}
		tokenID, err := decodePlatformEmailChangedNoticeEmailPayload(event)
		if err != nil {
			return Permanent(err)
		}

		changeToken, err := queries.GetPlatformUserEmailChangeTokenByID(ctx, tokenID)
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("platform email change request %s no longer exists", tokenID))
		}
		if err != nil {
			return fmt.Errorf("load platform email change token: %w", err)
		}
		// The event is written in the transaction that completes the change, so
		// an incomplete row means the payload names something else entirely.
		if !changeToken.CompletedAt.Valid {
			return Permanent(fmt.Errorf("platform email change request %s is not completed", tokenID))
		}

		delivery, err := resolvePlatformDelivery(ctx, queries, cfg.Encryptor)
		if err != nil {
			return err
		}

		return deliverEmail(ctx, cfg, delivery.settings, changeToken.CurrentEmail, emailrenderer.Request{
			Template: "platform_console_email_changed_notice",
			Locale:   delivery.locale,
			Data: map[string]any{
				"new_email":      changeToken.NewEmail,
				"previous_email": changeToken.CurrentEmail,
			},
			TimeZone: delivery.timeZone,
		})
	}
}

func decodePlatformPasswordResetEmailPayload(event dbmodels.OutboxEvent) (PlatformPasswordResetEmailPayload, uuid.UUID, error) {
	var payload PlatformPasswordResetEmailPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return payload, uuid.Nil, fmt.Errorf("decode platform password reset email payload: %w", err)
	}
	tokenID, err := platformAuthEventTokenID(event, payload.TokenID)
	if err != nil {
		return payload, uuid.Nil, err
	}
	if strings.TrimSpace(payload.Token) == "" {
		return payload, uuid.Nil, errors.New("platform password reset email payload has an empty token")
	}
	if err := checkPlatformPasswordLinkPurpose(event, payload.Purpose); err != nil {
		return payload, uuid.Nil, err
	}
	return payload, tokenID, nil
}

// checkPlatformPasswordLinkPurpose refuses a purpose this worker has no mail
// for, rather than sending such a link in a reset mail nobody asked for.
func checkPlatformPasswordLinkPurpose(event dbmodels.OutboxEvent, purpose string) error {
	switch purpose {
	case "", PlatformPasswordLinkOperatorAdded:
		return nil
	default:
		return fmt.Errorf("%s payload has an unknown purpose %q", event.EventType, purpose)
	}
}

func decodePlatformOperatorRoleGrantedEmailPayload(event dbmodels.OutboxEvent) (uuid.UUID, error) {
	var payload PlatformOperatorRoleGrantedEmailPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, fmt.Errorf("decode platform operator role granted email payload: %w", err)
	}
	if event.TenantID.Valid {
		return uuid.Nil, fmt.Errorf("%s event belongs to no tenant but names %s", event.EventType, event.TenantID.UUID)
	}
	userID, err := uuid.Parse(payload.PlatformUserID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%s payload has an invalid platform_user_id", event.EventType)
	}
	return userID, nil
}

func decodePlatformEmailChangeConfirmationEmailPayload(event dbmodels.OutboxEvent) (PlatformEmailChangeConfirmationEmailPayload, uuid.UUID, error) {
	var payload PlatformEmailChangeConfirmationEmailPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return payload, uuid.Nil, fmt.Errorf("decode platform email change confirmation email payload: %w", err)
	}
	tokenID, err := platformAuthEventTokenID(event, payload.TokenID)
	if err != nil {
		return payload, uuid.Nil, err
	}
	if strings.TrimSpace(payload.Token) == "" {
		return payload, uuid.Nil, errors.New("platform email change confirmation email payload has an empty token")
	}
	return payload, tokenID, nil
}

func decodePlatformEmailChangedNoticeEmailPayload(event dbmodels.OutboxEvent) (uuid.UUID, error) {
	var payload PlatformEmailChangedNoticeEmailPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, fmt.Errorf("decode platform email changed notice email payload: %w", err)
	}
	return platformAuthEventTokenID(event, payload.TokenID)
}

// platformAuthEventTokenID checks what every platform auth event shares: it
// names no tenant, and its token_id points at a row the handler can reload.
func platformAuthEventTokenID(event dbmodels.OutboxEvent, tokenID string) (uuid.UUID, error) {
	if event.TenantID.Valid {
		return uuid.Nil, fmt.Errorf("%s event belongs to no tenant but names %s", event.EventType, event.TenantID.UUID)
	}
	parsed, err := uuid.Parse(tokenID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%s payload has an invalid token_id", event.EventType)
	}
	return parsed, nil
}

// platformDelivery is what every platform auth mail needs beyond its own row:
// the language and zone the platform console is configured in, and where to
// hand the message to.
type platformDelivery struct {
	locale   string
	settings emailsettings.SMTPSettings
	timeZone string
}

// resolvePlatformDelivery reads the locale before the SMTP settings on purpose.
// A platform default locale no catalog covers will not start rendering after a
// retry, and an SMTP outage must not disguise it as a failure that can.
func resolvePlatformDelivery(
	ctx context.Context,
	queries *dbmodels.Queries,
	encryptor emailsettings.SecretManager,
) (platformDelivery, error) {
	timeZone, platformLocale, err := platformconfig.Defaults(ctx, queries)
	if err != nil {
		if errors.Is(err, locale.ErrUnresolved) {
			return platformDelivery{}, Permanent(fmt.Errorf("resolve platform default locale: %w", err))
		}
		return platformDelivery{}, err
	}
	settings, err := resolvePlatformSMTPSettings(ctx, queries, encryptor)
	if err != nil {
		return platformDelivery{}, fmt.Errorf("resolve platform smtp settings: %w", err)
	}
	return platformDelivery{locale: platformLocale, settings: settings, timeZone: timeZone}, nil
}

// resolvePlatformSMTPSettings is the platform-only half of resolveSMTPSettings:
// mail that belongs to no tenant can never be sent through a tenant override.
func resolvePlatformSMTPSettings(
	ctx context.Context,
	queries *dbmodels.Queries,
	encryptor emailsettings.SecretManager,
) (emailsettings.SMTPSettings, error) {
	config, err := queries.GetPlatformSMTPConfig(ctx)
	if err != nil {
		return emailsettings.SMTPSettings{}, err
	}
	password, err := emailsettings.DecryptPassword(config.PasswordEncrypted, encryptor)
	if err != nil {
		return emailsettings.SMTPSettings{}, err
	}
	settings := platformSMTPSettings(config, password)
	if err := emailsettings.Validate(settings, true); err != nil {
		return emailsettings.SMTPSettings{}, err
	}
	return settings, nil
}

// platformConsoleURL builds a link into the platform console, carrying token
// when there is one. The worker runs outside the request that produced the
// event, so the console's origin comes from PUBLIRA_PLATFORM_APP_URL rather
// than from an incoming Host header.
func platformConsoleURL(path, token string) (string, error) {
	baseURL := strings.TrimSpace(os.Getenv("PUBLIRA_PLATFORM_APP_URL"))
	if baseURL == "" {
		baseURL = defaultPlatformAppURL
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("platform app url is invalid")
	}

	target := parsed.ResolveReference(&url.URL{Path: path})
	if token != "" {
		query := target.Query()
		query.Set("token", token)
		target.RawQuery = query.Encode()
	}
	return target.String(), nil
}
