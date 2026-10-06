package smtp

import (
	"context"
	crand "crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/rpcerrors"
)

type Tester interface {
	SendTestEmail(ctx context.Context, settings emailsettings.SMTPSettings, recipient string) error
}

type Sender interface {
	SendEmail(ctx context.Context, settings emailsettings.SMTPSettings, recipient, subject, body string) error
}

// RenderedSender sends an email with a plain-text body and, when the sender
// composed one, an HTML alternative beside it. Sender remains the plain-text
// interface used by existing notification flows.
type RenderedSender interface {
	SendRenderedEmail(ctx context.Context, settings emailsettings.SMTPSettings, recipient string, email RenderedEmail) error
}

type RenderedEmail struct {
	Subject string
	HTML    string
	Text    string
	// ReplyTo is where this one mail's answer goes. Empty leaves the Reply-To
	// of the SMTP settings in charge, which is every mail that names none.
	ReplyTo string
	// MessageID, InReplyTo and References place the mail in a thread. Each is
	// an RFC 5322 msg-id without its angle brackets, and an empty one leaves its
	// header out: the server that relays a mail with no Message-ID adds one of
	// its own, which nobody here can answer to.
	MessageID  string
	InReplyTo  string
	References []string
}

type Client struct {
	DialTimeout time.Duration
}

func NewClient() *Client {
	return &Client{DialTimeout: 10 * time.Second}
}

func (c *Client) SendTestEmail(ctx context.Context, settings emailsettings.SMTPSettings, recipient string) error {
	return c.SendEmail(ctx, settings, recipient, "Publira SMTP test", "Publira SMTP connection test message.\r\n")
}

func (c *Client) SendEmail(ctx context.Context, settings emailsettings.SMTPSettings, recipient, subject, body string) error {
	return c.SendRenderedEmail(ctx, settings, recipient, RenderedEmail{Subject: subject, Text: body})
}

func (c *Client) SendRenderedEmail(ctx context.Context, settings emailsettings.SMTPSettings, recipient string, email RenderedEmail) error {
	settings = emailsettings.Normalize(settings)
	if err := emailsettings.Validate(settings, true); err != nil {
		return err
	}
	if _, err := mail.ParseAddress(strings.TrimSpace(recipient)); err != nil {
		return err
	}
	if strings.TrimSpace(email.Subject) == "" {
		return errors.New("subject is required")
	}
	if strings.ContainsAny(email.Subject, "\r\n") {
		return errors.New("subject must not contain CR/LF")
	}
	if strings.TrimSpace(email.Text) == "" {
		return errors.New("body is required")
	}
	if err := validateThreadHeaders(email); err != nil {
		return err
	}

	addr := net.JoinHostPort(settings.Host, fmt.Sprintf("%d", settings.Port))
	dialer := &net.Dialer{Timeout: c.DialTimeout}

	client, conn, err := openClient(ctx, dialer, addr, settings)
	if err != nil {
		return err
	}
	defer conn.Close()   //nolint:errcheck
	defer client.Close() //nolint:errcheck
	defer client.Quit()  //nolint:errcheck

	// A saved username the server offers no AUTH for is refused rather than
	// dropped, so a misconfigured relay does not silently take mail unauthenticated.
	if settings.Username != "" {
		if ok, _ := client.Extension("AUTH"); !ok {
			return errors.New("authentication is not supported by smtp server")
		}
		if err := client.Auth(smtp.PlainAuth("", settings.Username, settings.Password, settings.Host)); err != nil {
			return err
		}
	}

	if err := client.Mail(settings.FromAddress); err != nil {
		return err
	}
	if err := client.Rcpt(recipient); err != nil {
		return err
	}

	bodyWriter, err := client.Data()
	if err != nil {
		return err
	}

	message, err := buildMessage(settings, recipient, email)
	if err != nil {
		return err
	}
	if _, err := io.WriteString(bodyWriter, message); err != nil {
		_ = bodyWriter.Close()
		return err
	}
	if err := bodyWriter.Close(); err != nil {
		return err
	}

	return nil
}

// TestFailureReason classifies an SMTP test failure into a stable API reason.
func TestFailureReason(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return rpcerrors.ReasonSMTPTestTimeout
	}
	lower := strings.ToLower(err.Error())
	switch {
	case strings.Contains(lower, "authentication") || strings.Contains(lower, "535"):
		return rpcerrors.ReasonSMTPTestAuthentication
	case strings.Contains(lower, "starttls"):
		return rpcerrors.ReasonSMTPTestStartTLS
	case strings.Contains(lower, "tls") || strings.Contains(lower, "certificate"):
		return rpcerrors.ReasonSMTPTestTLS
	case strings.Contains(lower, "no such host") || strings.Contains(lower, "connection refused") || strings.Contains(lower, "timeout") || strings.Contains(lower, "deadline exceeded"):
		return rpcerrors.ReasonSMTPTestConnection
	case strings.Contains(lower, "rcpt") || strings.Contains(lower, "recipient") || strings.Contains(lower, "mailbox"):
		return rpcerrors.ReasonSMTPTestRecipient
	default:
		return rpcerrors.ReasonSMTPTestUnknown
	}
}

