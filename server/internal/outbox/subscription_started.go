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

// SubscriptionStartedPayload names the payment that started the subscription.
// The worker reloads it, so the mail states what was recorded rather than what
// the notification claimed.
type SubscriptionStartedPayload struct {
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

// myPagePath is the storefront page that shows the reader's plan, and opens
// the provider's billing page from Manage billing.
const myPagePath = "/my"

// NewSubscriptionStartedEmailHandler sends the reader the mail of their
// subscription's start, from the tenant's SMTP settings and in the tenant's
// language and time zone, whatever their notification settings say: it is
// about their money.
//
// A subscription whose reader's account is gone has nobody to send it to, and
// the event is dropped rather than retried.
func NewSubscriptionStartedEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require("subscription started email"); err != nil {
			return err
		}
		tenantID, paymentID, err := subscriptionStartedEmailIDs(event)
		if err != nil {
			return Permanent(err)
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}
		payment, err := queries.GetSubscriptionStartedMailForTenant(ctx, dbmodels.GetSubscriptionStartedMailForTenantParams{
			TenantID: tenantID,
			ID:       paymentID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("subscription payment %s no longer exists", paymentID))
		}
		if err != nil {
			return fmt.Errorf("load the payment that started a subscription: %w", err)
		}
		recipient := strings.TrimSpace(payment.ReaderEmail.String)
		if recipient == "" {
			if cfg.Logger != nil {
				cfg.Logger.WarnContext(ctx, "dropped the mail of a subscription's start whose reader no longer has an account",
					"event_id", event.ID,
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

		return deliverEmail(ctx, cfg, delivery.settings, recipient, subscriptionStartedEmailRequest(delivery, payment, myPageURL))
	}
}

// subscriptionStartedEmailIDs takes the tenant from the event row and checks
// the payload agrees, as every tenant-scoped mail does.
func subscriptionStartedEmailIDs(event dbmodels.OutboxEvent) (uuid.UUID, uuid.UUID, error) {
	var payload SubscriptionStartedPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("decode subscription started payload: %w", err)
	}
	tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	paymentID, err := uuid.Parse(payload.SubscriptionPaymentID)
	if err != nil {
		return uuid.Nil, uuid.Nil, errors.New("subscription started payload has an invalid subscription_payment_id")
	}
	return tenantID, paymentID, nil
}

// subscriptionStartedEmailRequest fills the mail in. The amount travels in the
// minor unit with its currency, and the bounds of the period paid for as RFC
// 3339, so the HTML part and the plain-text part each write them in the
// tenant's locale and zone. The end of that period is the date My Page says
// the plan renews on.
func subscriptionStartedEmailRequest(
	delivery tenantDelivery,
	payment dbmodels.GetSubscriptionStartedMailForTenantRow,
	myPageURL string,
) emailrenderer.Request {
	return emailrenderer.Request{
		Template: "subscription_started",
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
