package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailrenderer"
)

// EventTypeSubscriptionStarted tells the reader that the first payment of a
// subscription they took out on the site went through: which plan they hold,
// what they paid, and until when the plan's episodes are open to them.
//
// It is queued in the transaction that records the subscription's first paid
// invoice, so a payment that commits always has its mail owed, and one that
// rolls back owes none. A subscription sold through the App Store or Google
// Play queues none: the store tells the reader itself.
const EventTypeSubscriptionStarted = "subscription_started"

// EventTypeSubscriptionRenewed tells the reader that a later invoice of their
// subscription was paid: what it charged, and until when the plan's episodes
// now stay open to them.
//
// It is queued in the transaction that records the paid invoice, as
// [EventTypeSubscriptionStarted] is, for every paid invoice that is not the
// one the subscription was created with. A subscription sold through the App
// Store or Google Play queues none.
const EventTypeSubscriptionRenewed = "subscription_renewed"

// SubscriptionPaymentEmailPayload names the payment a mail of
// [EventTypeSubscriptionStarted] or [EventTypeSubscriptionRenewed] is about.
// The worker reloads it, so the mail states what was recorded rather than what
// the notification claimed.
type SubscriptionPaymentEmailPayload struct {
	TenantID              string `json:"tenant_id"`
	SubscriptionPaymentID string `json:"subscription_payment_id"`
}

// SubscriptionStartedIdempotencyKey is the outbox key for the mail of one
// subscription's start. It names the subscription, so however often the
// provider redelivers the invoice that started it, one subscription is one
// mail.
func SubscriptionStartedIdempotencyKey(subscriptionID uuid.UUID) string {
	return EventTypeSubscriptionStarted + ":" + subscriptionID.String()
}

// SubscriptionRenewedIdempotencyKey is the outbox key for the mail of one paid
// renewal. It names the payment the invoice was recorded as, which is recorded
// once per invoice, so however often the provider redelivers the invoice, one
// renewal is one mail.
func SubscriptionRenewedIdempotencyKey(subscriptionPaymentID uuid.UUID) string {
	return EventTypeSubscriptionRenewed + ":" + subscriptionPaymentID.String()
}

// myPagePath is the storefront page that shows the reader's plan, and opens
// the provider's billing page from Manage billing.
const myPagePath = "/my"

// NewSubscriptionStartedEmailHandler sends the reader the mail of their
// subscription's start.
func NewSubscriptionStartedEmailHandler(cfg EmailHandlerConfig) Handler {
	return newSubscriptionPaymentEmailHandler(cfg, EventTypeSubscriptionStarted)
}

// NewSubscriptionRenewedEmailHandler sends the reader the mail of a renewal of
// their subscription that was paid.
func NewSubscriptionRenewedEmailHandler(cfg EmailHandlerConfig) Handler {
	return newSubscriptionPaymentEmailHandler(cfg, EventTypeSubscriptionRenewed)
}

// newSubscriptionPaymentEmailHandler sends the reader the mail of a paid
// invoice of their subscription, under template, the event type it handles,
// from the tenant's SMTP settings and in the tenant's language and time zone,
// whatever their notification settings say: it is about their money.
//
// A subscription whose reader's account is gone has nobody to send it to, and
// the event is dropped rather than retried.
func newSubscriptionPaymentEmailHandler(cfg EmailHandlerConfig, template string) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require(template + " email"); err != nil {
			return err
		}
		tenantID, paymentID, err := subscriptionPaymentEmailIDs(event)
		if err != nil {
			return Permanent(err)
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}
		payment, err := queries.GetSubscriptionPaymentMailForTenant(ctx, dbmodels.GetSubscriptionPaymentMailForTenantParams{
			TenantID: tenantID,
			ID:       paymentID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("subscription payment %s no longer exists", paymentID))
		}
		if err != nil {
			return fmt.Errorf("load the subscription payment a mail is about: %w", err)
		}
		recipient := strings.TrimSpace(payment.ReaderEmail.String)
		if recipient == "" {
			if cfg.Logger != nil {
				cfg.Logger.WarnContext(ctx, "dropped the mail of a subscription payment whose reader no longer has an account",
					"event_id", event.ID,
					"event_type", event.EventType,
					"tenant_id", tenantID,
					"subscription_payment_id", paymentID,
				)
			}
			return nil
		}
		myPageURL, err := tenantSiteURL(delivery.tenant, myPagePath)
		if err != nil {
			return fmt.Errorf("build my page url: %w", err)
		}

		return deliverEmail(ctx, cfg, delivery.settings, recipient, subscriptionPaymentEmailRequest(template, delivery, payment, myPageURL))
	}
}

// subscriptionPaymentEmailIDs takes the tenant from the event row and checks
// the payload agrees, as every tenant-scoped mail does.
func subscriptionPaymentEmailIDs(event dbmodels.OutboxEvent) (uuid.UUID, uuid.UUID, error) {
	var payload SubscriptionPaymentEmailPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("decode %s payload: %w", event.EventType, err)
	}
	tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	paymentID, err := uuid.Parse(payload.SubscriptionPaymentID)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("%s payload has an invalid subscription_payment_id", event.EventType)
	}
	return tenantID, paymentID, nil
}

// subscriptionPaymentEmailRequest fills the mail in. The amount travels in the
// minor unit with its currency, and the bounds of the period paid for as RFC
// 3339, so the HTML part and the plain-text part each write them in the
// tenant's locale and zone. The end of that period is the date My Page says
// the plan renews on.
func subscriptionPaymentEmailRequest(
	template string,
	delivery tenantDelivery,
	payment dbmodels.GetSubscriptionPaymentMailForTenantRow,
	myPageURL string,
) emailrenderer.Request {
	return emailrenderer.Request{
		Template: template,
		Locale:   delivery.locale,
		Data: map[string]any{
			"amount":       int64(payment.Amount),
			"currency":     payment.Currency,
			"is_test":      payment.IsTest,
			"my_page_url":  myPageURL,
			"period_end":   payment.PeriodEnd.UTC().Format(time.RFC3339Nano),
			"period_start": payment.PeriodStart.UTC().Format(time.RFC3339Nano),
			"plan_name":    payment.PlanName,
			"tenant_name":  delivery.tenantName,
		},
		TimeZone: delivery.timeZone,
	}
}
