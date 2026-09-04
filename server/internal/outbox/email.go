package outbox

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/emailsettings"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

// EmailHandlerConfig provides the worker-owned dependencies every mail handler
// needs. One type rather than one per handler family: the worker resolves these
// four once at startup and hands the same set to each registration.
type EmailHandlerConfig struct {
	DB        *sql.DB
	Encryptor emailsettings.SecretManager
	Mailer    internalsmtp.RenderedSender
	Renderer  emailrenderer.Renderer
}

// require reports a dependency the process was started without. It is a plain
// error rather than a [Permanent] one, because an operator restoring the
// renderer or the SMTP client makes a pending event deliverable again.
func (cfg EmailHandlerConfig) require(kind string) error {
	switch {
	case cfg.DB == nil:
		return fmt.Errorf("%s handler database is not configured", kind)
	case cfg.Mailer == nil:
		return fmt.Errorf("%s handler smtp sender is not configured", kind)
	case cfg.Renderer == nil:
		return fmt.Errorf("%s handler email renderer is not configured", kind)
	default:
		return nil
	}
}

func sendRenderedEmail(
	ctx context.Context,
	mailer internalsmtp.RenderedSender,
	settings emailsettings.SMTPSettings,
	recipient string,
	email emailrenderer.Email,
) error {
	return mailer.SendRenderedEmail(ctx, settings, recipient, internalsmtp.RenderedEmail{
		Subject: email.Subject,
		HTML:    email.HTML,
		Text:    email.Text,
	})
}
