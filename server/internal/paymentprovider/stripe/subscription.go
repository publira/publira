package stripe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	stripego "github.com/stripe/stripe-go/v87"

	"github.com/publira/publira/server/internal/paymentprovider"
)

// MetadataPlanID is the metadata key a subscription checkout carries its plan
// in, beside MetadataTenantID and MetadataUserID. The session and the
// subscription it starts carry the same three, so every notification about
// the subscription names whose it is.
const MetadataPlanID = "subscription_plan_id"

var _ paymentprovider.Subscriptions = (*Provider)(nil)

// DescribePrice reads a Price. Only a Price that bills one fixed amount every
// period describes a plan, so one that bills once, by tiers, by usage, or at an
// amount the customer chooses is answered as not found.
func (p *Provider) DescribePrice(ctx context.Context, credentials paymentprovider.Credentials, priceID string) (paymentprovider.Price, error) {
	client, err := p.client(credentials)
	if err != nil {
		return paymentprovider.Price{}, err
	}
	price, err := client.V1Prices.Retrieve(ctx, priceID, &stripego.PriceRetrieveParams{})
	if err != nil {
		var stripeErr *stripego.Error
		if errors.As(err, &stripeErr) && stripeErr.Code == stripego.ErrorCodeResourceMissing {
			return paymentprovider.Price{}, paymentprovider.ErrPriceNotFound
		}
		return paymentprovider.Price{}, fmt.Errorf("read price: %w", err)
	}
	if price.Type != stripego.PriceTypeRecurring || price.Recurring == nil ||
		price.Recurring.UsageType == stripego.PriceRecurringUsageTypeMetered ||
		price.BillingScheme == stripego.PriceBillingSchemeTiered ||
		price.CustomUnitAmount != nil {
		return paymentprovider.Price{}, fmt.Errorf("%w: the price is not one fixed amount every period", paymentprovider.ErrPriceNotFound)
	}
	interval := paymentprovider.Interval(price.Recurring.Interval)
	switch interval {
	case paymentprovider.IntervalDay, paymentprovider.IntervalWeek, paymentprovider.IntervalMonth, paymentprovider.IntervalYear:
	default:
		return paymentprovider.Price{}, fmt.Errorf("price bills every %q, which is no interval this provider knows", price.Recurring.Interval)
	}
	return paymentprovider.Price{
		ID:            price.ID,
		Active:        price.Active,
		Amount:        price.UnitAmount,
		Currency:      strings.ToUpper(string(price.Currency)),
		Interval:      interval,
		IntervalCount: price.Recurring.IntervalCount,
	}, nil
}

