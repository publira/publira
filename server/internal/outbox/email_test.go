package outbox

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/emailsettings"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

type recordingMailer struct{ sent []internalsmtp.RenderedEmail }

func (m *recordingMailer) SendRenderedEmail(
	_ context.Context,
	_ emailsettings.SMTPSettings,
	_ string,
	email internalsmtp.RenderedEmail,
) error {
	m.sent = append(m.sent, email)
	return nil
}

type stubRenderer struct {
	html string
	err  error
}

func (r stubRenderer) Render(context.Context, emailrenderer.Request) (emailrenderer.Email, error) {
	return emailrenderer.Email{HTML: r.html}, r.err
}

const passwordResetURL = "https://reader.example.test/confirm-password?token=reset"

func passwordResetRequest() emailrenderer.Request {
	return emailrenderer.Request{
		Template: "reader_password_reset",
		Locale:   "en",
		Data: map[string]any{
			"expires_at":  "2030-01-15T12:00:00Z",
			"reset_url":   passwordResetURL,
			"tenant_name": "Aoto Press",
		},
		TimeZone: "Asia/Tokyo",
	}
}

// A worker started without a renderer is a deployment that runs none, so its
// mail goes out as the text the worker composed rather than waiting for a
// service that is not there.
func TestDeliverEmailWithoutARendererSendsTextOnly(t *testing.T) {
	mailer := &recordingMailer{}

	if err := deliverEmail(
		t.Context(),
		EmailHandlerConfig{Mailer: mailer},
		emailsettings.SMTPSettings{},
		"reader@example.com",
		passwordResetRequest(),
	); err != nil {
		t.Fatalf("deliverEmail: %v", err)
	}

	if len(mailer.sent) != 1 {
		t.Fatalf("sent %d emails, want 1", len(mailer.sent))
	}
	email := mailer.sent[0]
	if email.HTML != "" {
		t.Errorf("html = %q, want none", email.HTML)
	}
	if strings.TrimSpace(email.Subject) == "" {
		t.Error("the mail has no subject")
	}
	if !strings.Contains(email.Text, passwordResetURL) {
		t.Errorf("text = %q", email.Text)
	}
}

func TestDeliverEmailWithARendererSendsBothAlternatives(t *testing.T) {
	mailer := &recordingMailer{}

	if err := deliverEmail(
		t.Context(),
		EmailHandlerConfig{Mailer: mailer, Renderer: stubRenderer{html: "<p>Reset</p>"}},
		emailsettings.SMTPSettings{},
		"reader@example.com",
		passwordResetRequest(),
	); err != nil {
		t.Fatalf("deliverEmail: %v", err)
	}

	if len(mailer.sent) != 1 {
		t.Fatalf("sent %d emails, want 1", len(mailer.sent))
	}
	if got := mailer.sent[0].HTML; got != "<p>Reset</p>" {
		t.Errorf("html = %q", got)
	}
	if strings.TrimSpace(mailer.sent[0].Text) == "" {
		t.Error("the mail has no text alternative")
	}
}

// A renderer the worker was given and cannot use is a fault to retry, not a
// mail to quietly downgrade to text.
func TestDeliverEmailKeepsAConfiguredRendererRequired(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		renderer stubRenderer
	}{
		{name: "the renderer is unreachable", renderer: stubRenderer{err: errors.New("connection refused")}},
		{name: "the renderer answers with no html", renderer: stubRenderer{html: "  "}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			mailer := &recordingMailer{}

			err := deliverEmail(
				t.Context(),
				EmailHandlerConfig{Mailer: mailer, Renderer: testCase.renderer},
				emailsettings.SMTPSettings{},
				"reader@example.com",
				passwordResetRequest(),
			)
			if err == nil {
				t.Fatal("deliverEmail accepted a renderer that produced no html")
			}
			if IsPermanent(err) {
				t.Errorf("error = %v, want a retriable one", err)
			}
			if len(mailer.sent) != 0 {
				t.Errorf("sent %d emails, want none", len(mailer.sent))
			}
		})
	}
}
