// Package inboundprovider is the contract between the inbound email webhook and
// a provider that receives mail for a tenant and posts it to the storefront:
// verifying one webhook request and reading the mail out of it. A provider is
// a package that implements [Provider]; the webhook handler knows nothing else
// about it.
package inboundprovider

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
)

// ErrInvalidSignature reports a request whose signature or token does not
// verify against the tenant's credentials.
var ErrInvalidSignature = errors.New("inbound email webhook signature is invalid")

// ErrMalformedRequest reports a request that verifies but cannot be read as
// the mail it says it carries.
var ErrMalformedRequest = errors.New("inbound email webhook request is malformed")

// ErrProviderUnavailable reports a provider API the mail's content has to be
// read from that could not answer. The provider delivers the request again
// later, so the caller answers with a status it retries on.
var ErrProviderUnavailable = errors.New("inbound email provider is unavailable")

// Field is one credential a provider needs from a tenant.
type Field struct {
	// Name is the key the value is stored and passed under.
	Name string
	// Secret fields are stored encrypted and never shown back in full.
	Secret bool
	// Required fields must be stored before the provider's mail is accepted.
	Required bool
}

// Declaration is what a provider tells the rest of the server about itself.
type Declaration struct {
	// ID names the provider in stored settings and in the webhook route.
	ID          string
	DisplayName string
	Fields      []Field
}

// Field answers the field of d named name.
func (d Declaration) Field(name string) (Field, bool) {
	for _, field := range d.Fields {
		if field.Name == name {
			return field, true
		}
	}
	return Field{}, false
}

// Missing names the required fields of d that have no value in c.
func (d Declaration) Missing(c Credentials) []string {
	var missing []string
	for _, field := range d.Fields {
		if field.Required && c[field.Name] == "" {
			missing = append(missing, field.Name)
		}
	}
	return missing
}

// WebhookPath answers the path on a tenant's storefront that receives the mail
// the provider id names posts. apps/web-host serves it.
func WebhookPath(id string) string {
	return "/api/v1/webhook/email/" + id
}

// Credentials are a tenant's credential values keyed by [Field.Name].
type Credentials map[string]string

func (Credentials) String() string {
	return "inboundprovider.Credentials{redacted}"
}

func (c Credentials) GoString() string {
	return c.String()
}

func (Credentials) LogValue() slog.Value {
	return slog.StringValue("redacted")
}

// Result is what one webhook request means to the inbound flow: a [Message]
// or [Ignored].
type Result interface {
	// RequestID is the provider's id of what it posted, for logs.
	RequestID() string
	isResult()
}

// Message is one received mail, normalised.
type Message struct {
	// ID is the provider's id of the mail or of the request that carried it.
	ID string
	// From is the bare address the mail is from.
	From string
	// Recipients are the bare addresses the mail was delivered to, from the
	// envelope and the To and Cc headers, without duplicates.
	Recipients []string
	Subject    string
	// Text is the plain-text body, or a text rendering of the HTML body for a
	// mail that has no plain-text part. The quoted mail it answers is still in
	// it; [StripQuoted] takes it out.
	Text string
	// MessageID is the mail's Message-ID without its angle brackets, or empty
	// when it carries none.
	MessageID string
	// InReplyTo and References are the ids those headers name, without their
	// angle brackets, in the order the headers list them.
	InReplyTo  []string
	References []string
}

// Ignored is a request about something other than a received mail, such as
// another kind of event the same webhook is subscribed to.
type Ignored struct {
	ID   string
	Type string
}

func (m Message) RequestID() string { return m.ID }
func (i Ignored) RequestID() string { return i.ID }

func (Message) isResult() {}
func (Ignored) isResult() {}

// Provider is one inbound email provider.
type Provider interface {
	Declaration() Declaration
	// ParseWebhook verifies one webhook request against the tenant's
	// credentials and reads it, consulting the provider's API when the
	// request alone does not carry the mail. It answers [ErrInvalidSignature]
	// for a request that does not verify, [ErrMalformedRequest] for one that
	// verifies but cannot be read, and [ErrProviderUnavailable] when the API
	// it has to consult does not answer.
	ParseWebhook(ctx context.Context, payload []byte, headers http.Header, credentials Credentials) (Result, error)
}
