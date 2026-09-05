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

// RenderedSender sends an email with both plain-text and HTML alternatives.
// Sender remains the plain-text interface used by existing notification flows.
type RenderedSender interface {
	SendRenderedEmail(ctx context.Context, settings emailsettings.SMTPSettings, recipient string, email RenderedEmail) error
}

type RenderedEmail struct {
	Subject string
	HTML    string
	Text    string
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
	return c.send(ctx, settings, recipient, RenderedEmail{Subject: subject, Text: body})
}

func (c *Client) SendRenderedEmail(ctx context.Context, settings emailsettings.SMTPSettings, recipient string, email RenderedEmail) error {
	if strings.TrimSpace(email.HTML) == "" {
		return errors.New("html body is required")
	}
	return c.send(ctx, settings, recipient, email)
}

func (c *Client) send(ctx context.Context, settings emailsettings.SMTPSettings, recipient string, email RenderedEmail) error {
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

	addr := net.JoinHostPort(settings.Host, fmt.Sprintf("%d", settings.Port))
	dialer := &net.Dialer{Timeout: c.DialTimeout}

	client, conn, err := openClient(ctx, dialer, addr, settings)
	if err != nil {
		return err
	}
	defer conn.Close()   //nolint:errcheck
	defer client.Close() //nolint:errcheck
	defer client.Quit()  //nolint:errcheck

	if ok, _ := client.Extension("AUTH"); ok {
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
	if settings.ReplyTo != "" {
		headers = append(headers, fmt.Sprintf("Reply-To: %s", settings.ReplyTo))
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
