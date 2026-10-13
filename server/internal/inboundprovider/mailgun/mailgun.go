// Package mailgun is Mailgun's receiving: a Route on the tenant's inbound
// domain whose `forward("https://…")` action posts each mail Mailgun receives
// there to the webhook, already parsed into form fields.
//
// The post carries the whole mail and is signed with the account's HTTP
// webhook signing key, so the provider reads nothing from Mailgun's API and
// needs neither an API key nor the region the account is in.
package mailgun

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/mail"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/inboundprovider"
)

const (
	// ID is the provider id stored in a tenant's inbound email settings.
	ID = "mailgun"

	// FieldWebhookSigningKey is the credential field Mailgun declares: the
	// account's HTTP webhook signing key, which signs every Route post. A post
	// for a domain on a subaccount is signed with the subaccount's key and
	// again, as `parent-signature`, with the primary account's, so either key
	// verifies it.
	FieldWebhookSigningKey = "webhook_signing_key"

	// signatureMaxAge is how long ago a request's timestamp may be. Mailgun
	// retries a Route post the webhook did not accept for 8 hours, and does
	// not say that a retry is signed anew, so a retry still carrying the first
	// attempt's timestamp has to verify until the last one. It also bounds how
	// long a captured request could be replayed; a replay inside it stores
	// nothing twice, because the mail's Message-ID is already stored.
	signatureMaxAge = 8 * time.Hour

	// signatureMaxSkew is how far ahead of now a request's timestamp may be,
	// for a clock that runs behind Mailgun's.
	signatureMaxSkew = 5 * time.Minute

	// maxTokenBytes bounds the token, which becomes the mail's
	// [inboundprovider.Message.ReplayKey] and is stored as one. Mailgun's are
	// 50 characters.
	maxTokenBytes = 256

	// maxFieldBytes bounds one form field, as the SendGrid provider does.
	// Attachments arrive as file parts that are not read, so the largest
	// field read is a body of the mail.
	maxFieldBytes = 32 << 20
)

// fields are the form fields read, by their lower-case names. Mailgun also
// posts each header of the mail as a field of its own, under the header's
// name, so `To` and `Cc` arrive that way; the rest of those, the stripped
// bodies, and the attachments are not kept.
var fields = map[string]bool{
	"body-html":        true,
	"body-plain":       true,
	"cc":               true,
	"from":             true,
	"message-headers":  true,
	"parent-signature": true,
	"recipient":        true,
	"sender":           true,
	"signature":        true,
	"subject":          true,
	"timestamp":        true,
	"to":               true,
	"token":            true,
}

// Provider is Mailgun's receiving.
type Provider struct {
	now func() time.Time
}

// Option configures a [Provider].
type Option func(*Provider)

// WithClock has the provider check a request's timestamp against now.
func WithClock(now func() time.Time) Option {
	return func(p *Provider) {
		p.now = now
	}
}

// New answers the Mailgun provider.
func New(options ...Option) *Provider {
	p := &Provider{now: time.Now}
	for _, option := range options {
		option(p)
	}
	return p
}

func (*Provider) Declaration() inboundprovider.Declaration {
	return inboundprovider.Declaration{
		ID:          ID,
		DisplayName: "Mailgun",
		Fields: []inboundprovider.Field{
			{Name: FieldWebhookSigningKey, Secret: true, Required: true},
		},
	}
}

