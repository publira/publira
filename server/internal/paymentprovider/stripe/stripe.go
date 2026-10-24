// Package stripe is the Stripe Checkout payment provider: a hosted Checkout
// Session per purchase or subscription, confirmed by its webhook.
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
	MetadataTenantID  = "tenant_id"
	MetadataUserID    = "user_id"
	MetadataEpisodeID = "episode_id"
	// MetadataVolumeID is present, in place of MetadataEpisodeID, on a
	// checkout of a volume.
	MetadataVolumeID = "volume_id"
	// MetadataSeriesBundleID is present, in place of MetadataEpisodeID, on a
	// checkout of the rest of a series.
	MetadataSeriesBundleID     = "series_bundle_id"
	MetadataPrice              = "price"
	MetadataReadingPeriodHours = "reading_period_hours"
	// MetadataKind is absent on a checkout started before an episode had
	// two sales, which sold the permanent copy.
	MetadataKind = "kind"
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

// WithAPIURL points the provider at another Stripe API origin, a fake of it in
// a test or in the E2E stack. The client logs nothing, since a test that asks
// the fake for a refund it refuses means to be refused.
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
	currency := strings.ToLower(req.Purchase.Currency)
	lines := req.LineItems
	if len(lines) == 0 {
		lines = []paymentprovider.LineItem{{Name: req.LineItemName, Price: req.Purchase.Price}}
	}
	lineItems := make([]*stripego.CheckoutSessionCreateLineItemParams, 0, len(lines))
	for _, line := range lines {
		lineItems = append(lineItems, &stripego.CheckoutSessionCreateLineItemParams{
			PriceData: &stripego.CheckoutSessionCreateLineItemPriceDataParams{
				Currency: stripego.String(currency),
				ProductData: &stripego.CheckoutSessionCreateLineItemPriceDataProductDataParams{
					Name: stripego.String(line.Name),
				},
				UnitAmount: stripego.Int64(int64(line.Price)),
			},
			Quantity: stripego.Int64(1),
		})
	}
	params := &stripego.CheckoutSessionCreateParams{
		CancelURL:  stripego.String(req.CancelURL),
		LineItems:  lineItems,
		Metadata:   purchaseMetadata(req.Purchase),
		Mode:       stripego.String(string(stripego.CheckoutSessionModePayment)),
		SuccessURL: stripego.String(successURL),
	}
	// The reader may enter one of the tenant's promotion codes on the checkout
	// page, except on a checkout that takes a discount of its own: Stripe
	// takes one or the other on a session, never both.
	if req.Discount != nil {
		couponID, err := createDiscountCoupon(ctx, client, currency, *req.Discount, req.IdempotencyKey)
		if err != nil {
			return "", err
		}
		params.Discounts = []*stripego.CheckoutSessionCreateDiscountParams{{Coupon: stripego.String(couponID)}}
	} else {
		params.AllowPromotionCodes = stripego.Bool(true)
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

// couponNameLimit is the longest name Stripe takes for a coupon, in
// characters.
const couponNameLimit = 40

// createDiscountCoupon makes the coupon one checkout applies its discount
// with: a fixed amount, so the session's total is exactly the price the
// purchase records, redeemable once, on the one checkout it is made for. A
// retried request reuses it under the checkout's own idempotency key.
func createDiscountCoupon(ctx context.Context, client *stripego.Client, currency string, discount paymentprovider.Discount, idempotencyKey string) (string, error) {
	name := []rune(discount.Name)
	if len(name) > couponNameLimit {
		name = name[:couponNameLimit]
	}
	params := &stripego.CouponCreateParams{
		AmountOff:      stripego.Int64(int64(discount.Amount)),
		Currency:       stripego.String(currency),
		Duration:       stripego.String(string(stripego.CouponDurationOnce)),
		MaxRedemptions: stripego.Int64(1),
		Name:           stripego.String(string(name)),
	}
	params.SetIdempotencyKey(idempotencyKey + ":discount")
	coupon, err := client.V1Coupons.Create(ctx, params)
	if err != nil {
		return "", fmt.Errorf("create discount coupon: %w", err)
	}
	return coupon.ID, nil
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
		MetadataTenantID: purchase.TenantID.String(),
		MetadataUserID:   purchase.ReaderID.String(),
		MetadataPrice:    strconv.FormatInt(int64(purchase.Price), 10),
	}
	switch {
	case purchase.VolumeID != uuid.Nil:
		metadata[MetadataVolumeID] = purchase.VolumeID.String()
	case purchase.SeriesBundleID != uuid.Nil:
		metadata[MetadataSeriesBundleID] = purchase.SeriesBundleID.String()
	default:
		metadata[MetadataEpisodeID] = purchase.EpisodeID.String()
	}
	if purchase.ReadingPeriodHours > 0 {
		metadata[MetadataReadingPeriodHours] = strconv.FormatInt(int64(purchase.ReadingPeriodHours), 10)
	}
	if purchase.Kind != "" {
		metadata[MetadataKind] = string(purchase.Kind)
	}
	return metadata
}

