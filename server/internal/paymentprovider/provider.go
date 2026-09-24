// Package paymentprovider is the contract between the purchase flow and a web
// payment provider: starting a checkout, and turning the provider's signed
// notifications into purchase events. A provider is a package that implements
// [Provider]; the purchase handlers know nothing else about it.
package paymentprovider

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
)

// ErrInvalidSignature reports a notification whose signature does not verify
// against the tenant's credentials.
var ErrInvalidSignature = errors.New("payment notification signature is invalid")

// ErrMalformedNotification reports a notification that verifies but cannot be
// read as the event its type names.
var ErrMalformedNotification = errors.New("payment notification is malformed")

// Field is one credential a provider needs from a tenant.
type Field struct {
	// Name is the key the value is stored and passed under.
	Name string
	// Secret fields are stored encrypted and never shown back in full.
	Secret bool
	// Public fields are handed to the reader's browser, as a publishable key
	// is.
	Public bool
	// Required fields must be stored before the provider can take payments.
	Required bool
}

// Declaration is what a provider tells the rest of the server about itself.
type Declaration struct {
	// ID names the provider in stored settings and in the webhook route.
	ID          string
	DisplayName string
	Fields      []Field
	// SignatureHeader is the request header the provider signs its
	// notifications with.
	SignatureHeader string
}

// Credentials are a tenant's credential values keyed by [Field.Name].
type Credentials map[string]string

func (Credentials) String() string {
	return "paymentprovider.Credentials{redacted}"
}

func (c Credentials) GoString() string {
	return c.String()
}

func (Credentials) LogValue() slog.Value {
	return slog.StringValue("redacted")
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

// Purchase names what a completed checkout sells. The provider carries it
// from [CheckoutRequest] to the notification that confirms it.
type Purchase struct {
	TenantID  uuid.UUID
	ReaderID  uuid.UUID
	EpisodeID uuid.UUID
	// Price is the episode's price in yen at the time of checkout.
	Price int32
	// ReadingPeriodHours limits how long the purchase opens the episode; zero
	// means it does not expire.
	ReadingPeriodHours int32
}

// CheckoutRequest starts one reader's checkout of one episode.
type CheckoutRequest struct {
	Purchase     Purchase
	EpisodeTitle string
	// SuccessURL and CancelURL are where the reader returns to afterwards.
	SuccessURL string
	CancelURL  string
	// IdempotencyKey is the same for every attempt of the same reader to buy
	// the same episode, so a retried request reuses the provider's checkout.
	IdempotencyKey string
}

// Event is what a notification means to the purchase flow: one of
// [PurchaseCompleted], [Refunded], or [Ignored].
type Event interface {
	// NotificationID is the provider's id of the notification, for logs.
	NotificationID() string
	isEvent()
}

// PurchaseCompleted reports a checkout the reader has paid for.
type PurchaseCompleted struct {
	ID string
	// CheckoutID is the provider's id of the checkout. A purchase is created
	// once per checkout however many times the notification is delivered.
	CheckoutID string
	// PaymentID is the provider's id of the payment its refunds name. It may
	// be empty when the provider reports none.
	PaymentID string
	Purchase  Purchase
}

// Refunded reports the amount refunded so far on one payment.
type Refunded struct {
	ID        string
	PaymentID string
	// AmountRefunded is the total refunded so far in the currency's minor
	// unit, which for JPY is the yen.
	AmountRefunded int64
	// Currency is the ISO 4217 code of AmountRefunded, upper case.
	Currency string
}

// Ignored is a notification the purchase flow has no use for.
type Ignored struct {
	ID   string
	Type string
}

func (e PurchaseCompleted) NotificationID() string { return e.ID }
func (e Refunded) NotificationID() string          { return e.ID }
func (e Ignored) NotificationID() string           { return e.ID }

func (PurchaseCompleted) isEvent() {}
func (Refunded) isEvent()          {}
func (Ignored) isEvent()           {}

// Provider is one web payment provider.
type Provider interface {
	Declaration() Declaration
	// StartCheckout answers the URL the reader is sent to in order to pay.
	StartCheckout(ctx context.Context, credentials Credentials, req CheckoutRequest) (string, error)
	// ParseNotification verifies a notification against the tenant's
	// credentials and reads it. It answers [ErrInvalidSignature] for a
	// notification that does not verify and [ErrMalformedNotification] for
	// one that verifies but cannot be read.
	ParseNotification(payload []byte, headers http.Header, credentials Credentials) (Event, error)
}
