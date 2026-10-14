// Package stripe is the Stripe Checkout payment provider: a hosted Checkout
// Session per purchase, confirmed by its webhook.
package stripe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/google/uuid"
	stripego "github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"

	"github.com/publira/publira/server/internal/paymentprovider"
)

const (
	// ID is the provider id stored in a tenant's payment settings.
	ID = "stripe"

	// FieldSecretKey and FieldWebhookSecret are the credential fields Stripe
	// declares.
	FieldSecretKey     = "secret_key"
	FieldWebhookSecret = "webhook_secret"

	// SignatureHeader is the header Stripe signs its webhooks with.
	SignatureHeader = "Stripe-Signature"

	// The metadata keys a Checkout Session carries its purchase in.
	MetadataTenantID           = "tenant_id"
	MetadataUserID             = "user_id"
	MetadataEpisodeID          = "episode_id"
	MetadataPrice              = "price"
	MetadataReadingPeriodHours = "reading_period_hours"
)

// currencies are the currencies Stripe's documentation states a minimum charge
// for. Stripe charges each in its ISO 4217 minor unit; ISK and UGX, which it
// charges in hundredths although ISO 4217 gives them no minor unit, are not
// among them, since a price stored for them would charge a hundredth of what
// the tenant set.
var currencies = []string{
	"AED", "ARS", "AUD", "BRL", "CAD", "CHF", "COP", "CZK", "DKK", "EUR", "GBP",
	"HKD", "HUF", "IDR", "ILS", "INR", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD",
	"PHP", "PLN", "RON", "RUB", "SEK", "SGD", "THB", "USD", "ZAR",
}

// Provider is Stripe Checkout.
type Provider struct {
	// backends point the client at another API origin, and are nil for
	// Stripe's own.
	backends *stripego.Backends
}

// Option configures a [Provider].
type Option func(*Provider)

// WithAPIURL points the provider at another Stripe API origin, as a test's
// fake of it. The client logs nothing, since a test that asks the fake for a
// refund it refuses means to be refused.
func WithAPIURL(apiURL string) Option {
	return func(p *Provider) {
		p.backends = stripego.NewBackendsWithConfig(&stripego.BackendConfig{
			URL:           stripego.String(apiURL),
			LeveledLogger: &stripego.LeveledLogger{Level: stripego.LevelNull},
		})
	}
}

// New answers the Stripe provider.
func New(options ...Option) *Provider {
	p := &Provider{}
	for _, option := range options {
		option(p)
	}
	return p
}

func (p *Provider) client(credentials paymentprovider.Credentials) (*stripego.Client, error) {
	secretKey := strings.TrimSpace(credentials[FieldSecretKey])
	if secretKey == "" {
		return nil, errors.New("stripe secret key is not configured")
	}
	if p.backends == nil {
		return stripego.NewClient(secretKey), nil
	}
	return stripego.NewClient(secretKey, stripego.WithBackends(p.backends)), nil
}

func (*Provider) Declaration() paymentprovider.Declaration {
	return paymentprovider.Declaration{
		ID:          ID,
		DisplayName: "Stripe",
		Fields: []paymentprovider.Field{
			{Name: FieldSecretKey, Secret: true, Required: true},
			{Name: FieldWebhookSecret, Secret: true, Required: true},
		},
		SignatureHeader: SignatureHeader,
		Currencies:      currencies,
	}
}

func (p *Provider) StartCheckout(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.CheckoutRequest) (string, error) {
	client, err := p.client(credentials)
	if err != nil {
		return "", err
	}
	successURL, err := withSessionID(req.SuccessURL)
	if err != nil {
		return "", err
	}
	params := &stripego.CheckoutSessionCreateParams{
		CancelURL: stripego.String(req.CancelURL),
		LineItems: []*stripego.CheckoutSessionCreateLineItemParams{{
			PriceData: &stripego.CheckoutSessionCreateLineItemPriceDataParams{
				Currency: stripego.String(strings.ToLower(req.Purchase.Currency)),
				ProductData: &stripego.CheckoutSessionCreateLineItemPriceDataProductDataParams{
					Name: stripego.String(req.EpisodeTitle),
				},
				UnitAmount: stripego.Int64(int64(req.Purchase.Price)),
			},
			Quantity: stripego.Int64(1),
		}},
		Metadata:   purchaseMetadata(req.Purchase),
		Mode:       stripego.String(string(stripego.CheckoutSessionModePayment)),
		SuccessURL: stripego.String(successURL),
	}
	params.SetIdempotencyKey(req.IdempotencyKey)
	session, err := client.V1CheckoutSessions.Create(ctx, params)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(session.URL) == "" {
		return "", errors.New("stripe returned an empty Checkout URL")
	}
	return session.URL, nil
}

