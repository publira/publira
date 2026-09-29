package smtp

import (
	"context"
	"errors"
	"io"
	"mime"
	"mime/quotedprintable"
	"net/mail"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/rpcerrors"
)

func TestTestFailureReasonClassifiesSMTPFailures(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "timeout", err: context.DeadlineExceeded, want: rpcerrors.ReasonSMTPTestTimeout},
		{name: "authentication", err: errors.New("535 authentication failed"), want: rpcerrors.ReasonSMTPTestAuthentication},
		{name: "starttls", err: errors.New("STARTTLS is not available"), want: rpcerrors.ReasonSMTPTestStartTLS},
		{name: "tls", err: errors.New("TLS certificate is invalid"), want: rpcerrors.ReasonSMTPTestTLS},
		{name: "connection", err: errors.New("connection refused"), want: rpcerrors.ReasonSMTPTestConnection},
		{name: "recipient", err: errors.New("recipient mailbox rejected"), want: rpcerrors.ReasonSMTPTestRecipient},
		{name: "unknown", err: errors.New("unexpected failure"), want: rpcerrors.ReasonSMTPTestUnknown},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := TestFailureReason(test.err); got != test.want {
				t.Fatalf("TestFailureReason() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestBuildMessageWithHTMLEncodesJapaneseAlternatives(t *testing.T) {
	message, err := buildMessage(emailsettings.SMTPSettings{FromAddress: "from@example.com"}, "to@example.com", RenderedEmail{
		Subject: "管理者招待",
		Text:    "招待を承諾してください。",
		HTML:    "<p>招待を承諾してください。</p>",
	})
	if err != nil {
		t.Fatalf("buildMessage: %v", err)
	}

	parsed, err := mail.ReadMessage(strings.NewReader(message))
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(parsed.Header.Get("Subject"))
	if err != nil {
		t.Fatalf("DecodeHeader: %v", err)
	}
	if subject != "管理者招待" {
		t.Fatalf("subject = %q", subject)
	}
	mediaType, params, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("ParseMediaType: %v", err)
	}
	if mediaType != "multipart/alternative" || params["boundary"] == "" {
		t.Fatalf("Content-Type = %q", parsed.Header.Get("Content-Type"))
	}
	if strings.Contains("招待を承諾してください。<p>招待を承諾してください。</p>", "--"+params["boundary"]) {
		t.Fatal("test body unexpectedly contains MIME boundary")
	}

	parts := strings.Split(message, "--"+params["boundary"])
	if len(parts) != 4 {
		t.Fatalf("MIME boundary count = %d, want 4", len(parts))
	}
	if got := decodeQuotedPrintablePart(t, parts[1]); got != "招待を承諾してください。" {
		t.Fatalf("text = %q", got)
	}
	if got := decodeQuotedPrintablePart(t, parts[2]); got != "<p>招待を承諾してください。</p>" {
		t.Fatalf("html = %q", got)
	}
}

func TestBuildMessageWithoutHTMLRemainsPlainText(t *testing.T) {
	message, err := buildMessage(emailsettings.SMTPSettings{FromAddress: "from@example.com"}, "to@example.com", RenderedEmail{
		Subject: "Test",
		Text:    "Plain text",
	})
	if err != nil {
		t.Fatalf("buildMessage: %v", err)
	}
	if !strings.Contains(message, "Content-Type: text/plain; charset=UTF-8") {
		t.Fatalf("message = %q", message)
	}
	if !strings.Contains(message, "Content-Transfer-Encoding: quoted-printable") {
		t.Fatalf("message = %q", message)
	}
	if strings.Contains(message, "multipart/alternative") {
		t.Fatalf("message unexpectedly has alternatives: %q", message)
	}
}

func TestSendEmailRejectsSubjectHeaderInjection(t *testing.T) {
	err := NewClient().SendEmail(t.Context(), emailsettings.SMTPSettings{
		Host:        "smtp.example.com",
		Port:        587,
		Username:    "mailer",
		Password:    "password",
		Encryption:  "starttls",
		FromAddress: "from@example.com",
	}, "to@example.com", "Invitation\r\nBcc: victim@example.com", "body")
	if err == nil || err.Error() != "subject must not contain CR/LF" {
		t.Fatalf("SendEmail error = %v", err)
	}
}

func decodeQuotedPrintablePart(t *testing.T, part string) string {
	t.Helper()
	sections := strings.SplitN(part, "\r\n\r\n", 2)
	if len(sections) != 2 {
		t.Fatalf("MIME part has no body: %q", part)
	}
	if !strings.Contains(sections[0], "Content-Transfer-Encoding: quoted-printable") {
		t.Fatalf("MIME part has unexpected headers: %q", sections[0])
	}
	decoded, err := io.ReadAll(quotedprintable.NewReader(strings.NewReader(strings.TrimSuffix(sections[1], "\r\n"))))
	if err != nil {
		t.Fatalf("decode quoted-printable: %v", err)
	}
	return string(decoded)
}
