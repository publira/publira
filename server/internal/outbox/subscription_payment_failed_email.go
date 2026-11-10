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

// EventTypeSubscriptionPaymentFailed tells the reader that an attempt to
// collect an invoice of their subscription did not go through: what it asked
// for, when it is tried again, until when the plan's episodes stay open to
// them at the latest, and that the card is changed from My Page.
//
// It is queued in the transaction that records the subscription as the
// provider holds it after the attempt, once per attempt, and only while that
// subscription still opens the plan's episodes, which one the provider ended
// on its last attempt does not. A subscription sold through the App Store or
// Google Play queues none.
const EventTypeSubscriptionPaymentFailed = "subscription_payment_failed"

// SubscriptionPaymentFailedPayload carries what a mail of
// [EventTypeSubscriptionPaymentFailed] says about the attempt. The invoice is
// recorded nowhere, so the amount, the next attempt, and the end of the period
// travel here as the attempt left them; the worker reloads the plan's name and
// the reader's address.
type SubscriptionPaymentFailedPayload struct {
	TenantID       string `json:"tenant_id"`
	SubscriptionID string `json:"subscription_id"`
	// PlanID is the plan the subscription was recorded on after the attempt.
	PlanID string `json:"plan_id"`
	// Amount is what the invoice asks for, in the minor unit of Currency.
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	// PeriodEnd is the end of the subscription's current period, the latest
	// the plan's episodes stay open until while the payment is retried.
	PeriodEnd time.Time `json:"period_end"`
	// NextAttempt is when the provider tries again, and absent when it makes no
	// further attempt.
	NextAttempt *time.Time `json:"next_attempt,omitempty"`
	IsTest      bool       `json:"is_test"`
}

// SubscriptionPaymentFailedIdempotencyKey is the outbox key for the mail of
// one failed attempt. It names the provider's notification, which is one
// attempt, so however often the provider redelivers it, one attempt is one
// mail, and every later attempt at the same invoice is a mail of its own.
func SubscriptionPaymentFailedIdempotencyKey(tenantID uuid.UUID, notificationID string) string {
	return EventTypeSubscriptionPaymentFailed + ":" + tenantID.String() + ":" + notificationID
}

// NewSubscriptionPaymentFailedEmailHandler sends the reader the mail of a
// failed attempt to collect their subscription's invoice, from the tenant's
// SMTP settings and in the tenant's language and time zone, whatever their
// notification settings say: it is about their money.
//
// A subscription whose reader's account is gone has nobody to send it to, and
// the event is dropped rather than retried.
func NewSubscriptionPaymentFailedEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require(EventTypeSubscriptionPaymentFailed + " email"); err != nil {
			return err
		}
		payload, tenantID, subscriptionID, planID, err := subscriptionPaymentFailedEmailPayload(event)
		if err != nil {
			return Permanent(err)
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}
		mail, err := queries.GetSubscriptionPaymentFailedMailForTenant(ctx, dbmodels.GetSubscriptionPaymentFailedMailForTenantParams{
			TenantID: tenantID,
			ID:       subscriptionID,
			PlanID:   planID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return Permanent(fmt.Errorf("subscription %s or its plan %s no longer exists", subscriptionID, planID))
		}
		if err != nil {
			return fmt.Errorf("load the subscription a mail is about: %w", err)
		}
		recipient := strings.TrimSpace(mail.ReaderEmail.String)
		if recipient == "" {
			if cfg.Logger != nil {
				cfg.Logger.WarnContext(ctx, "dropped the mail of a failed subscription payment whose reader no longer has an account",
					"event_id", event.ID,
					"tenant_id", tenantID,
					"subscription_id", subscriptionID,
				)
			}
			return nil
		}
		myPageURL, err := tenantSiteURL(delivery.tenant, myPagePath)
		if err != nil {
			return fmt.Errorf("build my page url: %w", err)
		}

		return deliverEmail(ctx, cfg, delivery.settings, recipient, subscriptionPaymentFailedEmailRequest(delivery, payload, mail.PlanName, myPageURL))
	}
}

// subscriptionPaymentFailedEmailPayload takes the tenant from the event row
// and checks the payload agrees, as every tenant-scoped mail does.
func subscriptionPaymentFailedEmailPayload(event dbmodels.OutboxEvent) (SubscriptionPaymentFailedPayload, uuid.UUID, uuid.UUID, uuid.UUID, error) {
	var payload SubscriptionPaymentFailedPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return payload, uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("decode %s payload: %w", event.EventType, err)
	}
	tenantID, err := tenantAuthEventTenantID(event, payload.TenantID)
	if err != nil {
		return payload, uuid.Nil, uuid.Nil, uuid.Nil, err
	}
	subscriptionID, err := uuid.Parse(payload.SubscriptionID)
	if err != nil {
		return payload, uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("%s payload has an invalid subscription_id", event.EventType)
	}
	planID, err := uuid.Parse(payload.PlanID)
	if err != nil {
		return payload, uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("%s payload has an invalid plan_id", event.EventType)
	}
	if payload.Amount <= 0 || strings.TrimSpace(payload.Currency) == "" || payload.PeriodEnd.IsZero() {
		return payload, uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("%s payload names no amount, currency, or period end", event.EventType)
	}
	return payload, tenantID, subscriptionID, planID, nil
}

// subscriptionPaymentFailedEmailRequest fills the mail in. The amount travels
// in the minor unit with its currency, and the instants as RFC 3339, so the
// HTML part and the plain-text part each write them in the tenant's locale and
// zone. An attempt the provider follows with no other carries an empty
// next_attempt.
func subscriptionPaymentFailedEmailRequest(
	delivery tenantDelivery,
	payload SubscriptionPaymentFailedPayload,
	planName string,
	myPageURL string,
) emailrenderer.Request {
	data := map[string]any{
		"amount":       payload.Amount,
		"currency":     payload.Currency,
		"is_test":      payload.IsTest,
		"my_page_url":  myPageURL,
		"next_attempt": "",
		"period_end":   payload.PeriodEnd.UTC().Format(time.RFC3339Nano),
		"plan_name":    planName,
		"tenant_name":  delivery.tenantName,
	}
	if payload.NextAttempt != nil && !payload.NextAttempt.IsZero() {
		data["next_attempt"] = payload.NextAttempt.UTC().Format(time.RFC3339Nano)
	}
	return emailrenderer.Request{
		Template: EventTypeSubscriptionPaymentFailed,
		Locale:   delivery.locale,
		Data:     data,
		TimeZone: delivery.timeZone,
	}
}