// StartSubscriptionCheckout starts a Checkout Session in subscription mode.
// The reader may enter one of the tenant's promotion codes, as on a checkout
// of an episode.
func (p *Provider) StartSubscriptionCheckout(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.SubscriptionCheckoutRequest) (string, error) {
	client, err := p.client(credentials)
	if err != nil {
		return "", err
	}
	successURL, err := withSessionID(req.SuccessURL)
	if err != nil {
		return "", err
	}
	metadata := map[string]string{
		MetadataTenantID: req.TenantID.String(),
		MetadataUserID:   req.ReaderID.String(),
		MetadataPlanID:   req.PlanID.String(),
	}
	params := &stripego.CheckoutSessionCreateParams{
		AllowPromotionCodes: stripego.Bool(true),
		CancelURL:           stripego.String(req.CancelURL),
		LineItems: []*stripego.CheckoutSessionCreateLineItemParams{{
			Price:    stripego.String(req.PriceID),
			Quantity: stripego.Int64(1),
		}},
		Metadata:         metadata,
		Mode:             stripego.String(string(stripego.CheckoutSessionModeSubscription)),
		SubscriptionData: &stripego.CheckoutSessionCreateSubscriptionDataParams{Metadata: metadata},
		SuccessURL:       stripego.String(successURL),
	}
	if req.CustomerID != "" {
		params.Customer = stripego.String(req.CustomerID)
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

// StartBillingPortal opens a session of Stripe's customer portal, configured
// in the tenant's own Stripe Dashboard.
func (p *Provider) StartBillingPortal(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.BillingPortalRequest) (string, error) {
	client, err := p.client(credentials)
	if err != nil {
		return "", err
	}
	session, err := client.V1BillingPortalSessions.Create(ctx, &stripego.BillingPortalSessionCreateParams{
		Customer:  stripego.String(req.CustomerID),
		ReturnURL: stripego.String(req.ReturnURL),
	})
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(session.URL) == "" {
		return "", errors.New("stripe returned an empty billing portal URL")
	}
	return session.URL, nil
}

// sessionMode reads which kind of checkout a checkout.session event is about,
// so a subscription's is not read as a purchase.
func sessionMode(event *stripego.Event) (stripego.CheckoutSessionMode, error) {
	var session struct {
		Mode stripego.CheckoutSessionMode `json:"mode"`
	}
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		return "", fmt.Errorf("%w: checkout session: %v", paymentprovider.ErrMalformedNotification, err)
	}
	return session.Mode, nil
}

// subscriptionCheckoutEvent reads the subscription a completed subscription
// checkout started. A session another integration started names no plan, and
// is acknowledged rather than refused into days of retries.
func (p *Provider) subscriptionCheckoutEvent(ctx context.Context, credentials paymentprovider.Credentials, event *stripego.Event) (paymentprovider.Event, error) {
	var session stripego.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		return nil, fmt.Errorf("%w: checkout session: %v", paymentprovider.ErrMalformedNotification, err)
	}
	if _, ok := session.Metadata[MetadataPlanID]; !ok {
		return paymentprovider.Ignored{ID: event.ID, Type: string(event.Type)}, nil
	}
	if session.Subscription == nil || strings.TrimSpace(session.Subscription.ID) == "" {
		return nil, fmt.Errorf("%w: the checkout session names no subscription", paymentprovider.ErrMalformedNotification)
	}
	return p.subscriptionChangedEvent(ctx, credentials, event, session.Subscription.ID)
}

// subscriptionUpdatedEvent reads the subscription a customer.subscription
// event is about.
func (p *Provider) subscriptionUpdatedEvent(ctx context.Context, credentials paymentprovider.Credentials, event *stripego.Event) (paymentprovider.Event, error) {
	var subscription stripego.Subscription
	if err := json.Unmarshal(event.Data.Raw, &subscription); err != nil {
		return nil, fmt.Errorf("%w: subscription: %v", paymentprovider.ErrMalformedNotification, err)
	}
	if _, ok := subscription.Metadata[MetadataPlanID]; !ok {
		return paymentprovider.Ignored{ID: event.ID, Type: string(event.Type)}, nil
	}
	if strings.TrimSpace(subscription.ID) == "" {
		return nil, fmt.Errorf("%w: the subscription has no id", paymentprovider.ErrMalformedNotification)
	}
	return p.subscriptionChangedEvent(ctx, credentials, event, subscription.ID)
}

// invoicePaymentFailedEvent reads the subscription whose invoice could not be
// paid. An invoice no subscription raised is no concern of a plan.
func (p *Provider) invoicePaymentFailedEvent(ctx context.Context, credentials paymentprovider.Credentials, event *stripego.Event) (paymentprovider.Event, error) {
	var invoice stripego.Invoice
	if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
		return nil, fmt.Errorf("%w: invoice: %v", paymentprovider.ErrMalformedNotification, err)
	}
	if invoice.Parent == nil || invoice.Parent.SubscriptionDetails == nil || invoice.Parent.SubscriptionDetails.Subscription == nil {
		return paymentprovider.Ignored{ID: event.ID, Type: string(event.Type)}, nil
	}
	if _, ok := invoice.Parent.SubscriptionDetails.Metadata[MetadataPlanID]; !ok {
		return paymentprovider.Ignored{ID: event.ID, Type: string(event.Type)}, nil
	}
	subscriptionID := strings.TrimSpace(invoice.Parent.SubscriptionDetails.Subscription.ID)
	if subscriptionID == "" {
		return nil, fmt.Errorf("%w: the invoice names no subscription", paymentprovider.ErrMalformedNotification)
	}
	return p.subscriptionChangedEvent(ctx, credentials, event, subscriptionID)
}