// Refund refunds the payment intent, leaving the amount out so that Stripe
// refunds whatever of it is left.
func (p *Provider) Refund(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.RefundRequest) (bool, error) {
	client, err := p.client(credentials)
	if err != nil {
		return false, err
	}
	params := &stripego.RefundCreateParams{PaymentIntent: stripego.String(req.PaymentID)}
	params.SetIdempotencyKey(req.IdempotencyKey)
	refund, err := client.V1Refunds.Create(ctx, params)
	if err == nil {
		if refund.Status == stripego.RefundStatusFailed || refund.Status == stripego.RefundStatusCanceled {
			return false, fmt.Errorf("%w: the refund is %s", paymentprovider.ErrRefundRefused, refund.Status)
		}
		return true, nil
	}
	var stripeErr *stripego.Error
	if !errors.As(err, &stripeErr) {
		return false, err
	}
	switch {
	// The payment was refunded in full before: in the dashboard, or by a
	// request whose idempotency key Stripe, which keeps one for a day, has
	// forgotten.
	case stripeErr.Code == stripego.ErrorCodeChargeAlreadyRefunded:
		return false, nil
	// A 429 is contention on the payment, such as lock_timeout, which a later
	// attempt can get past.
	case stripeErr.Type == stripego.ErrorTypeInvalidRequest &&
		stripeErr.HTTPStatusCode < http.StatusInternalServerError &&
		stripeErr.HTTPStatusCode != http.StatusTooManyRequests:
		return false, fmt.Errorf("%w: %s", paymentprovider.ErrRefundRefused, stripeErr.Msg)
	default:
		return false, err
	}
}

