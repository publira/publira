// Package payjp is the PAY.JP payment provider on its API v2: a hosted
// Checkout Session per purchase, confirmed by its notification and by the
// payment flow the notification names.
package payjp

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	payjpv2 "github.com/payjp/payjpv2-go"

	"github.com/publira/publira/server/internal/paymentprovider"
)

const (
	// ID is the provider id stored in a tenant's payment settings.
	ID = "payjp"

	// FieldSecretKey and FieldWebhookToken are the credential fields PAY.JP
	// declares.
	FieldSecretKey    = "secret_key"
	FieldWebhookToken = "webhook_token"

	// WebhookTokenHeader is the header PAY.JP sends the account's webhook
	// token in. PAY.JP does not sign the payload itself.
	WebhookTokenHeader = "X-Payjp-Webhook-Token"

	// The metadata keys a Checkout Session carries its purchase in.
	MetadataTenantID           = "tenant_id"
	MetadataUserID             = "user_id"
	MetadataEpisodeID          = "episode_id"
	MetadataPrice              = "price"
	MetadataReadingPeriodHours = "reading_period_hours"
	// MetadataKind is absent on a checkout started before an episode had
	// two sales, which sold the permanent copy.
	MetadataKind = "kind"

	// The notification types the purchase flow reads.
	EventCheckoutSessionCompleted = "checkout.session.completed"
	EventRefundCreated            = "refund.created"
	EventRefundUpdated            = "refund.updated"

	// currency is the one currency PAY.JP charges in.
	currency = "JPY"

	// refundPageSize is the most refunds one list request answers.
	refundPageSize = 100
)

// Provider is PAY.JP Checkout on API v2.
type Provider struct {
	baseURL    string
	httpClient payjpv2.HttpRequestDoer
}

// Option configures a [Provider].
type Option func(*Provider)

// WithBaseURL points the provider at another PAY.JP API origin, as a test's
// fake of it.
func WithBaseURL(baseURL string) Option {
	return func(p *Provider) {
		p.baseURL = baseURL
	}
}

