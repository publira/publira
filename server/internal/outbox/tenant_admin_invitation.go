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
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/platformconfig"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/tenanttz"
)

// EventTypeTenantAdminInvitationEmail sends a tenant administrator invitation.
const EventTypeTenantAdminInvitationEmail = "tenant_admin_invitation_email"

// TenantAdminInvitationPayload is deliberately small. The worker reloads the
// current invitation and tenant so a canceled, accepted, or superseded invite
// cannot send an obsolete email.
type TenantAdminInvitationPayload struct {
	TenantID     string `json:"tenant_id"`
	InvitationID string `json:"invitation_id"`
	Token        string `json:"token"`
}

// TenantAdminInvitationHandlerConfig provides the worker-owned dependencies
// needed to render and deliver invitation email.
type TenantAdminInvitationHandlerConfig struct {
	DB        *sql.DB
	Encryptor emailsettings.SecretManager
	Mailer    internalsmtp.RenderedSender
	Renderer  emailrenderer.Renderer
}

// NewTenantAdminInvitationHandler creates the handler used by the resident
// outbox worker. Missing runtime dependencies are retried, since operators may
// restore the renderer or SMTP configuration while an event is pending.
func NewTenantAdminInvitationHandler(cfg TenantAdminInvitationHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil {
			return errors.New("tenant admin invitation handler database is not configured")
		}
		if cfg.Mailer == nil {
			return errors.New("tenant admin invitation handler smtp sender is not configured")
		}
		if cfg.Renderer == nil {
			return errors.New("tenant admin invitation handler email renderer is not configured")
		}

		payload, err := decodeTenantAdminInvitationPayload(event)
		if err != nil {
			return Permanent(err)
		}
		tenantID, _ := uuid.Parse(payload.TenantID)
		invitationID, _ := uuid.Parse(payload.InvitationID)

		tenant, err := queries.GetTenantByID(ctx, tenantID)
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("tenant admin invitation tenant %s no longer exists", tenantID))
		}
		if err != nil {
			return fmt.Errorf("load invitation tenant: %w", err)
		}
		invitation, err := queries.GetTenantAdminInvitationByIDForTenant(ctx, dbmodels.GetTenantAdminInvitationByIDForTenantParams{
			TenantID: tenantID,
			ID:       invitationID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("tenant admin invitation %s no longer exists", invitationID))
		}
		if err != nil {
			return fmt.Errorf("load tenant admin invitation: %w", err)
		}

		// A resend changes the token hash. Never deliver a stale link if its
		// earlier event has not been processed yet.
		if invitation.AcceptedAt.Valid || invitation.CanceledAt.Valid || !invitation.ExpiresAt.After(time.Now()) || invitation.TokenHash != auth.HashToken(payload.Token) {
			return nil
		}

		settings, err := resolveSMTPSettings(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return fmt.Errorf("resolve smtp settings: %w", err)
		}
		rendered, err := renderTenantAdminInvitation(ctx, queries, cfg.Renderer, tenant, invitation, payload.Token)
		if err != nil {
			return fmt.Errorf("render tenant admin invitation: %w", err)
		}
		if err := cfg.Mailer.SendRenderedEmail(ctx, settings, invitation.Email, internalsmtp.RenderedEmail{
			Subject: rendered.Subject,
			HTML:    rendered.HTML,
			Text:    rendered.Text,
		}); err != nil {
			return fmt.Errorf("send tenant admin invitation: %w", err)
		}
		return nil
	}
}

func decodeTenantAdminInvitationPayload(event dbmodels.OutboxEvent) (TenantAdminInvitationPayload, error) {
	var payload TenantAdminInvitationPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return TenantAdminInvitationPayload{}, fmt.Errorf("decode tenant admin invitation payload: %w", err)
	}
	tenantID, err := uuid.Parse(payload.TenantID)
	if err != nil || !event.TenantID.Valid || tenantID != event.TenantID.UUID {
		return TenantAdminInvitationPayload{}, errors.New("tenant admin invitation payload has an invalid tenant_id")
	}
	if _, err := uuid.Parse(payload.InvitationID); err != nil {
		return TenantAdminInvitationPayload{}, errors.New("tenant admin invitation payload has an invalid invitation_id")
	}
	if strings.TrimSpace(payload.Token) == "" {
		return TenantAdminInvitationPayload{}, errors.New("tenant admin invitation payload has an empty token")
	}
	return payload, nil
}

