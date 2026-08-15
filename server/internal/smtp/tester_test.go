package smtp

import (
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/emailsettings"
)

func TestBuildMessageWithHTMLAddsAlternatives(t *testing.T) {
	message := buildMessage(emailsettings.SMTPSettings{FromAddress: "from@example.com"}, "to@example.com", RenderedEmail{
		Subject: "Invitation",
		Text:    "Open the invitation",
		HTML:    "<p>Open the invitation</p>",
	})

	for _, value := range []string{
		"Content-Type: multipart/alternative",
		"Content-Type: text/plain; charset=UTF-8",
		"Open the invitation",
		"Content-Type: text/html; charset=UTF-8",
		"<p>Open the invitation</p>",
	} {
		if !strings.Contains(message, value) {
			t.Fatalf("message does not contain %q:\n%s", value, message)
		}
	}
}

func TestBuildMessageWithoutHTMLRemainsPlainText(t *testing.T) {
	message := buildMessage(emailsettings.SMTPSettings{FromAddress: "from@example.com"}, "to@example.com", RenderedEmail{
		Subject: "Test",
		Text:    "Plain text",
	})
	if !strings.Contains(message, "Content-Type: text/plain; charset=UTF-8") {
		t.Fatalf("message = %q", message)
	}
	if strings.Contains(message, "multipart/alternative") {
		t.Fatalf("message unexpectedly has alternatives: %q", message)
	}
}