func (p *Provider) ParseNotification(ctx context.Context, payload []byte, headers http.Header, credentials paymentprovider.Credentials) (paymentprovider.Event, error) {
	event, err := webhook.ConstructEvent(payload, headers.Get(SignatureHeader), credentials[FieldWebhookSecret])
	if err != nil {
		return nil, paymentprovider.ErrInvalidSignature
	}
	switch event.Type {
	case stripego.EventTypeChargeRefunded:
		return refundedEvent(&event)
	case stripego.EventTypeRefundFailed, stripego.EventTypeRefundUpdated:
		return p.refundFailedEvent(ctx, credentials, &event)
	case stripego.EventTypeChargeDisputeCreated:
		return disputedEvent(&event)
	case stripego.EventTypeChargeDisputeClosed:
		return disputeClosedEvent(&event)
	case stripego.EventTypeCheckoutSessionCompleted, stripego.EventTypeCheckoutSessionAsyncPaymentSucceeded:
		mode, err := sessionMode(&event)
		if err != nil {
			return nil, err
		}
		if mode == stripego.CheckoutSessionModeSubscription {
			return p.subscriptionCheckoutEvent(ctx, credentials, &event)
		}
		return purchaseCompletedEvent(&event)
	case stripego.EventTypeCheckoutSessionExpired:
		// An abandoned subscription checkout leaves nothing to record: its
		// idempotency key moves on by the hour rather than by the expiry.
		mode, err := sessionMode(&event)
		if err != nil {
			return nil, err
		}
		if mode == stripego.CheckoutSessionModeSubscription {
			return paymentprovider.Ignored{ID: event.ID, Type: string(event.Type)}, nil
		}
		return checkoutExpiredEvent(&event)
	case stripego.EventTypeCustomerSubscriptionUpdated, stripego.EventTypeCustomerSubscriptionDeleted:
		return p.subscriptionUpdatedEvent(ctx, credentials, &event)
	case stripego.EventTypeInvoicePaymentFailed:
		return p.invoicePaymentFailedEvent(ctx, credentials, &event)
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

// refundFailedEvent reads a refund that failed, which refund.failed reports,
// or that was canceled, which only refund.updated does, and the total that
// stays refunded on its payment from the payment's charge: the event is about
// the refund alone. Any other update of a refund is ignored.
func (p *Provider) refundFailedEvent(ctx context.Context, credentials paymentprovider.Credentials, event *stripego.Event) (paymentprovider.Event, error) {
	var refund stripego.Refund
	if err := json.Unmarshal(event.Data.Raw, &refund); err != nil {
		return nil, fmt.Errorf("%w: refund: %v", paymentprovider.ErrMalformedNotification, err)
	}
	if refund.Status != stripego.RefundStatusFailed && refund.Status != stripego.RefundStatusCanceled {
		return paymentprovider.Ignored{ID: event.ID, Type: string(event.Type)}, nil
	}
	paymentIntentID := ""
	if refund.PaymentIntent != nil {
		paymentIntentID = strings.TrimSpace(refund.PaymentIntent.ID)
	}
	if paymentIntentID == "" {
		return nil, fmt.Errorf("%w: the refund names no payment intent", paymentprovider.ErrMalformedNotification)
	}
	client, err := p.client(credentials)
	if err != nil {
		return nil, err
	}
	params := &stripego.PaymentIntentRetrieveParams{}
	params.AddExpand("latest_charge")
	intent, err := client.V1PaymentIntents.Retrieve(ctx, paymentIntentID, params)
	if err != nil {
		var stripeErr *stripego.Error
		if errors.As(err, &stripeErr) && stripeErr.Code == stripego.ErrorCodeResourceMissing {
			return nil, fmt.Errorf("%w: the payment intent is not found", paymentprovider.ErrMalformedNotification)
		}
		return nil, fmt.Errorf("read payment intent: %w", err)
	}
	if intent.LatestCharge == nil {
		return nil, fmt.Errorf("%w: the payment intent has no charge", paymentprovider.ErrMalformedNotification)
	}
	return paymentprovider.RefundFailed{
		ID:             event.ID,
		PaymentID:      paymentIntentID,
		AmountRefunded: intent.LatestCharge.AmountRefunded,
		Currency:       strings.ToUpper(string(intent.LatestCharge.Currency)),
	}, nil
}

func disputedEvent(event *stripego.Event) (paymentprovider.Event, error) {
	_, paymentIntentID, err := readDispute(event)
	if err != nil {
		return nil, err
	}
	return paymentprovider.Disputed{
		ID:        event.ID,
		PaymentID: paymentIntentID,
	}, nil
}

// disputeClosedEvent reads a dispute Stripe has closed. Only a lost one
// returns the money to the reader; a won one leaves the payment with the
// tenant, and an inquiry closed without becoming a chargeback never took it.
func disputeClosedEvent(event *stripego.Event) (paymentprovider.Event, error) {
	dispute, paymentIntentID, err := readDispute(event)
	if err != nil {
		return nil, err
	}
	if dispute.Status != stripego.DisputeStatusLost {
		return paymentprovider.Ignored{ID: event.ID, Type: string(event.Type)}, nil
	}
	return paymentprovider.DisputeLost{
		ID:        event.ID,
		PaymentID: paymentIntentID,
	}, nil
}

// readDispute reads the dispute an event is about and the payment intent it
// disputes, which the purchase names as its payment.
func readDispute(event *stripego.Event) (stripego.Dispute, string, error) {
	var dispute stripego.Dispute
	if err := json.Unmarshal(event.Data.Raw, &dispute); err != nil {
		return dispute, "", fmt.Errorf("%w: dispute: %v", paymentprovider.ErrMalformedNotification, err)
	}
	paymentIntentID := ""
	if dispute.PaymentIntent != nil {
		paymentIntentID = strings.TrimSpace(dispute.PaymentIntent.ID)
	}
	if paymentIntentID == "" {
		return dispute, "", fmt.Errorf("%w: the dispute names no payment intent", paymentprovider.ErrMalformedNotification)
	}
	return dispute, paymentIntentID, nil
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
	if strings.TrimSpace(session.ID) == "" {
		return nil, errors.New("checkout session has no ID")
	}
	promotionCodeID := sessionPromotionCode(&session)
	amountPaid, err := paidAmount(&session, purchase.Price, promotionCodeID)
	if err != nil {
		return nil, err
	}
	purchase.Currency = strings.ToUpper(string(session.Currency))
	// The refund events this purchase may later receive name the payment
	// intent and never the session, so the event has to carry it.
	paymentIntentID := ""
	if session.PaymentIntent != nil {
		paymentIntentID = strings.TrimSpace(session.PaymentIntent.ID)
	}
	return paymentprovider.PurchaseCompleted{
		ID:              event.ID,
		CheckoutID:      session.ID,
		PaymentID:       paymentIntentID,
		Purchase:        purchase,
		AmountPaid:      amountPaid,
		PromotionCodeID: promotionCodeID,
		Test:            !session.Livemode,
	}, nil
}

// sessionPromotionCode answers the id of the promotion code the reader entered
// on the session, and empty when they entered none. The coupon a checkout of a
// series bundle takes its discount with is a discount of the session too, but
// one with no promotion code.
func sessionPromotionCode(session *stripego.CheckoutSession) string {
	for _, discount := range session.Discounts {
		if discount != nil && discount.PromotionCode != nil {
			if id := strings.TrimSpace(discount.PromotionCode.ID); id != "" {
				return id
			}
		}
	}
	return ""
}

// paidAmount cross-checks what the session charged against the price the
// checkout was started at, and answers what the reader paid.
//
// Without a promotion code the session's total is that price. With one, the
// price is the session's subtotal and the total is what is left of it once
// the code's discount is taken off, which may be nothing at all: a code that
// takes off the whole price completes the session with no payment to make.
// Anything else is a session this checkout did not start, or one whose
// amounts changed after it did, and is refused rather than recorded at a
// price nobody set.
func paidAmount(session *stripego.CheckoutSession, price int32, promotionCodeID string) (int32, error) {
	if promotionCodeID == "" {
		if session.PaymentStatus != stripego.CheckoutSessionPaymentStatusPaid {
			return 0, errors.New("checkout session was not paid")
		}
		if session.AmountTotal != int64(price) {
			return 0, errors.New("checkout session amount does not match the price")
		}
		return price, nil
	}
	if session.AmountSubtotal != int64(price) || session.AmountTotal < 0 || session.AmountTotal > session.AmountSubtotal {
		return 0, errors.New("checkout session amount does not match the price and its promotion code")
	}
	switch session.PaymentStatus {
	case stripego.CheckoutSessionPaymentStatusPaid:
	case stripego.CheckoutSessionPaymentStatusNoPaymentRequired:
		if session.AmountTotal != 0 {
			return 0, errors.New("checkout session required no payment of a total above zero")
		}
	default:
		return 0, errors.New("checkout session was not paid")
	}
	return int32(session.AmountTotal), nil
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
	// A checkout sells one of an episode, a volume, and a series bundle, and
	// one started before volumes existed names an episode.
	var episodeID, volumeID, seriesBundleID uuid.UUID
	_, sellsVolume := metadata[MetadataVolumeID]
	_, sellsSeriesBundle := metadata[MetadataSeriesBundleID]
	_, sellsEpisode := metadata[MetadataEpisodeID]
	switch {
	case sellsVolume && (sellsEpisode || sellsSeriesBundle), sellsSeriesBundle && sellsEpisode:
		return paymentprovider.Purchase{}, errors.New("metadata names more than one of an episode, a volume, and a series bundle")
	case sellsVolume:
		volumeID, err = parseID(MetadataVolumeID)
	case sellsSeriesBundle:
		seriesBundleID, err = parseID(MetadataSeriesBundleID)
	default:
		episodeID, err = parseID(MetadataEpisodeID)
	}
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
	kind, err := paymentprovider.ParseKind(metadata[MetadataKind], readingPeriodHours)
	if err != nil {
		return paymentprovider.Purchase{}, fmt.Errorf("invalid kind metadata: %w", err)
	}
	if sellsVolume {
		if err := paymentprovider.CheckVolumeSale(kind, readingPeriodHours); err != nil {
			return paymentprovider.Purchase{}, fmt.Errorf("invalid volume metadata: %w", err)
		}
	}
	if sellsSeriesBundle {
		if err := paymentprovider.CheckSeriesBundleSale(kind, readingPeriodHours); err != nil {
			return paymentprovider.Purchase{}, fmt.Errorf("invalid series bundle metadata: %w", err)
		}
	}
	return paymentprovider.Purchase{
		TenantID:           tenantID,
		ReaderID:           userID,
		EpisodeID:          episodeID,
		VolumeID:           volumeID,
		SeriesBundleID:     seriesBundleID,
		Kind:               kind,
		Price:              int32(price),
		ReadingPeriodHours: int32(readingPeriodHours),
	}, nil
}