func resolveSMTPSettings(ctx context.Context, queries *dbmodels.Queries, tenantID uuid.UUID, encryptor emailsettings.SecretManager) (emailsettings.SMTPSettings, error) {
	tenantConfig, err := queries.GetTenantSMTPConfigByTenantID(ctx, tenantID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return emailsettings.SMTPSettings{}, err
	}
	if err == nil && tenantConfig.SmtpOverrideEnabled {
		password, err := emailsettings.DecryptPassword(tenantConfig.PasswordEncrypted.String, encryptor)
		if err != nil {
			return emailsettings.SMTPSettings{}, err
		}
		settings := tenantSMTPSettings(tenantConfig, password)
		if err := emailsettings.Validate(settings, true); err != nil {
			return emailsettings.SMTPSettings{}, err
		}
		return settings, nil
	}

	platformConfig, err := queries.GetPlatformSMTPConfig(ctx)
	if err != nil {
		return emailsettings.SMTPSettings{}, err
	}
	password, err := emailsettings.DecryptPassword(platformConfig.PasswordEncrypted, encryptor)
	if err != nil {
		return emailsettings.SMTPSettings{}, err
	}
	settings := platformSMTPSettings(platformConfig, password)
	if err := emailsettings.Validate(settings, true); err != nil {
		return emailsettings.SMTPSettings{}, err
	}
	return settings, nil
}

func tenantSMTPSettings(config dbmodels.TenantSmtpConfig, password string) emailsettings.SMTPSettings {
	settings := emailsettings.SMTPSettings{Password: password}
	if config.Host.Valid {
		settings.Host = config.Host.String
	}
	if config.Port.Valid {
		settings.Port = config.Port.Int32
	}
	if config.Username.Valid {
		settings.Username = config.Username.String
	}
	if config.Encryption.Valid {
		settings.Encryption = config.Encryption.String
	}
	if config.FromName.Valid {
		settings.FromName = config.FromName.String
	}
	if config.FromAddress.Valid {
		settings.FromAddress = config.FromAddress.String
	}
	if config.ReplyTo.Valid {
		settings.ReplyTo = config.ReplyTo.String
	}
	return settings
}

func platformSMTPSettings(config dbmodels.PlatformSmtpConfig, password string) emailsettings.SMTPSettings {
	settings := emailsettings.SMTPSettings{Host: config.Host, Port: config.Port, Username: config.Username, Password: password, Encryption: config.Encryption, FromAddress: config.FromAddress}
	if config.ReplyTo.Valid {
		settings.ReplyTo = config.ReplyTo.String
	}
	return settings
}

func renderTenantAdminInvitation(ctx context.Context, queries *dbmodels.Queries, renderer emailrenderer.Renderer, tenant dbmodels.Tenant, invitation dbmodels.TenantAdminInvitation, token string) (emailrenderer.Email, error) {
	inviteURL, err := tenantAdminInvitationURL(tenant, token)
	if err != nil {
		return emailrenderer.Email{}, err
	}
	tenantName := strings.TrimSpace(tenant.Name)
	if tenantName == "" {
		tenantName = "Publira"
	}
	// The invitation is worded in the tenant's saved language, and in no other:
	// a stored code the renderer has no catalog for is a permanent failure the
	// operator has to fix, not a reason to mail the invitee in a language their
	// tenant never chose.
	tenantLocale, err := locale.Resolve(tenant.DefaultLocale)
	if err != nil {
		return emailrenderer.Email{}, Permanent(fmt.Errorf("resolve default locale of tenant %s: %w", tenant.ID, err))
	}
	return renderer.Render(ctx, emailrenderer.Request{
		Template: "tenant_admin_invitation",
		Locale:   tenantLocale,
		Data:     map[string]any{"expires_at": invitation.ExpiresAt.UTC().Format(time.RFC3339Nano), "invite_url": inviteURL, "tenant_name": tenantName},
		TimeZone: tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries)),
	})
}

func tenantAdminInvitationURL(tenant dbmodels.Tenant, token string) (string, error) {
	domain := strings.TrimSpace(tenant.Domain)
	if tenant.AdminDomain.Valid && strings.TrimSpace(tenant.AdminDomain.String) != "" {
		domain = strings.TrimSpace(tenant.AdminDomain.String)
	} else if domain != "" {
		domain = "admin." + domain
	}
	domain = strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(domain, "https://"), "http://"), "/")
	if domain == "" {
		return "", errors.New("tenant admin domain is not configured")
	}
	return "https://" + domain + "/accept-invite?token=" + url.QueryEscape(token), nil
}
