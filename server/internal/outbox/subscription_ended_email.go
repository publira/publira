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

// EventTypeSubscriptionEnded tells the reader that their subscription is over,
// when it ended and with it the plan's episodes, and links the site's plans,
// where they may subscribe again. It is the same mail whoever ended the
// subscription: the reader, the provider giving up on a renewal, or the
// tenant.
//
// It is queued in the transaction that records the subscription as ended,
// once, and only for one the provider was billing until then, which one whose
// first payment never went through was not. A subscription sold through the
// App Store or Google Play queues none.
const EventTypeSubscriptionEnded = "subscription_ended"

// SubscriptionEndedPayload carries what a mail of [EventTypeSubscriptionEnded]
// says about the end. The worker reloads the plan's name and the reader's
// address.
type SubscriptionEndedPayload struct {
	TenantID       string `json:"tenant_id"`
	SubscriptionID string `json:"subscription_id"`
	// PlanID is the plan the subscription was recorded on when it ended.
	PlanID string `json:"plan_id"`
	// EndedAt is when the provider ended the subscription.
	EndedAt time.Time `json:"ended_at"`
}

// SubscriptionEndedIdempotencyKey is the outbox key for the mail of one
// subscription's end. It names the subscription and the instant it ended, so
// however often the provider redelivers the notification of the end, one end
// is one mail.
func SubscriptionEndedIdempotencyKey(subscriptionID uuid.UUID, endedAt time.Time) string {
	return EventTypeSubscriptionEnded + ":" + subscriptionID.String() + ":" + endedAt.UTC().Format(time.RFC3339Nano)
}

// plansPath is the storefront page that lists the tenant's subscription plans.
const plansPath = "/plans"

// NewSubscriptionEndedEmailHandler sends the reader the mail of their
// subscription's end, from the tenant's SMTP settings and in the tenant's
// language and time zone, whatever their notification settings say: it is
// about what their money bought.
//
// A subscription whose reader's account is gone has nobody to send it to, and
// the event is dropped rather than retried.
func NewSubscriptionEndedEmailHandler(cfg EmailHandlerConfig) Handler {
	queries := dbmodels.New(cfg.DB)
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if err := cfg.require(EventTypeSubscriptionEnded + " email"); err != nil {
			return err
		}
		payload, tenantID, subscriptionID, planID, err := subscriptionEndedEmailPayload(event)
		if err != nil {
			return Permanent(err)
		}

		delivery, err := resolveTenantDelivery(ctx, queries, tenantID, cfg.Encryptor)
		if err != nil {
			return err
		}
		mail, err := queries.GetSubscriptionMailForTenant(ctx, dbmodels.GetSubscriptionMailForTenantParams{
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
				cfg.Logger.WarnContext(ctx, "dropped the mail of an ended subscription whose reader no longer has an account",
					"event_id", event.ID,
					"tenant_id", tenantID,
					"subscription_id", subscriptionID,
				)
			}
			return nil
		}
		plansURL, err := tenantSiteURL(delivery.tenant, plansPath)
		if err != nil {
			return fmt.Errorf("build plans url: %w", err)
		}

		return deliverEmail(ctx, cfg, delivery.settings, recipient, subscriptionEndedEmailRequest(delivery, payload, mail.PlanName, plansURL))
	}
}

// subscriptionEndedEmailPayload takes the tenant from the event row and checks
// the payload agrees, as every tenant-scoped mail does.
func subscriptionEndedEmailPayload(event dbmodels.OutboxEvent) (SubscriptionEndedPayload, uuid.UUID, uuid.UUID, uuid.UUID, error) {
	var payload SubscriptionEndedPayload
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
	if payload.EndedAt.IsZero() {
		return payload, uuid.Nil, uuid.Nil, uuid.Nil, fmt.Errorf("%s payload names no end", event.EventType)
	}
	return payload, tenantID, subscriptionID, planID, nil
}

// subscriptionEndedEmailRequest fills the mail in. The end travels as RFC 3339,
// so the HTML part and the plain-text part each write it in the tenant's
// locale and zone.
func subscriptionEndedEmailRequest(
	delivery tenantDelivery,
	payload SubscriptionEndedPayload,
	planName string,
	plansURL string,
) emailrenderer.Request {
	return emailrenderer.Request{
		Template: EventTypeSubscriptionEnded,
		Locale:   delivery.locale,
		Data: map[string]any{
			"ended_at":    payload.EndedAt.UTC().Format(time.RFC3339Nano),
			"plan_name":   planName,
			"plans_url":   plansURL,
			"tenant_name": delivery.tenantName,
		},
		TimeZone: delivery.timeZone,
	}
}
