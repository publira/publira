// Package paymentprovider is the contract between the purchase flow and a web
// payment provider: starting a checkout, and turning the provider's signed
// notifications into purchase events. A provider is a package that implements
// [Provider]; the purchase handlers know nothing else about it.
package paymentprovider

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"slices"

	"github.com/google/uuid"
)

// ErrInvalidSignature reports a notification whose signature does not verify
// against the tenant's credentials.
var ErrInvalidSignature = errors.New("payment notification signature is invalid")

// ErrMalformedNotification reports a notification that verifies but cannot be
// read as the event its type names.
var ErrMalformedNotification = errors.New("payment notification is malformed")

// ErrRefundRefused reports a refund the provider will not make for a reason
// another attempt does not change, such as a payment the tenant's account does
// not hold or one the reader has disputed.
var ErrRefundRefused = errors.New("the payment provider refused the refund")

// Field is one credential a provider needs from a tenant.
type Field struct {
	// Name is the key the value is stored and passed under.
	Name string
	// Secret fields are stored encrypted and never shown back in full.
	Secret bool
	// Public fields are handed to the reader's browser, as a publishable key
	// is, so no field is both secret and public.
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
	// SignatureHeader is the request header the provider signs or
	// authenticates its notifications with.
	SignatureHeader string
	// Currencies are the ISO 4217 codes, in capitals, of the currencies the
	// provider can charge in, each in the unit ISO 4217 gives as its minor
	// unit, which is the unit a price is stored in. A tenant may sell only in
	// one of them.
	Currencies []string
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

// Field answers the field of d named name.
func (d Declaration) Field(name string) (Field, bool) {
	for _, field := range d.Fields {
		if field.Name == name {
			return field, true
		}
	}
	return Field{}, false
}

// Charges reports whether d can charge in currency.
func (d Declaration) Charges(currency string) bool {
	return slices.Contains(d.Currencies, currency)
}

// WebhookPath answers the path on a tenant's storefront that receives the
// notifications of the provider id names. apps/web-storefront serves it.
func WebhookPath(id string) string {
	return "/api/v1/webhook/payment/" + id
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

// Kind is which of an episode's two sales a purchase is, spelled as
// purchases.kind stores it.
type Kind string

const (
	// KindPurchase is the permanent copy, which a checkout that names no kind
	// sells.
	KindPurchase Kind = "purchase"
	// KindRental is the rental, which always expires.
	KindRental Kind = "rental"
)

// ParseKind answers the kind a checkout's metadata names, beside the reading
// period the same metadata names. Empty is [KindPurchase], what a checkout
// started before kinds existed sold; anything else it does not know is an
// error. So is a rental without a positive period: recorded, it would be a
// purchase that never expires, sold at the rental's price.
func ParseKind(value string, readingPeriodHours int64) (Kind, error) {
	switch Kind(value) {
	case "", KindPurchase:
		return KindPurchase, nil
	case KindRental:
		if readingPeriodHours <= 0 {
			return "", errors.New("a rental names no reading period")
		}
		return KindRental, nil
	}
	return "", fmt.Errorf("unknown purchase kind %q", value)
}

// CheckVolumeSale refuses the terms a checkout of a volume cannot carry. A
// volume is sold once and for good, so a rental or a reading period beside one
// would record a purchase its buyer never made.
func CheckVolumeSale(kind Kind, readingPeriodHours int64) error {
	if kind != KindPurchase {
		return errors.New("a volume is never rented")
	}
	if readingPeriodHours != 0 {
		return errors.New("a volume names no reading period")
	}
	return nil
}

// CheckSeriesBundleSale refuses the terms a checkout of a series bundle cannot
// carry, as [CheckVolumeSale] does for a volume. A bundle is the permanent copy
// of each of its episodes, and the reading period of each is written down
// with the bundle rather than carried by the checkout.
func CheckSeriesBundleSale(kind Kind, readingPeriodHours int64) error {
	if kind != KindPurchase {
		return errors.New("a series bundle is never rented")
	}
	if readingPeriodHours != 0 {
		return errors.New("a series bundle names no reading period")
	}
	return nil
}

// CheckCoinPackSale refuses the terms a checkout of a pack of coins cannot
// carry, as [CheckVolumeSale] does for a volume. A pack is bought once and for
// good, and what it grants, coins and bonus coins that expire expiryDays after
// the purchase, has to be a grant the ledger can hold.
func CheckCoinPackSale(kind Kind, readingPeriodHours int64, coins, bonusCoins, expiryDays int64) error {
	if kind != KindPurchase {
		return errors.New("a coin pack is never rented")
	}
	if readingPeriodHours != 0 {
		return errors.New("a coin pack names no reading period")
	}
	if coins < 1 || bonusCoins < 0 || coins+bonusCoins > math.MaxInt32 {
		return errors.New("a coin pack grants at least one coin and no more than an int32 holds")
	}
	if expiryDays < 1 || expiryDays > MaxCoinExpiryDays {
		return fmt.Errorf("a coin pack's coins expire 1 to %d days after the purchase", MaxCoinExpiryDays)
	}
	return nil
}

// MaxCoinExpiryDays is the longest a tenant's coins may last, which
// tenant_coin_config caps expiry_days at.
const MaxCoinExpiryDays = 36500

// Purchase names what a completed checkout sells: one episode, one volume,
// one series bundle, or one pack of coins, so exactly one of EpisodeID,
// VolumeID, SeriesBundleID, and CoinPackID is set and the others are
// [uuid.Nil]. The provider carries it from [CheckoutRequest] to the
// notification that confirms it.
type Purchase struct {
	TenantID  uuid.UUID
	ReaderID  uuid.UUID
	EpisodeID uuid.UUID
	VolumeID  uuid.UUID
	// SeriesBundleID names the series_bundles row a checkout of the rest of a
	// series wrote down before it started. It is left out of the encoding an
	// idempotency key is made from while it is zero, so a checkout of an
	// episode or a volume keeps the key it had before bundles existed.
	SeriesBundleID uuid.UUID `json:",omitzero"`
	// CoinPackID names the pack a checkout of coins sells, and Coins,
	// BonusCoins, and CoinExpiryDays what it grants: the pack's coins and bonus
	// coins and the tenant's expiry_days as the checkout was started on them.
	// Each is left out of the encoding an idempotency key is made from while it
	// is zero, as SeriesBundleID is.
	CoinPackID     uuid.UUID `json:",omitzero"`
	Coins          int32     `json:",omitzero"`
	BonusCoins     int32     `json:",omitzero"`
	CoinExpiryDays int32     `json:",omitzero"`
	// Kind is which of the episode's sales the checkout is for, and always
	// [KindPurchase] for a volume, a series bundle, and a pack.
	Kind Kind
	// Price is the episode's, the volume's, or the pack's price at the time of
	// checkout, or what a series bundle charges once its discount is taken
	// off, in the minor unit of Currency.
	Price int32
	// Currency is the ISO 4217 code, in capitals, of the tenant currency the
	// checkout charges in. A provider reads it back from the payment it
	// confirms rather than from anything the checkout carried, so it names the
	// currency the reader actually paid in.
	Currency string
	// ReadingPeriodHours limits how long the purchase opens the episode; zero
	// means it does not expire. A rental carries its rental period here, and
	// a volume, a series bundle, and a pack always zero.
	ReadingPeriodHours int32
}

// LineItem is one of the lines a checkout of a series bundle lists, one per
// episode.
type LineItem struct {
	// Name is the episode's title.
	Name string
	// Price is what the line costs before the checkout's discount, in the
	// minor unit of [Purchase.Currency].
	Price int32
	// DiscountedPrice is the part of [Purchase.Price] the line accounts for
	// once the discount is spread over every line, which a provider that takes
	// no discount of its own charges for the line instead of Price.
	DiscountedPrice int32
}

// Discount is an amount a checkout takes off the sum of its lines.
type Discount struct {
	// Name is what the checkout page calls the discount.
	Name string
	// Amount is in the minor unit of [Purchase.Currency].
	Amount int32
}

// CheckoutRequest starts one reader's checkout of one episode, one volume, one
// series bundle, or one pack of coins.
type CheckoutRequest struct {
	Purchase Purchase
	// LineItemName is what the checkout names the sale: the episode's title,
	// and for a rental the period it is rented for besides, the volume's, or
	// the coins a pack grants under the tenant's word for them.
	// A checkout of a series bundle names its sale by LineItems instead.
	LineItemName string
	// LineItems are the lines of a checkout of a series bundle, in its order.
	// Their prices sum to Purchase.Price once Discount is taken off. Empty on
	// every other checkout, which sells one line at Purchase.Price.
	LineItems []LineItem `json:",omitempty"`
	// Discount is what a checkout of a series bundle takes off its lines, and
	// nil when it takes nothing off.
	Discount *Discount `json:",omitempty"`
	// SuccessURL and CancelURL are where the reader returns to afterwards.
	SuccessURL string
	CancelURL  string
	// IdempotencyKey is the same for every attempt that sends the same request,
	// so a retried request reuses the provider's checkout, and differs between
	// requests whose other fields differ, which the provider would refuse or
	// answer with the checkout of the earlier one.
	IdempotencyKey string
}

// RefundRequest asks for whatever of one payment has not been refunded yet.
type RefundRequest struct {
	// PaymentID is the provider's id of the payment, as [PurchaseCompleted]
	// named it.
	PaymentID string
	// IdempotencyKey is the same for every attempt to refund the same
	// purchase, so that a retried request refunds nothing twice.
	IdempotencyKey string
	// Amount is what to refund, in the minor unit of the payment's currency,
	// or zero for whatever of the payment has not been refunded yet.
	Amount int64
}

// Event is what a notification means to the purchase flow: one of
// [PurchaseCompleted], [Refunded], [RefundFailed], [Disputed],
// [DisputeLost], [CheckoutExpired], [SubscriptionChanged], or [Ignored].
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
	// AmountPaid is what the reader paid, in the minor unit of
	// Purchase.Currency: Purchase.Price, less the discount of the promotion
	// code PromotionCodeID names when the reader entered one. It is what the
	// purchase records, since a refund of the payment returns this much and no
	// more. A code may take off the whole price, which leaves it zero and the
	// checkout with no payment, and so no PaymentID.
	AmountPaid int32
	// PromotionCodeID is the provider's id of the promotion code the reader
	// entered at the checkout, and empty when they entered none.
	PromotionCodeID string
	// Test reports a payment made in the provider's test mode. Such a
	// purchase opens the episode, but no money reached the tenant, so royalty
	// statements and the daily stats leave it out.
	Test bool
}

// Refunded reports the amount refunded so far on one payment.
type Refunded struct {
	ID        string
	PaymentID string
	// AmountRefunded is the total refunded so far in the minor unit of
	// Currency.
	AmountRefunded int64
	// Currency is the ISO 4217 code of AmountRefunded, in capitals.
	Currency string
}

// RefundFailed reports a refund of one payment that failed or was canceled
// after the provider had accepted it, so the money it promised never went back
// to the reader.
type RefundFailed struct {
	ID        string
	PaymentID string
	// AmountRefunded is the total that stays refunded on the payment once the
	// failed refund no longer counts, in the minor unit of Currency, as the
	// provider's API reports it.
	AmountRefunded int64
	// Currency is the ISO 4217 code of AmountRefunded, in capitals.
	Currency string
}

// Disputed reports that the reader has disputed one payment with their bank.
type Disputed struct {
	ID        string
	PaymentID string
}

// DisputeLost reports that the reader's bank decided the dispute of one payment
// against the tenant and returned the money to the reader for good. A dispute
// decided for the tenant is no event: the payment stands, and the purchase
// stays revoked as [Disputed] left it.
type DisputeLost struct {
	ID        string
	PaymentID string
}

// CheckoutExpired reports a checkout that closed without being paid. It
// revokes nothing, since nothing was bought, but the reader's next checkout of
// the same episode has to be a new one.
type CheckoutExpired struct {
	ID         string
	CheckoutID string
	Purchase   Purchase
}

// Ignored is a notification the purchase flow has no use for.
type Ignored struct {
	ID   string
	Type string
}

func (e PurchaseCompleted) NotificationID() string { return e.ID }
func (e Refunded) NotificationID() string          { return e.ID }
func (e RefundFailed) NotificationID() string      { return e.ID }
func (e Disputed) NotificationID() string          { return e.ID }
func (e DisputeLost) NotificationID() string       { return e.ID }
func (e CheckoutExpired) NotificationID() string   { return e.ID }
func (e Ignored) NotificationID() string           { return e.ID }

func (PurchaseCompleted) isEvent() {}
func (Refunded) isEvent()          {}
func (RefundFailed) isEvent()      {}
func (Disputed) isEvent()          {}
func (DisputeLost) isEvent()       {}
func (CheckoutExpired) isEvent()   {}
func (Ignored) isEvent()           {}

// Provider is one web payment provider.
type Provider interface {
	Declaration() Declaration
	// StartCheckout answers the URL the reader is sent to in order to pay.
	StartCheckout(ctx context.Context, credentials Credentials, req CheckoutRequest) (string, error)
	// ParseNotification verifies a notification against the tenant's
	// credentials and reads it, consulting the provider's API when the
	// notification alone does not say what the purchase flow needs. It
	// answers [ErrInvalidSignature] for a notification that does not verify
	// and [ErrMalformedNotification] for one that verifies but cannot be read.
	ParseNotification(ctx context.Context, payload []byte, headers http.Header, credentials Credentials) (Event, error)
	// Refund returns to the reader req.Amount of a payment, or whatever of it
	// has not been refunded yet when that is zero, and reports whether it
	// refunded anything. An amount above what is left is [ErrRefundRefused]. A payment already
	// refunded in full, in the provider's dashboard or by an earlier request,
	// is false and no error, so a request made again succeeds without
	// refunding anything; one the provider answers from its idempotency key
	// reports the refund that key made. It answers [ErrRefundRefused] for a
	// refund the provider will not make, and for one it answers as failed or
	// canceled at once. What it refunded reaches the purchase flow as the
	// provider's [Refunded] notification, as a refund made in the provider's
	// own dashboard does, and a refund that fails later as [RefundFailed].
	Refund(ctx context.Context, credentials Credentials, req RefundRequest) (bool, error)
}
