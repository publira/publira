package paymentprovider

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrPriceNotFound reports a price id the tenant's account holds no price a
// plan can bill at under: none at all, or one that is not a single fixed
// amount billed every period.
var ErrPriceNotFound = errors.New("the payment provider holds no such recurring price")

// ErrSubscriptionNotFound reports a subscription id the tenant's account holds
// no subscription under.
var ErrSubscriptionNotFound = errors.New("the payment provider holds no such subscription")

// ErrCheckoutNotOpen reports a checkout that could not be expired because it
// had already completed or expired.
var ErrCheckoutNotOpen = errors.New("the checkout is no longer open")

// Subscriptions is what a provider that sells subscription plans implements
// beside [Provider]. A provider that does not is one a tenant cannot sell a
// plan through.
type Subscriptions interface {
	// DescribePrice answers the recurring price priceID names on the tenant's
	// account, or [ErrPriceNotFound] when there is none.
	DescribePrice(ctx context.Context, credentials Credentials, priceID string) (Price, error)
	// StartSubscriptionCheckout starts the checkout the reader is sent to in
	// order to subscribe.
	StartSubscriptionCheckout(ctx context.Context, credentials Credentials, req SubscriptionCheckoutRequest) (SubscriptionCheckout, error)
	// GetSubscriptionCheckout answers a checkout StartSubscriptionCheckout
	// started, as it stands now.
	GetSubscriptionCheckout(ctx context.Context, credentials Credentials, checkoutID string) (SubscriptionCheckout, error)
	// ExpireSubscriptionCheckout closes an open checkout, so the reader can no
	// longer pay it. A checkout that has already completed or expired answers
	// [ErrCheckoutNotOpen].
	ExpireSubscriptionCheckout(ctx context.Context, credentials Credentials, checkoutID string) error
	// RetrieveSubscription answers a subscription as the provider holds it now,
	// or [ErrSubscriptionNotFound].
	RetrieveSubscription(ctx context.Context, credentials Credentials, subscriptionID string) (Subscription, error)
	// StartBillingPortal answers the URL of the provider's own page where the
	// reader manages the subscriptions of one customer.
	StartBillingPortal(ctx context.Context, credentials Credentials, req BillingPortalRequest) (string, error)
	// CancelSubscription ends a subscription now rather than at the end of the
	// period paid for, and refunds nothing of that period. A subscription the
	// account does not hold answers [ErrSubscriptionNotFound].
	CancelSubscription(ctx context.Context, credentials Credentials, subscriptionID string) error
}

// Interval is the unit a recurring price is billed every so many of, spelled
// as subscription_plans.recurring_interval stores it.
type Interval string

const (
	IntervalDay   Interval = "day"
	IntervalWeek  Interval = "week"
	IntervalMonth Interval = "month"
	IntervalYear  Interval = "year"
)

// Price is one recurring price on a tenant's account.
type Price struct {
	ID string
	// Active is false for a price the tenant has archived, which no new
	// subscription may be started at.
	Active bool
	// Amount is in the minor unit of Currency.
	Amount int64
	// Currency is the ISO 4217 code, in capitals.
	Currency string
	// Interval and IntervalCount say how often the price bills: every
	// IntervalCount Intervals.
	Interval      Interval
	IntervalCount int64
}

// SubscriptionCheckoutRequest starts one reader's checkout of one plan.
type SubscriptionCheckoutRequest struct {
	TenantID uuid.UUID
	ReaderID uuid.UUID
	PlanID   uuid.UUID
	// PriceID is the provider's id of the plan's recurring price.
	PriceID string
	// CustomerID is the provider's customer the reader subscribed as before,
	// and empty for a reader who never has, whom the provider makes one for.
	CustomerID string
	// SuccessURL and CancelURL are where the reader returns to afterwards.
	SuccessURL string
	CancelURL  string
	// IdempotencyKey is the same for every attempt that sends the same request,
	// as [CheckoutRequest.IdempotencyKey] is.
	IdempotencyKey string
}

// SubscriptionCheckoutStatus is where a subscription checkout stands.
type SubscriptionCheckoutStatus string