// New answers the PAY.JP provider.
func New(options ...Option) *Provider {
	p := &Provider{
		baseURL: payjpv2.DEFAULT_BASE_URL,
		// PAY.JP gives up on a notification after ten seconds, so a read of
		// its API that takes longer has already failed the delivery.
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
	for _, option := range options {
		option(p)
	}
	return p
}

func (*Provider) Declaration() paymentprovider.Declaration {
	return paymentprovider.Declaration{
		ID:          ID,
		DisplayName: "PAY.JP",
		Fields: []paymentprovider.Field{
			{Name: FieldSecretKey, Secret: true, Required: true},
			{Name: FieldWebhookToken, Secret: true, Required: true},
		},
		SignatureHeader: WebhookTokenHeader,
		Currencies:      []string{currency},
	}
}

func (p *Provider) client(credentials paymentprovider.Credentials) (*payjpv2.ClientWithResponses, error) {
	secretKey := strings.TrimSpace(credentials[FieldSecretKey])
	if secretKey == "" {
		return nil, errors.New("payjp secret key is not configured")
	}
	return payjpv2.NewPayjpClientWithResponses(secretKey, payjpv2.WithBaseURL(p.baseURL), payjpv2.WithHTTPClient(p.httpClient))
}

func (p *Provider) StartCheckout(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.CheckoutRequest) (string, error) {
	client, err := p.client(credentials)
	if err != nil {
		return "", err
	}
	metadata, err := sessionMetadata(req.Purchase)
	if err != nil {
		return "", err
	}
	successURL, err := withReturnKey(req.SuccessURL, req.IdempotencyKey)
	if err != nil {
		return "", err
	}
	threeDSecure := payjpv2.CheckoutSessionPaymentMethodOptionsCardRequestRequestThreeDSecureAny
	body := payjpv2.CheckoutSessionCreateRequest{
		Mode:       payjpv2.CheckoutSessionModePayment,
		SuccessUrl: &successURL,
		CancelUrl:  &req.CancelURL,
		LineItems: &[]payjpv2.LineItemRequest{{
			PriceData: &payjpv2.PriceDataRequest{
				Currency:    payjpv2.Currency(strings.ToLower(req.Purchase.Currency)),
				ProductData: &payjpv2.ProductDataRequest{Name: req.LineItemName},
				UnitAmount:  int(req.Purchase.Price),
			},
			Quantity: 1,
		}},
		Metadata: &metadata,
		// Cards are the method the Japanese card industry's guideline
		// requires 3-D Secure on, and the only one this checkout offers.
		PaymentMethodTypes: &[]payjpv2.PaymentMethodTypes{payjpv2.PaymentMethodTypesCard},
		PaymentMethodOptions: &payjpv2.CheckoutSessionPaymentMethodOptionsRequest{
			Card: &payjpv2.CheckoutSessionPaymentMethodOptionsCardRequest{RequestThreeDSecure: &threeDSecure},
		},
	}
	res, err := payjpv2.Extract(client.CreateCheckoutSessionWithResponse(ctx, body, payjpv2.WithIdempotencyKey(req.IdempotencyKey)))
	if err != nil {
		return "", err
	}
	if res.Result == nil || strings.TrimSpace(res.Result.Url) == "" {
		return "", errors.New("payjp returned an empty Checkout URL")
	}
	return res.Result.Url, nil
}

// withReturnKey names the checkout in the URL the reader returns to, which the
// storefront reads as `session_id` to key its first read after payment apart
// from the locked one cached before checkout. PAY.JP has no placeholder for the
// session's id, so the value comes from the idempotency key, which keeps a
// retried request identical.
func withReturnKey(successURL, idempotencyKey string) (string, error) {
	parsed, err := url.Parse(successURL)
	if err != nil {
		return "", fmt.Errorf("parse success URL: %w", err)
	}
	sum := sha256.Sum256([]byte(idempotencyKey))
	query := parsed.Query()
	query.Set("session_id", hex.EncodeToString(sum[:16]))
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func sessionMetadata(purchase paymentprovider.Purchase) (map[string]payjpv2.CheckoutSessionCreateRequest_Metadata_AdditionalProperties, error) {
	values := map[string]string{
		MetadataTenantID:  purchase.TenantID.String(),
		MetadataUserID:    purchase.ReaderID.String(),
		MetadataEpisodeID: purchase.EpisodeID.String(),
		MetadataPrice:     strconv.FormatInt(int64(purchase.Price), 10),
	}
	if purchase.ReadingPeriodHours > 0 {
		values[MetadataReadingPeriodHours] = strconv.FormatInt(int64(purchase.ReadingPeriodHours), 10)
	}
	if purchase.Kind != "" {
		values[MetadataKind] = string(purchase.Kind)
	}
	metadata := make(map[string]payjpv2.CheckoutSessionCreateRequest_Metadata_AdditionalProperties, len(values))
	for key, value := range values {
		var property payjpv2.CheckoutSessionCreateRequest_Metadata_AdditionalProperties
		if err := property.FromCheckoutSessionCreateRequestMetadata0(value); err != nil {
			return nil, fmt.Errorf("encode %s metadata: %w", key, err)
		}
		metadata[key] = property
	}
	return metadata, nil
}

// notification is the envelope every PAY.JP notification arrives in; data is
// the object the event is about.
type notification struct {
	ID   string          `json:"id"`
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func (p *Provider) ParseNotification(ctx context.Context, payload []byte, headers http.Header, credentials paymentprovider.Credentials) (paymentprovider.Event, error) {
	token := credentials[FieldWebhookToken]
	if token == "" || subtle.ConstantTimeCompare([]byte(headers.Get(WebhookTokenHeader)), []byte(token)) != 1 {
		return nil, paymentprovider.ErrInvalidSignature
	}
	var event notification
	if err := json.Unmarshal(payload, &event); err != nil {
		return nil, fmt.Errorf("%w: event: %v", paymentprovider.ErrMalformedNotification, err)
	}
	switch event.Type {
	case EventCheckoutSessionCompleted:
		return p.purchaseCompletedEvent(ctx, credentials, event)
	case EventRefundCreated, EventRefundUpdated:
		return p.refundedEvent(ctx, credentials, event)
	default:
		return paymentprovider.Ignored{ID: event.ID, Type: event.Type}, nil
	}
}

func (p *Provider) purchaseCompletedEvent(ctx context.Context, credentials paymentprovider.Credentials, event notification) (paymentprovider.Event, error) {
	var session struct {
		ID            string                     `json:"id"`
		PaymentFlowID string                     `json:"payment_flow_id"`
		Metadata      map[string]json.RawMessage `json:"metadata"`
	}
	if err := json.Unmarshal(event.Data, &session); err != nil {
		return nil, fmt.Errorf("%w: checkout session: %v", paymentprovider.ErrMalformedNotification, err)
	}
	if strings.TrimSpace(session.ID) == "" || strings.TrimSpace(session.PaymentFlowID) == "" {
		return nil, fmt.Errorf("%w: the checkout session names no id or payment flow", paymentprovider.ErrMalformedNotification)
	}
	purchase, err := parsePurchaseMetadata(session.Metadata)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", paymentprovider.ErrMalformedNotification, err)
	}

	// The notification is authenticated by a token alone, so the payment it
	// reports, and whether it was made in test mode, is taken from the API
	// rather than from the payload.
	client, err := p.client(credentials)
	if err != nil {
		return nil, err
	}
	res, err := payjpv2.Extract(client.GetPaymentFlowWithResponse(ctx, session.PaymentFlowID))
	if err != nil {
		return nil, apiError("payment flow", err)
	}
	flow := res.Result
	if flow == nil {
		return nil, errors.New("payjp returned no payment flow")
	}
	switch flow.Status {
	case payjpv2.PaymentFlowStatusSucceeded:
	case payjpv2.PaymentFlowStatusProcessing, payjpv2.PaymentFlowStatusRequiresCapture:
		// Failing the delivery has PAY.JP retry it once the payment settles.
		return nil, fmt.Errorf("payment flow %s has not settled: %s", flow.Id, flow.Status)
	default:
		return paymentprovider.Ignored{ID: event.ID, Type: event.Type}, nil
	}
	if flow.AmountReceived == nil || *flow.AmountReceived != int(purchase.Price) {
		return nil, errors.New("payment flow was not paid the purchase's price")
	}
	purchase.Currency = strings.ToUpper(string(flow.Currency))
	return paymentprovider.PurchaseCompleted{
		ID:         event.ID,
		CheckoutID: session.ID,
		PaymentID:  flow.Id,
		Purchase:   purchase,
		Test:       !flow.Livemode,
	}, nil
}

func (p *Provider) refundedEvent(ctx context.Context, credentials paymentprovider.Credentials, event notification) (paymentprovider.Event, error) {
	var refund struct {
		ID            string `json:"id"`
		PaymentFlowID string `json:"payment_flow_id"`
		Status        string `json:"status"`
	}
	if err := json.Unmarshal(event.Data, &refund); err != nil {
		return nil, fmt.Errorf("%w: refund: %v", paymentprovider.ErrMalformedNotification, err)
	}
	if strings.TrimSpace(refund.PaymentFlowID) == "" {
		return nil, fmt.Errorf("%w: the refund names no payment flow", paymentprovider.ErrMalformedNotification)
	}
	// A refund the notification says failed is confirmed with the API, as
	// everything else the notification says is, before it reopens anything.
	failed := false
	if refundFailed(payjpv2.PaymentRefundStatus(refund.Status)) {
		client, err := p.client(credentials)
		if err != nil {
			return nil, err
		}
		res, err := payjpv2.Extract(client.GetPaymentRefundWithResponse(ctx, refund.ID))
		if err != nil {
			return nil, apiError("refund", err)
		}
		if res.Result == nil {
			return nil, errors.New("payjp returned no refund")
		}
		failed = res.Result.PaymentFlowId == refund.PaymentFlowID && refundFailed(res.Result.Status)
	}

	// A refund notification carries that refund's amount alone, and the
	// purchase flow records the total refunded on the payment.
	total, err := p.refundedTotal(ctx, credentials, refund.PaymentFlowID)
	if err != nil {
		return nil, apiError("payment flow refunds", err)
	}
	if failed {
		return paymentprovider.RefundFailed{
			ID:             event.ID,
			PaymentID:      refund.PaymentFlowID,
			AmountRefunded: total,
			Currency:       currency,
		}, nil
	}
	if total == 0 {
		return paymentprovider.Ignored{ID: event.ID, Type: event.Type}, nil
	}
	return paymentprovider.Refunded{
		ID:             event.ID,
		PaymentID:      refund.PaymentFlowID,
		AmountRefunded: total,
		// A refund names no currency, and is in the payment's, which is the
		// one PAY.JP charges in.
		Currency: currency,
	}, nil
}

// refundedTotal sums the refunds of a payment flow that have gone through.
func (p *Provider) refundedTotal(ctx context.Context, credentials paymentprovider.Credentials, paymentFlowID string) (int64, error) {
	client, err := p.client(credentials)
	if err != nil {
		return 0, err
	}
	var total int64
	params := &payjpv2.GetPaymentFlowRefundsParams{Limit: new(refundPageSize)}
	for {
		res, err := payjpv2.Extract(client.GetPaymentFlowRefundsWithResponse(ctx, paymentFlowID, params))
		if err != nil {
			return 0, err
		}
		if res.Result == nil {
			return 0, errors.New("payjp returned no refund list")
		}
		for _, refund := range res.Result.Data {
			if refund.Status == payjpv2.PaymentRefundStatusSucceeded {
				total += int64(refund.Amount)
			}
		}
		if !res.Result.HasMore || len(res.Result.Data) == 0 {
			return total, nil
		}
		last := res.Result.Data[len(res.Result.Data)-1].Id
		params.StartingAfter = &last
	}
}

// Refund refunds what the payment flow has received and not yet refunded.
// PAY.JP refunds the whole amount received when none is named, which a flow
// refunded in part already would refuse, so the remainder is named instead.
func (p *Provider) Refund(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.RefundRequest) (bool, error) {
	client, err := p.client(credentials)
	if err != nil {
		return false, err
	}
	res, err := payjpv2.Extract(client.GetPaymentFlowWithResponse(ctx, req.PaymentID))
	if err != nil {
		return false, refundError("payment flow", err)
	}
	if res.Result == nil {
		return false, errors.New("payjp returned no payment flow")
	}
	if res.Result.AmountReceived == nil {
		return false, fmt.Errorf("%w: the payment flow has received nothing", paymentprovider.ErrRefundRefused)
	}
	refunded, err := p.refundedTotal(ctx, credentials, req.PaymentID)
	if err != nil {
		return false, refundError("payment flow refunds", err)
	}
	remaining := *res.Result.AmountReceived - int(refunded)
	if remaining <= 0 {
		return false, nil
	}
	// The remainder is part of the key: a retry that finds the same remainder
	// is the same request, and one that finds a refund made in between asks
	// for less, which PAY.JP would refuse under a key it has seen.
	idempotencyKey := req.IdempotencyKey + ":" + strconv.Itoa(remaining)
	body := payjpv2.PaymentRefundCreateRequest{PaymentFlowId: req.PaymentID, Amount: &remaining}
	created, err := payjpv2.Extract(client.CreatePaymentRefundWithResponse(ctx, body, payjpv2.WithIdempotencyKey(idempotencyKey)))
	if err != nil {
		return false, refundError("payment refund", err)
	}
	if created.Result != nil && refundFailed(created.Result.Status) {
		return false, fmt.Errorf("%w: the refund is %s", paymentprovider.ErrRefundRefused, created.Result.Status)
	}
	return true, nil
}

// refundFailed reports a refund status that returns nothing to the reader.
func refundFailed(status payjpv2.PaymentRefundStatus) bool {
	return status == payjpv2.PaymentRefundStatusFailed || status == payjpv2.PaymentRefundStatusCanceled
}

// refundError reads an answer the API gives for a request it will not carry
// out, as opposed to one it failed to answer, as a refund it refuses.
func refundError(object string, err error) error {
	var apiErr *payjpv2.APIError
	if errors.As(err, &apiErr) && apiErr.StatusCode >= http.StatusBadRequest && apiErr.StatusCode < http.StatusInternalServerError && apiErr.StatusCode != http.StatusTooManyRequests {
		return fmt.Errorf("%w: %s: %v", paymentprovider.ErrRefundRefused, object, err)
	}
	return fmt.Errorf("%s: %w", object, err)
}

// apiError reads an object the API does not have under the tenant's key as a
// notification that is not the tenant's, which no retry can change.
func apiError(object string, err error) error {
	var apiErr *payjpv2.APIError
	if errors.As(err, &apiErr) && apiErr.IsNotFound() {
		return fmt.Errorf("%w: the %s is not found", paymentprovider.ErrMalformedNotification, object)
	}
	return fmt.Errorf("read %s: %w", object, err)
}

func parsePurchaseMetadata(metadata map[string]json.RawMessage) (paymentprovider.Purchase, error) {
	value := func(key string) (string, bool) {
		raw, ok := metadata[key]
		if !ok {
			return "", false
		}
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return "", false
		}
		return s, true
	}
	parseID := func(key string) (uuid.UUID, error) {
		s, _ := value(key)
		id, err := uuid.Parse(s)
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
	priceValue, _ := value(MetadataPrice)
	price, err := strconv.ParseInt(priceValue, 10, 32)
	if err != nil || price <= 0 {
		return paymentprovider.Purchase{}, errors.New("invalid price metadata")
	}
	readingPeriodHours := int64(0)
	if hours, ok := value(MetadataReadingPeriodHours); ok {
		readingPeriodHours, err = strconv.ParseInt(hours, 10, 32)
		if err != nil || readingPeriodHours < 0 {
			return paymentprovider.Purchase{}, errors.New("invalid reading period metadata")
		}
	} else if _, present := metadata[MetadataReadingPeriodHours]; present {
		return paymentprovider.Purchase{}, errors.New("invalid reading period metadata")
	}
	kindValue, ok := value(MetadataKind)
	if _, present := metadata[MetadataKind]; present && !ok {
		return paymentprovider.Purchase{}, errors.New("invalid kind metadata")
	}
	kind, err := paymentprovider.ParseKind(kindValue)
	if err != nil {
		return paymentprovider.Purchase{}, fmt.Errorf("invalid kind metadata: %w", err)
	}
	return paymentprovider.Purchase{
		TenantID:           tenantID,
		ReaderID:           userID,
		EpisodeID:          episodeID,
		Kind:               kind,
		Price:              int32(price),
		ReadingPeriodHours: int32(readingPeriodHours),
	}, nil
}
