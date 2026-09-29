package outbox

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/emailsettings"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

// EmailHandlerConfig provides the worker-owned dependencies every mail handler
// needs. One type rather than one per handler family: the worker resolves these
// five once at startup and hands the same set to each registration. Renderer is
// the one that may be absent, and a nil one means text-only mail.
type EmailHandlerConfig struct {
	DB        *sql.DB
	Encryptor emailsettings.SecretManager
	Logger    *slog.Logger
	Mailer    internalsmtp.RenderedSender
	Renderer  emailrenderer.Renderer
}

// require reports a dependency the process was started without. It is a plain
// error rather than a [Permanent] one, because an operator restoring the SMTP
// client makes a pending event deliverable again.
func (cfg EmailHandlerConfig) require(kind string) error {
	switch {
	case cfg.DB == nil:
		return fmt.Errorf("%s handler database is not configured", kind)
	case cfg.Mailer == nil:
		return fmt.Errorf("%s handler smtp sender is not configured", kind)
	default:
		return nil
	}
}

// logDroppedAuthEmail records an event the handler intentionally completes
// without delivering. A nil logger keeps direct handler tests and embedders
// that do not own a worker compatible; the outbox worker always supplies its
// configured logger.
func (cfg EmailHandlerConfig) logDroppedAuthEmail(
	ctx context.Context,
	event dbmodels.OutboxEvent,
	tokenID string,
	reason string,
) {
	if cfg.Logger == nil {
		return
	}
	cfg.Logger.WarnContext(ctx, "dropped auth email event",
		"event_id", event.ID,
		"event_type", event.EventType,
		"token_id", tokenID,
		"reason", reason,
	)
}

// deliverEmail sends one mail. Its subject line and its plain-text alternative
// are composed here from the shared catalogs, so a failure to word the mail is
// permanent, while a renderer that is down is an attempt the worker can repeat.
// A worker started without a renderer adds no HTML part and sends the mail as
// text alone; one that answers with no HTML has failed and is retried.
func deliverEmail(
	ctx context.Context,
	cfg EmailHandlerConfig,
	settings emailsettings.SMTPSettings,
	recipient string,
	request emailrenderer.Request,
) error {
	email, err := emailCopy(request)
	if err != nil {
		return Permanent(err)
	}
	if cfg.Renderer != nil {
		rendered, err := cfg.Renderer.Render(ctx, request)
		if err != nil {
			return fmt.Errorf("render %s email: %w", request.Template, err)
		}
		if strings.TrimSpace(rendered.HTML) == "" {
			return fmt.Errorf("render %s email: the renderer returned no html", request.Template)
		}
		email.HTML = rendered.HTML
	}

	if err := cfg.Mailer.SendRenderedEmail(ctx, settings, recipient, email); err != nil {
		return fmt.Errorf("send %s email: %w", request.Template, err)
	}
	return nil
}
