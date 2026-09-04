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
)

const defaultPlatformAppURL = "http://platform.localhost:3080"

// PlatformPasswordResetEmailPayload names the token row the mail is about and
// carries the link's secret, which is the one thing the row cannot give back.
type PlatformPasswordResetEmailPayload struct {
	TokenID string `json:"token_id"`
	Token   string `json:"token"`
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

// NewPlatformPasswordResetEmailHandler sends the platform operator's password
// reset link. A token row that is gone, completed, or expired is a request this
// event no longer speaks for, and the event is dropped rather than delivered.
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
			return nil
		}
		if err != nil {
			return fmt.Errorf("load platform password reset token: %w", err)
		}
		if resetToken.ID != tokenID || resetToken.CompletedAt.Valid || !resetToken.ExpiresAt.After(time.Now()) {
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
		resetURL, err := platformConsoleURL("/confirm-password", payload.Token)
		if err != nil {
			return fmt.Errorf("build platform password reset url: %w", err)
		}

		rendered, err := cfg.Renderer.Render(ctx, emailrenderer.Request{
			Template: "platform_console_password_reset",
			Locale:   delivery.locale,
			Data: map[string]any{
				"expires_at": resetToken.ExpiresAt.UTC().Format(time.RFC3339Nano),
				"reset_url":  resetURL,
			},
			TimeZone: delivery.timeZone,
		})
		if err != nil {
			return fmt.Errorf("render platform password reset email: %w", err)
		}
		if err := sendRenderedEmail(ctx, cfg.Mailer, delivery.settings, operator.Email, rendered); err != nil {
			return fmt.Errorf("send platform password reset email: %w", err)
		}
		return nil
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
			return nil
		}
		if err != nil {
			return fmt.Errorf("load platform email change token: %w", err)
		}
		if changeToken.ID != tokenID || changeToken.CompletedAt.Valid || !changeToken.ExpiresAt.After(time.Now()) {
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

		rendered, err := cfg.Renderer.Render(ctx, emailrenderer.Request{
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
		if err != nil {
			return fmt.Errorf("render platform email change confirmation email: %w", err)
		}
		if err := sendRenderedEmail(ctx, cfg.Mailer, delivery.settings, recipient, rendered); err != nil {
			return fmt.Errorf("send platform email change confirmation email: %w", err)
		}
		return nil
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

		rendered, err := cfg.Renderer.Render(ctx, emailrenderer.Request{
			Template: "platform_console_email_changed_notice",
			Locale:   delivery.locale,
			Data: map[string]any{
				"new_email":      changeToken.NewEmail,
				"previous_email": changeToken.CurrentEmail,
			},
			TimeZone: delivery.timeZone,
		})
		if err != nil {
			return fmt.Errorf("render platform email changed notice email: %w", err)
		}
		if err := sendRenderedEmail(ctx, cfg.Mailer, delivery.settings, changeToken.CurrentEmail, rendered); err != nil {
			return fmt.Errorf("send platform email changed notice email: %w", err)
		}
		return nil
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
	return payload, tokenID, nil
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

// platformConsoleURL builds a link into the platform console. The worker runs
// outside the request that produced the event, so the console's origin comes
// from PUBLIRA_PLATFORM_APP_URL rather than from an incoming Host header.
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
	query := target.Query()
	query.Set("token", token)
	target.RawQuery = query.Encode()
	return target.String(), nil
}