func buildMessage(settings emailsettings.SMTPSettings, recipient string, email RenderedEmail) (string, error) {
	text, err := encodeQuotedPrintable(email.Text)
	if err != nil {
		return "", err
	}
	html, err := encodeQuotedPrintable(email.HTML)
	if err != nil {
		return "", err
	}

	from := settings.FromAddress
	if settings.FromName != "" {
		from = (&mail.Address{Name: settings.FromName, Address: settings.FromAddress}).String()
	}
	headers := []string{
		fmt.Sprintf("From: %s", from),
		fmt.Sprintf("To: %s", recipient),
		fmt.Sprintf("Subject: %s", mime.QEncoding.Encode("UTF-8", email.Subject)),
		"MIME-Version: 1.0",
	}
	switch {
	case email.ReplyTo != "":
		headers = append(headers, fmt.Sprintf("Reply-To: %s", email.ReplyTo))
	case settings.ReplyTo != "":
		headers = append(headers, fmt.Sprintf("Reply-To: %s", settings.ReplyTo))
	}
	if email.MessageID != "" {
		headers = append(headers, fmt.Sprintf("Message-ID: <%s>", email.MessageID))
	}
	if email.InReplyTo != "" {
		headers = append(headers, fmt.Sprintf("In-Reply-To: <%s>", email.InReplyTo))
	}
	if len(email.References) > 0 {
		// One id per folded line, so a long thread cannot push the header past
		// the line length RFC 5322 allows.
		references := make([]string, 0, len(email.References))
		for _, id := range email.References {
			references = append(references, "<"+id+">")
		}
		headers = append(headers, "References: "+strings.Join(references, "\r\n "))
	}
	if email.HTML == "" {
		headers = append(headers, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: quoted-printable")
		return strings.Join(headers, "\r\n") + "\r\n\r\n" + text, nil
	}

	boundary, err := newMIMEBoundary(email.Text, email.HTML)
	if err != nil {
		return "", err
	}
	headers = append(headers, fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"", boundary))
	parts := []string{
		"--" + boundary,
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: quoted-printable",
		"",
		text,
		"--" + boundary,
		"Content-Type: text/html; charset=UTF-8",
		"Content-Transfer-Encoding: quoted-printable",
		"",
		html,
		"--" + boundary + "--",
		"",
	}
	return strings.Join(headers, "\r\n") + "\r\n\r\n" + strings.Join(parts, "\r\n"), nil
}

// validateThreadHeaders refuses a per-mail header that would break the header
// block it is written into: an address that is not one, or a msg-id carrying
// whitespace or the brackets the writer adds around it.
func validateThreadHeaders(email RenderedEmail) error {
	if email.ReplyTo != "" {
		address, err := mail.ParseAddress(email.ReplyTo)
		if err != nil || address.Name != "" || address.Address != email.ReplyTo {
			return errors.New("reply-to must be a bare email address")
		}
	}
	ids := append([]string{email.MessageID, email.InReplyTo}, email.References...)
	for index, id := range ids {
		// The first two are optional; a References entry is not.
		if id == "" && index < 2 {
			continue
		}
		if !validMsgID(id) {
			return fmt.Errorf("%q is not a message id", id)
		}
	}
	return nil
}

// validMsgID accepts the inside of an RFC 5322 msg-id: a left and a right
// part around one "@", with nothing in either that would end the header or
// the id early.
func validMsgID(id string) bool {
	left, right, ok := strings.Cut(id, "@")
	if !ok || left == "" || right == "" || strings.Contains(right, "@") {
		return false
	}
	for _, r := range id {
		if r <= ' ' || r >= 0x7f || r == '<' || r == '>' {
			return false
		}
	}
	return true
}

func encodeQuotedPrintable(body string) (string, error) {
	var encoded strings.Builder
	writer := quotedprintable.NewWriter(&encoded)
	if _, err := writer.Write([]byte(body)); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	return encoded.String(), nil
}

func newMIMEBoundary(text, html string) (string, error) {
	for range 10 {
		raw := make([]byte, 24)
		if _, err := crand.Read(raw); err != nil {
			return "", err
		}
		boundary := "=_publira_" + hex.EncodeToString(raw)
		delimiter := "--" + boundary
		if !strings.Contains(text, delimiter) && !strings.Contains(html, delimiter) {
			return boundary, nil
		}
	}
	return "", errors.New("could not generate a MIME boundary that does not occur in the body")
}

func openClient(ctx context.Context, dialer *net.Dialer, addr string, settings emailsettings.SMTPSettings) (*smtp.Client, net.Conn, error) {
	var (
		conn net.Conn
		err  error
	)

	switch settings.Encryption {
	case "tls":
		tlsDialer := &tls.Dialer{
			NetDialer: dialer,
			Config: &tls.Config{
				MinVersion: tls.VersionTLS12,
				ServerName: settings.Host,
			},
		}
		conn, err = tlsDialer.DialContext(ctx, "tcp", addr)
		if err != nil {
			return nil, nil, err
		}
		client, err := smtp.NewClient(conn, settings.Host)
		if err != nil {
			return nil, conn, err
		}
		return client, conn, nil
	case "starttls", "none":
		conn, err = dialer.DialContext(ctx, "tcp", addr)
		if err != nil {
			return nil, nil, err
		}
		client, err := smtp.NewClient(conn, settings.Host)
		if err != nil {
			return nil, conn, err
		}
		if settings.Encryption == "starttls" {
			if ok, _ := client.Extension("STARTTLS"); !ok {
				return nil, conn, errors.New("starttls is not supported by smtp server")
			}
			if err := client.StartTLS(&tls.Config{MinVersion: tls.VersionTLS12, ServerName: settings.Host}); err != nil {
				return nil, conn, err
			}
		}
		return client, conn, nil
	default:
		return nil, nil, errors.New("unsupported smtp encryption")
	}
}
