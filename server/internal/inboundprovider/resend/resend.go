// Package resend is Resend's receiving: Resend receives mail on the tenant's
// inbound domain and posts an `email.received` event, signed with Svix, to the
// webhook. The event carries the mail's metadata only, so its body and headers
// are then read from Resend's receiving API with the tenant's API key.
package resend

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/inboundprovider"
)

const (
	// ID is the provider id stored in a tenant's inbound email settings.
	ID = "resend"

	// FieldAPIKey and FieldWebhookSecret are the credential fields Resend
	// declares: the API key the mail is read with, and the signing secret of
	// the webhook (`whsec_…`).
	FieldAPIKey        = "api_key"
	FieldWebhookSecret = "webhook_secret"

	// DefaultBaseURL is the origin of Resend's API.
	DefaultBaseURL = "https://api.resend.com"

	// EventEmailReceived is the event type a received mail is posted as.
	EventEmailReceived = "email.received"

	// signatureTolerance is how far a request's timestamp may be from now,
	// Svix's own default. It bounds how long a captured request could be
	// replayed; a replay inside it stores nothing twice, because the mail's
	// Message-ID is already stored.
	signatureTolerance = 5 * time.Minute

	// maxResponseBytes bounds the received email read from the API. The HTML
	// body carries inline images as data URIs, so it can be large.
	maxResponseBytes = 64 << 20
)

// Provider is Resend's receiving.
type Provider struct {
	baseURL    string
	httpClient *http.Client
	now        func() time.Time
}

// Option configures a [Provider].
type Option func(*Provider)

// WithBaseURL points the provider at another Resend API origin, as a test's
// fake of it.
func WithBaseURL(baseURL string) Option {
	return func(p *Provider) {
		p.baseURL = strings.TrimSuffix(baseURL, "/")
	}
}

// WithHTTPClient has the provider call the API with client.
func WithHTTPClient(client *http.Client) Option {
	return func(p *Provider) {
		p.httpClient = client
	}
}

// WithClock has the provider check a request's timestamp against now.
func WithClock(now func() time.Time) Option {
	return func(p *Provider) {
		p.now = now
	}
}

// New answers the Resend provider.
func New(options ...Option) *Provider {
	p := &Provider{
		baseURL:    DefaultBaseURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		now:        time.Now,
	}
	for _, option := range options {
		option(p)
	}
	return p
}

func (*Provider) Declaration() inboundprovider.Declaration {
	return inboundprovider.Declaration{
		ID:          ID,
		DisplayName: "Resend",
		Fields: []inboundprovider.Field{
			{Name: FieldAPIKey, Secret: true, Required: true},
			{Name: FieldWebhookSecret, Secret: true, Required: true},
		},
	}
}

// event is the part of a webhook event the provider reads.
type event struct {
	Type string `json:"type"`
	Data struct {
		EmailID string   `json:"email_id"`
		From    string   `json:"from"`
		To      []string `json:"to"`
	} `json:"data"`
}

// receivedEmail is the part of the receiving API's answer the provider reads.
type receivedEmail struct {
	ID          string                     `json:"id"`
	From        string                     `json:"from"`
	To          []string                   `json:"to"`
	Cc          []string                   `json:"cc"`
	ReceivedFor []string                   `json:"received_for"`
	Subject     string                     `json:"subject"`
	Text        *string                    `json:"text"`
	HTML        *string                    `json:"html"`
	MessageID   string                     `json:"message_id"`
	Headers     map[string]json.RawMessage `json:"headers"`
}

func (p *Provider) ParseWebhook(ctx context.Context, payload []byte, headers http.Header, credentials inboundprovider.Credentials) (inboundprovider.Result, error) {
	requestID, err := verify(payload, headers, credentials[FieldWebhookSecret], p.now())
	if err != nil {
		return nil, err
	}
	var received event
	if err := json.Unmarshal(payload, &received); err != nil {
		return nil, fmt.Errorf("%w: decode event: %w", inboundprovider.ErrMalformedRequest, err)
	}
	if received.Type != EventEmailReceived {
		return inboundprovider.Ignored{ID: requestID, Type: received.Type}, nil
	}
	if strings.TrimSpace(received.Data.EmailID) == "" {
		return nil, fmt.Errorf("%w: the event names no email", inboundprovider.ErrMalformedRequest)
	}

	email, err := p.retrieve(ctx, credentials[FieldAPIKey], received.Data.EmailID)
	if err != nil {
		return nil, err
	}
	msg := inboundprovider.Message{
		ID:        received.Data.EmailID,
		Subject:   strings.TrimSpace(email.Subject),
		MessageID: inboundprovider.ParseMessageID(email.MessageID),
	}
	if address, ok := inboundprovider.ParseAddress(email.From); ok {
		msg.From = address
	} else if address, ok := inboundprovider.ParseAddress(received.Data.From); ok {
		msg.From = address
	}
	for _, list := range [][]string{email.To, email.Cc, email.ReceivedFor, received.Data.To} {
		for _, item := range list {
			msg.Recipients = inboundprovider.AppendRecipients(msg.Recipients, inboundprovider.ParseAddressList(item)...)
		}
	}
	if email.Text != nil && strings.TrimSpace(*email.Text) != "" {
		msg.Text = *email.Text
	} else if email.HTML != nil {
		msg.Text = inboundprovider.HTMLToText(*email.HTML)
	}
	msg.InReplyTo = inboundprovider.ParseMessageIDs(headerValue(email.Headers, "in-reply-to"))
	msg.References = inboundprovider.ParseMessageIDs(headerValue(email.Headers, "references"))
	if msg.From == "" {
		return nil, fmt.Errorf("%w: the mail names no sender", inboundprovider.ErrMalformedRequest)
	}
	return msg, nil
}

