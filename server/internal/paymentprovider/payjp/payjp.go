// Package payjp is the PAY.JP payment provider on its API v2: a hosted
// Checkout Session per purchase, confirmed by its notification and by the
// payment flow the notification names.
package payjp

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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

	// The notification types the purchase flow reads.
	EventCheckoutSessionCompleted = "checkout.session.completed"
	EventRefundCreated            = "refund.created"
	EventRefundUpdated            = "refund.updated"

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
	threeDSecure := payjpv2.CheckoutSessionPaymentMethodOptionsCardRequestRequestThreeDSecureAny
	body := payjpv2.CheckoutSessionCreateRequest{
		Mode:       payjpv2.CheckoutSessionModePayment,
		SuccessUrl: &req.SuccessURL,
		CancelUrl:  &req.CancelURL,
		LineItems: &[]payjpv2.LineItemRequest{{
			PriceData: &payjpv2.PriceDataRequest{
				Currency:    payjpv2.CurrencyJpy,
				ProductData: &payjpv2.ProductDataRequest{Name: req.EpisodeTitle},
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
	// reports is taken from the API rather than from the payload.
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
	if flow.Currency != payjpv2.CurrencyJpy || flow.AmountReceived == nil || *flow.AmountReceived != int(purchase.Price) {
		return nil, errors.New("payment flow was not paid in JPY for the purchase's price")
	}
	return paymentprovider.PurchaseCompleted{
		ID:         event.ID,
		CheckoutID: session.ID,
		PaymentID:  flow.Id,
		Purchase:   purchase,
	}, nil
}

func (p *Provider) refundedEvent(ctx context.Context, credentials paymentprovider.Credentials, event notification) (paymentprovider.Event, error) {
	var refund struct {
		PaymentFlowID string `json:"payment_flow_id"`
	}
	if err := json.Unmarshal(event.Data, &refund); err != nil {
		return nil, fmt.Errorf("%w: refund: %v", paymentprovider.ErrMalformedNotification, err)
	}
	if strings.TrimSpace(refund.PaymentFlowID) == "" {
		return nil, fmt.Errorf("%w: the refund names no payment flow", paymentprovider.ErrMalformedNotification)
	}

	// A refund notification carries that refund's amount alone, and the
	// purchase flow records the total refunded on the payment.
	total, err := p.refundedTotal(ctx, credentials, refund.PaymentFlowID)
	if err != nil {
		return nil, err
	}
	if total == 0 {
		return paymentprovider.Ignored{ID: event.ID, Type: event.Type}, nil
	}
	return paymentprovider.Refunded{
		ID:             event.ID,
		PaymentID:      refund.PaymentFlowID,
		AmountRefunded: total,
		// Every Checkout Session this provider starts charges in yen.
		Currency: "JPY",
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
			return 0, apiError("payment flow refunds", err)
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
	return paymentprovider.Purchase{
		TenantID:           tenantID,
		ReaderID:           userID,
		EpisodeID:          episodeID,
		Price:              int32(price),
		ReadingPeriodHours: int32(readingPeriodHours),
	}, nil
}
