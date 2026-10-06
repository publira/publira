// Package sendgrid is SendGrid Inbound Parse: SendGrid receives mail on the
// tenant's inbound domain and posts each one to the webhook as
// multipart/form-data.
//
// Inbound Parse signs nothing, so the provider declares a token the tenant
// puts in the webhook URL as the password of its basic auth
// (`https://inbound:<token>@<storefront>/api/v1/webhook/email/sendgrid`),
// which SendGrid sends back as an Authorization header on every request.
package sendgrid

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/publira/publira/server/internal/inboundprovider"
)

const (
	// ID is the provider id stored in a tenant's inbound email settings.
	ID = "sendgrid"

	// FieldWebhookToken is the credential field SendGrid declares: the
	// password of the basic auth in the webhook URL.
	FieldWebhookToken = "webhook_token"

	// maxFieldBytes bounds one form field. The raw `email` field carries the
	// whole mail, attachments included, and SendGrid accepts mail of up to
	// 30 MB.
	maxFieldBytes = 32 << 20
)

// fields are the form fields read. Attachments arrive as file parts and as
// other fields, and none of them is kept.
var fields = map[string]bool{
	"charsets": true,
	"email":    true,
	"envelope": true,
	"from":     true,
	"headers":  true,
	"html":     true,
	"subject":  true,
	"text":     true,
	"to":       true,
	"cc":       true,
}

// Provider is SendGrid Inbound Parse.
type Provider struct{}

// New answers the SendGrid provider.
func New() *Provider {
	return &Provider{}
}

func (*Provider) Declaration() inboundprovider.Declaration {
	return inboundprovider.Declaration{
		ID:          ID,
		DisplayName: "SendGrid",
		Fields: []inboundprovider.Field{
			{Name: FieldWebhookToken, Secret: true, Required: true},
		},
	}
}

// ParseWebhook reads both forms Inbound Parse posts: the default one, where
// SendGrid has already split the mail into its header block and its text and
// HTML bodies, and the one a tenant gets by ticking "POST the raw, full MIME
// message", where the mail arrives whole as the `email` field.
func (*Provider) ParseWebhook(_ context.Context, payload []byte, headers http.Header, credentials inboundprovider.Credentials) (inboundprovider.Result, error) {
	if !authorized(headers.Get("Authorization"), credentials[FieldWebhookToken]) {
		return nil, inboundprovider.ErrInvalidSignature
	}
	form, err := readForm(payload, headers.Get("Content-Type"))
	if err != nil {
		return nil, fmt.Errorf("%w: %w", inboundprovider.ErrMalformedRequest, err)
	}

	var charsets map[string]string
	if raw := form["charsets"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &charsets); err != nil {
			return nil, fmt.Errorf("%w: decode charsets: %w", inboundprovider.ErrMalformedRequest, err)
		}
	}
	value := func(name string) (string, error) {
		decoded, err := inboundprovider.DecodeCharset(form[name], charsets[name])
		if err != nil {
			return "", fmt.Errorf("%w: decode %s: %w", inboundprovider.ErrMalformedRequest, name, err)
		}
		return decoded, nil
	}

	var msg inboundprovider.Message
	if raw, ok := form["email"]; ok {
		header, text, err := inboundprovider.ReadMIME(raw)
		if err != nil {
			return nil, fmt.Errorf("%w: read raw mail: %w", inboundprovider.ErrMalformedRequest, err)
		}
		msg.Text = text
		readEnvelope(&msg, form["envelope"])
		inboundprovider.ApplyHeader(&msg, header)
	} else {
		headerBlock, err := value("headers")
		if err != nil {
			return nil, err
		}
		header, err := inboundprovider.ReadHeaderBlock(headerBlock)
		if err != nil {
			return nil, fmt.Errorf("%w: read header block: %w", inboundprovider.ErrMalformedRequest, err)
		}
		if msg.Text, err = value("text"); err != nil {
			return nil, err
		}
		if strings.TrimSpace(msg.Text) == "" {
			htmlBody, err := value("html")
			if err != nil {
				return nil, err
			}
			msg.Text = inboundprovider.HTMLToText(htmlBody)
		}
		readEnvelope(&msg, form["envelope"])
		inboundprovider.ApplyHeader(&msg, header)
	}

	// The fields SendGrid parsed stand in for a header block that left them
	// out.
	if from, err := value("from"); err == nil {
		if address, ok := inboundprovider.ParseAddress(from); ok {
			msg.From = address
		}
	}
	for _, name := range []string{"to", "cc"} {
		list, err := value(name)
		if err != nil {
			return nil, err
		}
		msg.Recipients = inboundprovider.AppendRecipients(msg.Recipients, inboundprovider.ParseAddressList(list)...)
	}
	if msg.Subject == "" {
		subject, err := value("subject")
		if err != nil {
			return nil, err
		}
		msg.Subject = strings.TrimSpace(subject)
	}
	if msg.From == "" {
		return nil, fmt.Errorf("%w: the mail names no sender", inboundprovider.ErrMalformedRequest)
	}
	msg.ID = msg.MessageID
	return msg, nil
}

// authorized reports whether an Authorization header carries token as the
// password of its basic auth. The user name is whatever the tenant wrote in
// the URL, and is not compared.
func authorized(header, token string) bool {
	if token == "" {
		return false
	}
	scheme, encoded, ok := strings.Cut(strings.TrimSpace(header), " ")
	if !ok || !strings.EqualFold(scheme, "Basic") {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return false
	}
	_, password, ok := strings.Cut(string(decoded), ":")
	if !ok {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(password), []byte(token)) == 1
}

// readForm reads the form fields SendGrid's request carries that ParseWebhook
// uses, and skips every file part.
func readForm(payload []byte, contentType string) (map[string][]byte, error) {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType != "multipart/form-data" || params["boundary"] == "" {
		return nil, errors.New("the request is not multipart/form-data")
	}
	reader := multipart.NewReader(bytes.NewReader(payload), params["boundary"])
	form := map[string][]byte{}
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read form: %w", err)
		}
		name := part.FormName()
		if part.FileName() != "" || !fields[name] {
			continue
		}
		value, err := io.ReadAll(io.LimitReader(part, maxFieldBytes+1))
		if err != nil {
			return nil, fmt.Errorf("read form field %s: %w", name, err)
		}
		if len(value) > maxFieldBytes {
			return nil, fmt.Errorf("form field %s is too large", name)
		}
		form[name] = value
	}
	return form, nil
}

// readEnvelope takes the recipients from the SMTP envelope, which are the
// addresses SendGrid accepted the mail for whatever its To header says.
func readEnvelope(msg *inboundprovider.Message, raw []byte) {
	if len(raw) == 0 {
		return
	}
	var envelope struct {
		To []string `json:"to"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return
	}
	for _, to := range envelope.To {
		if address, ok := inboundprovider.ParseAddress(to); ok {
			msg.Recipients = inboundprovider.AppendRecipients(msg.Recipients, address)
		}
	}
}
