package stripe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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

// MetadataPriceID is the metadata key a subscription checkout carries the
// Price it was started at in, beside MetadataPlanID: the plan billed at that
// Price then, which staff may since have handed to another plan.
const MetadataPriceID = "subscription_price_id"

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
func (p *Provider) StartSubscriptionCheckout(ctx context.Context, credentials paymentprovider.Credentials, req paymentprovider.SubscriptionCheckoutRequest) (paymentprovider.SubscriptionCheckout, error) {
	client, err := p.client(credentials)
	if err != nil {
		return paymentprovider.SubscriptionCheckout{}, err
	}
	successURL, err := withSessionID(req.SuccessURL)
	if err != nil {
		return paymentprovider.SubscriptionCheckout{}, err
	}
	metadata := map[string]string{
		MetadataTenantID: req.TenantID.String(),
		MetadataUserID:   req.ReaderID.String(),
		MetadataPlanID:   req.PlanID.String(),
		MetadataPriceID:  req.PriceID,
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
		return paymentprovider.SubscriptionCheckout{}, err
	}
	if strings.TrimSpace(session.ID) == "" || strings.TrimSpace(session.URL) == "" {
		return paymentprovider.SubscriptionCheckout{}, errors.New("stripe returned a Checkout Session with no id or URL")
	}
	return subscriptionCheckout(session), nil
}

// GetSubscriptionCheckout reads a Checkout Session.
func (p *Provider) GetSubscriptionCheckout(ctx context.Context, credentials paymentprovider.Credentials, checkoutID string) (paymentprovider.SubscriptionCheckout, error) {
	client, err := p.client(credentials)
	if err != nil {
		return paymentprovider.SubscriptionCheckout{}, err
	}
	session, err := client.V1CheckoutSessions.Retrieve(ctx, checkoutID, &stripego.CheckoutSessionRetrieveParams{})
	if err != nil {
		return paymentprovider.SubscriptionCheckout{}, fmt.Errorf("read checkout session: %w", err)
	}
	return subscriptionCheckout(session), nil
}

// ExpireSubscriptionCheckout expires an open Checkout Session. Stripe refuses
// one that is not open any more, which is answered as
// [paymentprovider.ErrCheckoutNotOpen] for the caller to read it again.
func (p *Provider) ExpireSubscriptionCheckout(ctx context.Context, credentials paymentprovider.Credentials, checkoutID string) error {
	client, err := p.client(credentials)
	if err != nil {
		return err
	}
	_, err = client.V1CheckoutSessions.Expire(ctx, checkoutID, &stripego.CheckoutSessionExpireParams{})
	var stripeErr *stripego.Error
	if errors.As(err, &stripeErr) && stripeErr.Type == stripego.ErrorTypeInvalidRequest &&
		stripeErr.HTTPStatusCode == http.StatusBadRequest {
		return fmt.Errorf("%w: %s", paymentprovider.ErrCheckoutNotOpen, stripeErr.Msg)
	}
	if err != nil {
		return fmt.Errorf("expire checkout session: %w", err)
	}
	return nil
}

func subscriptionCheckout(session *stripego.CheckoutSession) paymentprovider.SubscriptionCheckout {
	checkout := paymentprovider.SubscriptionCheckout{ID: session.ID}
	switch session.Status {
	case stripego.CheckoutSessionStatusComplete:
		checkout.Status = paymentprovider.SubscriptionCheckoutComplete
	case stripego.CheckoutSessionStatusExpired:
		checkout.Status = paymentprovider.SubscriptionCheckoutExpired
	default:
		checkout.Status = paymentprovider.SubscriptionCheckoutOpen
		checkout.URL = session.URL
	}
	if session.Subscription != nil {
		checkout.SubscriptionID = session.Subscription.ID
	}
	return checkout
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
func subscriptionCheckoutEvent(event *stripego.Event) (paymentprovider.Event, error) {
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
	return subscriptionChangedEvent(event, session.Subscription.ID), nil
}

// subscriptionUpdatedEvent reads the subscription a customer.subscription
// event is about.
func subscriptionUpdatedEvent(event *stripego.Event) (paymentprovider.Event, error) {
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
	return subscriptionChangedEvent(event, subscription.ID), nil
}

// invoicePaymentFailedEvent reads the subscription whose invoice could not be
// paid. An invoice no subscription raised is no concern of a plan.
func invoicePaymentFailedEvent(event *stripego.Event) (paymentprovider.Event, error) {
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
	return subscriptionChangedEvent(event, subscriptionID), nil
}

// subscriptionChangedEvent names the subscription a notification is about.
// The subscription itself is read by [Provider.RetrieveSubscription], which
// the purchase flow calls while it holds the subscription's lock.
func subscriptionChangedEvent(event *stripego.Event, subscriptionID string) paymentprovider.Event {
	return paymentprovider.SubscriptionChanged{ID: event.ID, SubscriptionID: subscriptionID}
}

// RetrieveSubscription reads a subscription as Stripe holds it now.
func (p *Provider) RetrieveSubscription(ctx context.Context, credentials paymentprovider.Credentials, subscriptionID string) (paymentprovider.Subscription, error) {
	client, err := p.client(credentials)
	if err != nil {
		return paymentprovider.Subscription{}, err
	}
	subscription, err := client.V1Subscriptions.Retrieve(ctx, subscriptionID, &stripego.SubscriptionRetrieveParams{})
	if err != nil {
		var stripeErr *stripego.Error
		if errors.As(err, &stripeErr) && stripeErr.Code == stripego.ErrorCodeResourceMissing {
			return paymentprovider.Subscription{}, paymentprovider.ErrSubscriptionNotFound
		}
		return paymentprovider.Subscription{}, fmt.Errorf("read subscription: %w", err)
	}
	read, err := readSubscription(subscription)
	if err != nil {
		return paymentprovider.Subscription{}, fmt.Errorf("read subscription %s: %w", subscriptionID, err)
	}
	return read, nil
}

// CancelSubscription cancels a subscription at once. Stripe neither prorates
// the period paid for nor invoices it again, so the reader is charged nothing
// further and refunded nothing.
func (p *Provider) CancelSubscription(ctx context.Context, credentials paymentprovider.Credentials, subscriptionID string) error {
	client, err := p.client(credentials)
	if err != nil {
		return err
	}
	_, err = client.V1Subscriptions.Cancel(ctx, subscriptionID, &stripego.SubscriptionCancelParams{})
	if err != nil {
		var stripeErr *stripego.Error
		if errors.As(err, &stripeErr) && stripeErr.Code == stripego.ErrorCodeResourceMissing {
			return paymentprovider.ErrSubscriptionNotFound
		}
		return fmt.Errorf("cancel subscription: %w", err)
	}
	return nil
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
		CheckoutPriceID:   subscription.Metadata[MetadataPriceID],
		PriceID:           item.Price.ID,
		Status:            status,
		CurrentPeriodEnd:  currentPeriodEnd,
		CancelAtPeriodEnd: subscription.CancelAtPeriodEnd,
	}, nil
}
