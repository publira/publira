// Package mailgun is Mailgun's receiving: a Route on the tenant's inbound
// domain whose `forward("https://…/json")` action posts each mail Mailgun
// receives there to the webhook, already parsed into one JSON document.
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
	"fmt"
	"mime"
	"net/http"
	"net/mail"
	"net/textproto"
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
	// again, in `X-Mailgun-Parent-Signature`, with the primary account's, so
	// either key verifies it.
	FieldWebhookSigningKey = "webhook_signing_key"

	// WebhookPathSuffix follows the provider's webhook path. A Route posts the
	// mail as JSON only to a URL ending in `json`, and only that post is
	// signed over its body: the form a Route posts to any other URL is signed
	// over a timestamp and a token alone, as every event webhook of the
	// account is, so the signature of any of those would verify a form
	// carrying whatever mail it was sent with.
	WebhookPathSuffix = "/json"

	// signatureMaxAge is how long ago a request's timestamp may be. Mailgun
	// retries a Route post the webhook did not accept for 8 hours, and does
	// not say that a retry is signed anew, so a retry still carrying the first
	// attempt's timestamp has to verify until the last one. The signature
	// covers the body, so a request replayed inside it is the same mail, and
	// stores nothing twice once its Message-ID or its delivery key is stored.
	signatureMaxAge = 8 * time.Hour

	// signatureMaxSkew is how far ahead of now a request's timestamp may be,
	// for a clock that runs behind Mailgun's.
	signatureMaxSkew = 5 * time.Minute
)

// post is the part of a Route's JSON document the provider reads. Mailgun
// also puts each header of the mail at the top level under the header's own
// name, beside lower-case fields such as `from` and `subject`; the lower-case
// field is the one read, and the headers come from `message-headers`.
type post struct {
	Recipient      string     `json:"recipient"`
	Sender         string     `json:"sender"`
	From           string     `json:"from"`
	Subject        string     `json:"subject"`
	BodyPlain      string     `json:"body-plain"`
	BodyHTML       string     `json:"body-html"`
	MessageHeaders [][]string `json:"message-headers"`
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
		ID:                ID,
		DisplayName:       "Mailgun",
		WebhookPathSuffix: WebhookPathSuffix,
		Fields: []inboundprovider.Field{
			{Name: FieldWebhookSigningKey, Secret: true, Required: true},
		},
	}
}

// ParseWebhook reads the JSON document a Route's `forward()` posts to a URL
// ending in `json`. A request that is not JSON carries no signature over its
// body, so it cannot be told from a forged one and is refused as unsigned.
//
// The quoted answer is left in the text for [inboundprovider.StripQuoted]
// rather than taken from Mailgun's `stripped-text`, so that every provider's
// mail is cut the same way.
func (p *Provider) ParseWebhook(_ context.Context, payload []byte, headers http.Header, credentials inboundprovider.Credentials) (inboundprovider.Result, error) {
	key := credentials[FieldWebhookSigningKey]
	if key == "" {
		return nil, inboundprovider.ErrInvalidSignature
	}
	if mediaType, _, err := mime.ParseMediaType(headers.Get("Content-Type")); err != nil || mediaType != "application/json" {
		return nil, fmt.Errorf("%w: the request is not the JSON a Route signs", inboundprovider.ErrInvalidSignature)
	}
	if !verify(headers.Get("X-Mailgun-Timestamp"), payload, key, p.now(), headers.Get("X-Mailgun-Signature"), headers.Get("X-Mailgun-Parent-Signature")) {
		return nil, inboundprovider.ErrInvalidSignature
	}

	var doc post
	if err := json.Unmarshal(payload, &doc); err != nil {
		return nil, fmt.Errorf("%w: decode the post: %w", inboundprovider.ErrMalformedRequest, err)
	}
	header := textproto.MIMEHeader{}
	var block bytes.Buffer
	for _, pair := range doc.MessageHeaders {
		if len(pair) == 2 {
			header.Add(pair[0], pair[1])
			block.WriteString(pair[0] + ": " + pair[1] + "\r\n")
		}
	}

	// A Route post carries no id of its own, and a retry may be signed anew,
	// so the delivery key comes from the header Mailgun received the mail
	// with, in the order it lists it.
	msg := inboundprovider.Message{
		Text:        doc.BodyPlain,
		DeliveryKey: inboundprovider.HeaderDeliveryKey(block.Bytes()),
	}
	if strings.TrimSpace(msg.Text) == "" {
		msg.Text = inboundprovider.HTMLToText(doc.BodyHTML)
	}
	// The envelope recipient is the address Mailgun accepted the mail for,
	// whatever its To header says.
	msg.Recipients = inboundprovider.AppendRecipients(msg.Recipients, inboundprovider.ParseAddressList(doc.Recipient)...)
	if address, ok := inboundprovider.ParseAddress(doc.From); ok {
		msg.From = address
	} else if address, ok := inboundprovider.ParseAddress(doc.Sender); ok {
		msg.From = address
	}
	inboundprovider.ApplyHeader(&msg, mail.Header(header))
	if msg.Subject == "" {
		msg.Subject = strings.TrimSpace(doc.Subject)
	}
	if msg.From == "" {
		return nil, fmt.Errorf("%w: the mail names no sender", inboundprovider.ErrMalformedRequest)
	}
	msg.ID = msg.MessageID
	if msg.ID == "" {
		msg.ID = msg.DeliveryKey
	}
	return msg, nil
}

// verify checks a Route post's signatures: one of them has to be the hex
// HMAC-SHA256 of the timestamp followed by the whole body, keyed with the
// signing key, from a timestamp no older than signatureMaxAge and no further
// ahead than signatureMaxSkew.
func verify(timestamp string, body []byte, key string, now time.Time, signatures ...string) bool {
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	if age := now.Sub(time.Unix(seconds, 0)); age > signatureMaxAge || age < -signatureMaxSkew {
		return false
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(timestamp))
	mac.Write(body)
	want := mac.Sum(nil)
	for _, signature := range signatures {
		decoded, err := hex.DecodeString(signature)
		if err == nil && len(decoded) > 0 && hmac.Equal(decoded, want) {
			return true
		}
	}
	return false
}