// withSessionID has Stripe name the Checkout Session in the URL the reader
// returns to, which the storefront reads as `session_id`.
func withSessionID(successURL string) (string, error) {
	parsed, err := url.Parse(successURL)
	if err != nil {
		return "", fmt.Errorf("parse success URL: %w", err)
	}
	query := parsed.Query()
	query.Set("session_id", "{CHECKOUT_SESSION_ID}")
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func purchaseMetadata(purchase paymentprovider.Purchase) map[string]string {
	metadata := map[string]string{
		MetadataTenantID:  purchase.TenantID.String(),
		MetadataUserID:    purchase.ReaderID.String(),
		MetadataEpisodeID: purchase.EpisodeID.String(),
		MetadataPrice:     strconv.FormatInt(int64(purchase.Price), 10),
	}
	if purchase.ReadingPeriodHours > 0 {
		metadata[MetadataReadingPeriodHours] = strconv.FormatInt(int64(purchase.ReadingPeriodHours), 10)
	}
	return metadata
}

// Refund refunds the payment intent, leaving the amount out so that Stripe
// refunds whatever of it is left.
func (p *Provider) Refund(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.RefundRequest) error {
	client, err := p.client(credentials)
	if err != nil {
		return err
	}
	params := &stripego.RefundCreateParams{PaymentIntent: stripego.String(req.PaymentID)}
	params.SetIdempotencyKey(req.IdempotencyKey)
	_, err = client.V1Refunds.Create(ctx, params)
	var stripeErr *stripego.Error
	if !errors.As(err, &stripeErr) {
		return err
	}
	switch {
	// Stripe keeps an idempotency key for a day, so a repeat after that is a
	// new request, refused because the earlier one went through.
	case stripeErr.Code == stripego.ErrorCodeChargeAlreadyRefunded:
		return nil
	case stripeErr.Type == stripego.ErrorTypeInvalidRequest && stripeErr.HTTPStatusCode < http.StatusInternalServerError:
		return fmt.Errorf("%w: %s", paymentprovider.ErrRefundRefused, stripeErr.Msg)
	default:
		return err
	}
}

func (*Provider) ParseNotification(_ context.Context, payload []byte, headers http.Header, credentials paymentprovider.Credentials) (paymentprovider.Event, error) {
	event, err := webhook.ConstructEvent(payload, headers.Get(SignatureHeader), credentials[FieldWebhookSecret])
	if err != nil {
		return nil, paymentprovider.ErrInvalidSignature
	}
	switch event.Type {
	case stripego.EventTypeChargeRefunded:
		return refundedEvent(&event)
	case stripego.EventTypeChargeDisputeCreated:
		return disputedEvent(&event)
	case stripego.EventTypeCheckoutSessionCompleted, stripego.EventTypeCheckoutSessionAsyncPaymentSucceeded:
		return purchaseCompletedEvent(&event)
	case stripego.EventTypeCheckoutSessionExpired:
		return checkoutExpiredEvent(&event)
	default:
		return paymentprovider.Ignored{ID: event.ID, Type: string(event.Type)}, nil
	}
}

func refundedEvent(event *stripego.Event) (paymentprovider.Event, error) {
	var charge stripego.Charge
	if err := json.Unmarshal(event.Data.Raw, &charge); err != nil {
		return nil, fmt.Errorf("%w: charge: %v", paymentprovider.ErrMalformedNotification, err)
	}
	paymentIntentID := ""
	if charge.PaymentIntent != nil {
		paymentIntentID = strings.TrimSpace(charge.PaymentIntent.ID)
	}
	if paymentIntentID == "" {
		return nil, fmt.Errorf("%w: the charge names no payment intent", paymentprovider.ErrMalformedNotification)
	}
	return paymentprovider.Refunded{
		ID:             event.ID,
		PaymentID:      paymentIntentID,
		AmountRefunded: charge.AmountRefunded,
		Currency:       strings.ToUpper(string(charge.Currency)),
	}, nil
}

func disputedEvent(event *stripego.Event) (paymentprovider.Event, error) {
	var dispute stripego.Dispute
	if err := json.Unmarshal(event.Data.Raw, &dispute); err != nil {
		return nil, fmt.Errorf("%w: dispute: %v", paymentprovider.ErrMalformedNotification, err)
	}
	paymentIntentID := ""
	if dispute.PaymentIntent != nil {
		paymentIntentID = strings.TrimSpace(dispute.PaymentIntent.ID)
	}
	if paymentIntentID == "" {
		return nil, fmt.Errorf("%w: the dispute names no payment intent", paymentprovider.ErrMalformedNotification)
	}
	return paymentprovider.Disputed{
		ID:        event.ID,
		PaymentID: paymentIntentID,
	}, nil
}

func checkoutExpiredEvent(event *stripego.Event) (paymentprovider.Event, error) {
	var session stripego.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		return nil, fmt.Errorf("%w: checkout session: %v", paymentprovider.ErrMalformedNotification, err)
	}
	if strings.TrimSpace(session.ID) == "" {
		return nil, fmt.Errorf("%w: the checkout session has no id", paymentprovider.ErrMalformedNotification)
	}
	// A session this integration did not start names no purchase. Its expiry
	// changes nothing here, so it is acknowledged rather than refused into
	// days of retries.
	purchase, err := parsePurchaseMetadata(session.Metadata)
	if err != nil {
		return paymentprovider.Ignored{ID: event.ID, Type: string(event.Type)}, nil
	}
	purchase.Currency = strings.ToUpper(string(session.Currency))
	return paymentprovider.CheckoutExpired{
		ID:         event.ID,
		CheckoutID: session.ID,
		Purchase:   purchase,
	}, nil
}