// retrieve reads one received email from the receiving API. An API that does
// not answer, or refuses the key, is unavailable rather than malformed: the
// request is genuine, and Resend delivers it again once the tenant's key or
// Resend itself is back.
func (p *Provider) retrieve(ctx context.Context, apiKey, emailID string) (receivedEmail, error) {
	if strings.TrimSpace(apiKey) == "" {
		return receivedEmail{}, fmt.Errorf("%w: no API key is stored", inboundprovider.ErrProviderUnavailable)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+"/emails/receiving/"+url.PathEscape(emailID), nil)
	if err != nil {
		return receivedEmail{}, fmt.Errorf("build received email request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")
	res, err := p.httpClient.Do(req)
	if err != nil {
		return receivedEmail{}, fmt.Errorf("%w: %w", inboundprovider.ErrProviderUnavailable, err)
	}
	defer res.Body.Close() //nolint:errcheck
	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if err != nil {
		return receivedEmail{}, fmt.Errorf("%w: read received email: %w", inboundprovider.ErrProviderUnavailable, err)
	}
	switch {
	case res.StatusCode == http.StatusNotFound:
		return receivedEmail{}, fmt.Errorf("%w: Resend has no received email %s", inboundprovider.ErrMalformedRequest, emailID)
	case res.StatusCode != http.StatusOK:
		return receivedEmail{}, fmt.Errorf("%w: Resend answered %d", inboundprovider.ErrProviderUnavailable, res.StatusCode)
	case len(body) > maxResponseBytes:
		return receivedEmail{}, fmt.Errorf("%w: received email %s is too large", inboundprovider.ErrMalformedRequest, emailID)
	}
	var email receivedEmail
	if err := json.Unmarshal(body, &email); err != nil {
		return receivedEmail{}, fmt.Errorf("%w: decode received email: %w", inboundprovider.ErrMalformedRequest, err)
	}
	return email, nil
}

// headerValue answers one header of the API's header map, whose names are in
// lower case and whose values are a string, or a list of strings for a header
// the mail repeats.
func headerValue(headers map[string]json.RawMessage, name string) string {
	for key, raw := range headers {
		if !strings.EqualFold(key, name) {
			continue
		}
		var single string
		if err := json.Unmarshal(raw, &single); err == nil {
			return single
		}
		var list []string
		if err := json.Unmarshal(raw, &list); err == nil {
			return strings.Join(list, " ")
		}
	}
	return ""
}

// verify checks a Svix signature, and answers the request's id.
//
// The signed content is the id, the timestamp, and the raw body joined by
// dots, signed with HMAC-SHA256 under the base64 key that follows `whsec_` in
// the secret. The signature header lists one or more `v1,<base64>` signatures,
// separated by spaces, of which one has to match; Svix sends several while a
// secret is being rotated.
func verify(payload []byte, headers http.Header, secret string, now time.Time) (string, error) {
	id := svixHeader(headers, "id")
	timestamp := svixHeader(headers, "timestamp")
	signatures := svixHeader(headers, "signature")
	if id == "" || timestamp == "" || signatures == "" || secret == "" {
		return "", inboundprovider.ErrInvalidSignature
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return "", inboundprovider.ErrInvalidSignature
	}
	if skew := now.Sub(time.Unix(seconds, 0)); skew > signatureTolerance || skew < -signatureTolerance {
		return "", inboundprovider.ErrInvalidSignature
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(strings.TrimSpace(secret), "whsec_"))
	if err != nil || len(key) == 0 {
		return "", inboundprovider.ErrInvalidSignature
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + timestamp + "."))
	mac.Write(payload)
	expected := mac.Sum(nil)
	for signature := range strings.FieldsSeq(signatures) {
		version, encoded, ok := strings.Cut(signature, ",")
		if !ok || version != "v1" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			continue
		}
		if hmac.Equal(decoded, expected) {
			return id, nil
		}
	}
	return "", inboundprovider.ErrInvalidSignature
}

// svixHeader reads a Svix header, which Svix also sends under the Standard
// Webhooks name (`webhook-id` beside `svix-id`).
func svixHeader(headers http.Header, name string) string {
	if value := strings.TrimSpace(headers.Get("svix-" + name)); value != "" {
		return value
	}
	return strings.TrimSpace(headers.Get("webhook-" + name))
}