// subscriptionChangedEvent answers the subscription as Stripe holds it now
// rather than as the event carried it. Stripe orders neither its events nor
// their retries, so the copy in an event can be older than one already
// recorded; what the API answers never is.
func (p *Provider) subscriptionChangedEvent(ctx context.Context, credentials paymentprovider.Credentials, event *stripego.Event, subscriptionID string) (paymentprovider.Event, error) {
	client, err := p.client(credentials)
	if err != nil {
		return nil, err
	}
	subscription, err := client.V1Subscriptions.Retrieve(ctx, subscriptionID, &stripego.SubscriptionRetrieveParams{})
	if err != nil {
		var stripeErr *stripego.Error
		if errors.As(err, &stripeErr) && stripeErr.Code == stripego.ErrorCodeResourceMissing {
			return nil, fmt.Errorf("%w: the subscription is not found", paymentprovider.ErrMalformedNotification)
		}
		return nil, fmt.Errorf("read subscription: %w", err)
	}
	read, err := readSubscription(subscription)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", paymentprovider.ErrMalformedNotification, err)
	}
	return paymentprovider.SubscriptionChanged{ID: event.ID, Subscription: read}, nil
}

// readSubscription reads the subscription a subscription checkout started. A
// plan bills one Price, so the subscription's first item is the one it bills.
func readSubscription(subscription *stripego.Subscription) (paymentprovider.Subscription, error) {
	parseID := func(key string) (uuid.UUID, error) {
		id, err := uuid.Parse(subscription.Metadata[key])
		if err != nil {
			return uuid.Nil, fmt.Errorf("invalid %s metadata: %w", key, err)
		}
		return id, nil
	}
	tenantID, err := parseID(MetadataTenantID)
	if err != nil {
		return paymentprovider.Subscription{}, err
	}
	readerID, err := parseID(MetadataUserID)
	if err != nil {
		return paymentprovider.Subscription{}, err
	}
	planID, err := parseID(MetadataPlanID)
	if err != nil {
		return paymentprovider.Subscription{}, err
	}
	if strings.TrimSpace(subscription.ID) == "" {
		return paymentprovider.Subscription{}, errors.New("the subscription has no id")
	}
	if subscription.Customer == nil || strings.TrimSpace(subscription.Customer.ID) == "" {
		return paymentprovider.Subscription{}, errors.New("the subscription names no customer")
	}
	status := paymentprovider.SubscriptionStatus(subscription.Status)
	if !status.Known() {
		return paymentprovider.Subscription{}, fmt.Errorf("unknown subscription status %q", subscription.Status)
	}
	if subscription.Items == nil || len(subscription.Items.Data) == 0 || subscription.Items.Data[0] == nil {
		return paymentprovider.Subscription{}, errors.New("the subscription has no item")
	}
	item := subscription.Items.Data[0]
	if item.Price == nil || strings.TrimSpace(item.Price.ID) == "" {
		return paymentprovider.Subscription{}, errors.New("the subscription item names no price")
	}
	var currentPeriodEnd time.Time
	if item.CurrentPeriodEnd > 0 {
		currentPeriodEnd = time.Unix(item.CurrentPeriodEnd, 0).UTC()
	}
	return paymentprovider.Subscription{
		ID:                subscription.ID,
		CustomerID:        subscription.Customer.ID,
		TenantID:          tenantID,
		ReaderID:          readerID,
		PlanID:            planID,
		PriceID:           item.Price.ID,
		Status:            status,
		CurrentPeriodEnd:  currentPeriodEnd,
		CancelAtPeriodEnd: subscription.CancelAtPeriodEnd,
	}, nil
}