const (
	// SubscriptionCheckoutOpen is a checkout the reader may still pay.
	SubscriptionCheckoutOpen SubscriptionCheckoutStatus = "open"
	// SubscriptionCheckoutComplete is one the reader paid, which started a
	// subscription.
	SubscriptionCheckoutComplete SubscriptionCheckoutStatus = "complete"
	// SubscriptionCheckoutExpired is one that closed unpaid.
	SubscriptionCheckoutExpired SubscriptionCheckoutStatus = "expired"
)

// SubscriptionCheckout is one checkout of a plan.
type SubscriptionCheckout struct {
	// ID is the provider's id of the checkout.
	ID     string
	Status SubscriptionCheckoutStatus
	// URL is where the reader pays, set while the checkout is open.
	URL string
	// SubscriptionID is the subscription a completed checkout started.
	SubscriptionID string
}

// BillingPortalRequest opens the provider's billing page for one customer.
type BillingPortalRequest struct {
	CustomerID string
	// ReturnURL is where the page sends the reader back to.
	ReturnURL string
}

// SubscriptionStatus is a subscription's state, spelled as
// subscriptions.status stores it. Each value is Stripe's own status of the
// same name.
type SubscriptionStatus string

const (
	SubscriptionIncomplete        SubscriptionStatus = "incomplete"
	SubscriptionIncompleteExpired SubscriptionStatus = "incomplete_expired"
	SubscriptionTrialing          SubscriptionStatus = "trialing"
	SubscriptionActive            SubscriptionStatus = "active"
	SubscriptionPastDue           SubscriptionStatus = "past_due"
	SubscriptionCanceled          SubscriptionStatus = "canceled"
	SubscriptionUnpaid            SubscriptionStatus = "unpaid"
	SubscriptionPaused            SubscriptionStatus = "paused"
)

// Known reports whether s is one of the statuses subscriptions.status holds.
func (s SubscriptionStatus) Known() bool {
	switch s {
	case SubscriptionIncomplete, SubscriptionIncompleteExpired, SubscriptionTrialing, SubscriptionActive,
		SubscriptionPastDue, SubscriptionCanceled, SubscriptionUnpaid, SubscriptionPaused:
		return true
	}
	return false
}

// Billed reports whether the provider goes on billing a subscription in status
// s, the statuses the billed_subscriptions view selects. An incomplete one is
// not among them, since the provider drops it unless its first payment goes
// through, and it becomes active if that payment does.
func (s SubscriptionStatus) Billed() bool {
	switch s {
	case SubscriptionTrialing, SubscriptionActive, SubscriptionPastDue, SubscriptionUnpaid, SubscriptionPaused:
		return true
	}
	return false
}

// Subscription is one subscription a plan's checkout started, as the provider
// reports it now.
type Subscription struct {
	// ID is the provider's id of the subscription.
	ID string
	// CustomerID is the provider's customer it bills.
	CustomerID string
	// TenantID, ReaderID, and PlanID are what the checkout that started it
	// named.
	TenantID uuid.UUID
	ReaderID uuid.UUID
	PlanID   uuid.UUID
	// CheckoutPriceID is the price that checkout was started at, which PlanID
	// was billed at then.
	CheckoutPriceID string
	// PriceID is the price it bills at now, which differs from the plan's when
	// the reader changed it on the provider's billing page.
	PriceID string
	Status  SubscriptionStatus
	// CurrentPeriodEnd is the end of the period paid for, and zero when the
	// provider reports none.
	CurrentPeriodEnd  time.Time
	CancelAtPeriodEnd bool
}

// SubscriptionChanged reports that a subscription a plan's checkout started
// has changed, whichever change the notification was about. It names the
// subscription rather than carrying it: the copy in a notification can be older
// than one already recorded, since a provider orders neither its notifications
// nor their retries, so the purchase flow reads the subscription with
// [Subscriptions.RetrieveSubscription] while it holds the subscription's lock.
type SubscriptionChanged struct {
	ID             string
	SubscriptionID string
}

func (e SubscriptionChanged) NotificationID() string { return e.ID }

func (SubscriptionChanged) isEvent() {}