// ParseWebhook reads the form a Route's `forward()` posts. The signature
// travels in the form itself, so a request whose body cannot be read as a
// form cannot be told from a forged one, and is refused as unsigned.
//
// The quoted answer is left in the text for [inboundprovider.StripQuoted]
// rather than taken from Mailgun's `stripped-text`, so that every provider's
// mail is cut the same way.
func (p *Provider) ParseWebhook(_ context.Context, payload []byte, headers http.Header, credentials inboundprovider.Credentials) (inboundprovider.Result, error) {
	key := credentials[FieldWebhookSigningKey]
	if key == "" {
		return nil, inboundprovider.ErrInvalidSignature
	}
	form, err := readForm(payload, headers.Get("Content-Type"))
	if err != nil {
		return nil, fmt.Errorf("%w: %w", inboundprovider.ErrInvalidSignature, err)
	}
	if !verify(form["timestamp"], form["token"], key, p.now(), form["signature"], form["parent-signature"]) {
		return nil, inboundprovider.ErrInvalidSignature
	}

	header := textproto.MIMEHeader{}
	if raw := form["message-headers"]; raw != "" {
		var pairs [][]string
		if err := json.Unmarshal([]byte(raw), &pairs); err != nil {
			return nil, fmt.Errorf("%w: decode message-headers: %w", inboundprovider.ErrMalformedRequest, err)
		}
		for _, pair := range pairs {
			if len(pair) == 2 {
				header.Add(pair[0], pair[1])
			}
		}
	}

	msg := inboundprovider.Message{Text: form["body-plain"]}
	if strings.TrimSpace(msg.Text) == "" {
		msg.Text = inboundprovider.HTMLToText(form["body-html"])
	}
	// The envelope recipient is the address Mailgun accepted the mail for,
	// whatever its To header says.
	msg.Recipients = inboundprovider.AppendRecipients(msg.Recipients, inboundprovider.ParseAddressList(form["recipient"])...)
	if address, ok := inboundprovider.ParseAddress(form["from"]); ok {
		msg.From = address
	} else if address, ok := inboundprovider.ParseAddress(form["sender"]); ok {
		msg.From = address
	}
	inboundprovider.ApplyHeader(&msg, mail.Header(header))
	// The fields Mailgun parsed stand in for a header list that left them
	// out.
	for _, name := range []string{"to", "cc"} {
		msg.Recipients = inboundprovider.AppendRecipients(msg.Recipients, inboundprovider.ParseAddressList(form[name])...)
	}
	if msg.Subject == "" {
		msg.Subject = strings.TrimSpace(form["subject"])
	}
	if msg.From == "" {
		return nil, fmt.Errorf("%w: the mail names no sender", inboundprovider.ErrMalformedRequest)
	}
	msg.ID = msg.MessageID
	if msg.ID == "" {
		msg.ID = form["token"]
	}
	// The signature covers the timestamp and the token and none of the
	// fields read above, so the token is what keeps it to this mail.
	msg.ReplayKey = form["token"]
	return msg, nil
}

// verify checks a Route post's signatures: one of them has to be the hex
// HMAC-SHA256 of the timestamp followed by the token, keyed with the signing
// key, from a timestamp no older than signatureMaxAge and no further ahead
// than signatureMaxSkew.
func verify(timestamp, token, key string, now time.Time, signatures ...string) bool {
	if timestamp == "" || token == "" || len(token) > maxTokenBytes {
		return false
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	if age := now.Sub(time.Unix(seconds, 0)); age > signatureMaxAge || age < -signatureMaxSkew {
		return false
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(timestamp + token))
	want := mac.Sum(nil)
	for _, signature := range signatures {
		decoded, err := hex.DecodeString(signature)
		if err == nil && signature != "" && hmac.Equal(decoded, want) {
			return true
		}
	}
	return false
}

// readForm reads the fields of a Route post that ParseWebhook uses. Mailgun
// posts a mail without attachments as application/x-www-form-urlencoded and
// one with attachments as multipart/form-data, whose file parts are skipped.
// A field is kept under its lower-case name. Mailgun posts `subject` and
// `from` beside the mail's own `Subject` and `From` headers, and the field
// spelled in lower case is the one kept.
func readForm(payload []byte, contentType string) (map[string]string, error) {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil, errors.New("the request names no content type")
	}
	form := map[string]string{}
	keep := func(name, value string) error {
		lower := strings.ToLower(name)
		if !fields[lower] {
			return nil
		}
		if len(value) > maxFieldBytes {
			return fmt.Errorf("form field %s is too large", name)
		}
		if _, ok := form[lower]; !ok || name == lower {
			form[lower] = value
		}
		return nil
	}

	switch mediaType {
	case "application/x-www-form-urlencoded":
		values, err := url.ParseQuery(string(payload))
		if err != nil {
			return nil, fmt.Errorf("read form: %w", err)
		}
		for name, list := range values {
			if err := keep(name, list[0]); err != nil {
				return nil, err
			}
		}
		return form, nil
	case "multipart/form-data":
		if params["boundary"] == "" {
			return nil, errors.New("the form names no boundary")
		}
		reader := multipart.NewReader(bytes.NewReader(payload), params["boundary"])
		for {
			part, err := reader.NextPart()
			if errors.Is(err, io.EOF) {
				return form, nil
			}
			if err != nil {
				return nil, fmt.Errorf("read form: %w", err)
			}
			name := part.FormName()
			if part.FileName() != "" || !fields[strings.ToLower(name)] {
				continue
			}
			value, err := io.ReadAll(io.LimitReader(part, maxFieldBytes+1))
			if err != nil {
				return nil, fmt.Errorf("read form field %s: %w", name, err)
			}
			if err := keep(name, string(value)); err != nil {
				return nil, err
			}
		}
	default:
		return nil, fmt.Errorf("the request is %s, not a form", mediaType)
	}
}