func purchaseCompletedEvent(event *stripego.Event) (paymentprovider.Event, error) {
	var session stripego.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		return nil, fmt.Errorf("%w: checkout session: %v", paymentprovider.ErrMalformedNotification, err)
	}
	purchase, err := parsePurchaseMetadata(session.Metadata)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", paymentprovider.ErrMalformedNotification, err)
	}
	// A delayed method such as konbini completes the session before the money
	// arrives; checkout.session.async_payment_succeeded reports the payment.
	if event.Type == stripego.EventTypeCheckoutSessionCompleted && session.PaymentStatus == stripego.CheckoutSessionPaymentStatusUnpaid {
		return paymentprovider.Ignored{ID: event.ID, Type: string(event.Type)}, nil
	}
	if session.PaymentStatus != stripego.CheckoutSessionPaymentStatusPaid {
		return nil, errors.New("checkout session was not paid")
	}
	if session.AmountTotal != int64(purchase.Price) || strings.TrimSpace(session.ID) == "" {
		return nil, errors.New("checkout session amount or ID is invalid")
	}
	purchase.Currency = strings.ToUpper(string(session.Currency))
	// The refund events this purchase may later receive name the payment
	// intent and never the session, so the event has to carry it.
	paymentIntentID := ""
	if session.PaymentIntent != nil {
		paymentIntentID = strings.TrimSpace(session.PaymentIntent.ID)
	}
	return paymentprovider.PurchaseCompleted{
		ID:         event.ID,
		CheckoutID: session.ID,
		PaymentID:  paymentIntentID,
		Purchase:   purchase,
		Test:       !session.Livemode,
	}, nil
}

func parsePurchaseMetadata(metadata map[string]string) (paymentprovider.Purchase, error) {
	parseID := func(key string) (uuid.UUID, error) {
		id, err := uuid.Parse(metadata[key])
		if err != nil {
			return uuid.Nil, fmt.Errorf("invalid %s metadata: %w", key, err)
		}
		return id, nil
	}
	tenantID, err := parseID(MetadataTenantID)
	if err != nil {
		return paymentprovider.Purchase{}, err
	}
	userID, err := parseID(MetadataUserID)
	if err != nil {
		return paymentprovider.Purchase{}, err
	}
	episodeID, err := parseID(MetadataEpisodeID)
	if err != nil {
		return paymentprovider.Purchase{}, err
	}
	price, err := strconv.ParseInt(metadata[MetadataPrice], 10, 32)
	if err != nil || price <= 0 {
		return paymentprovider.Purchase{}, errors.New("invalid price metadata")
	}
	readingPeriodHours := int64(0)
	if value, ok := metadata[MetadataReadingPeriodHours]; ok {
		readingPeriodHours, err = strconv.ParseInt(value, 10, 32)
		if err != nil || readingPeriodHours < 0 {
			return paymentprovider.Purchase{}, errors.New("invalid reading period metadata")
		}
	}
	return paymentprovider.Purchase{
		TenantID:           tenantID,
		ReaderID:           userID,
		EpisodeID:          episodeID,
		Price:              int32(price),
		ReadingPeriodHours: int32(readingPeriodHours),
	}, nil
}
