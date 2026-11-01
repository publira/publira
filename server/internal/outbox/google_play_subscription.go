package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/paymentsettings"
)

// EventTypeGooglePlaySubscriptionAcknowledge acknowledges a Google Play
// subscription the server has recorded. It is queued in the transaction that
// records the subscription, because Google Play refunds and ends a
// subscription nobody acknowledged within three days of its purchase.
const EventTypeGooglePlaySubscriptionAcknowledge = "google_play_subscription_acknowledge"

// GooglePlaySubscriptionAcknowledgePayload names the subscription by what the
// Developer API acknowledges it by.
type GooglePlaySubscriptionAcknowledgePayload struct {
	TenantID       string `json:"tenant_id"`
	SubscriptionID string `json:"subscription_id"`
	ProductID      string `json:"product_id"`
	PurchaseToken  string `json:"purchase_token"`
}

// QueueGooglePlaySubscriptionAcknowledgement queues the acknowledgement of the
// subscription token bought as productID, recorded as subscriptionID. Queuing
// it again while it is queued, or after it was sent, does nothing. The event is
// keyed by the token as well as the row: a change of plan moves the row to a
// purchase of its own, which needs an acknowledgement of its own.
func QueueGooglePlaySubscriptionAcknowledgement(ctx context.Context, queries dbmodels.Querier, tenantID, subscriptionID uuid.UUID, productID, token string) error {
	return insertTenantEvent(ctx, queries, tenantID, EventTypeGooglePlaySubscriptionAcknowledge, GooglePlaySubscriptionAcknowledgePayload{
		TenantID:       tenantID.String(),
		SubscriptionID: subscriptionID.String(),
		ProductID:      productID,
		PurchaseToken:  token,
	}, EventTypeGooglePlaySubscriptionAcknowledge+":"+tenantID.String()+":"+subscriptionID.String()+":"+token)
}

// NewGooglePlaySubscriptionAcknowledgeHandler acknowledges the subscription an
// event names, unless the app or an earlier delivery already has.
func NewGooglePlaySubscriptionAcknowledgeHandler(cfg GooglePlayHandlerConfig) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil || cfg.Purchases == nil {
			return errors.New("google play subscription handler is not configured")
		}
		var payload GooglePlaySubscriptionAcknowledgePayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode google play subscription payload: %w", err))
		}
		tenantID, err := eventTenant(event, payload.TenantID)
		if err != nil {
			return err
		}
		productID := strings.TrimSpace(payload.ProductID)
		token := strings.TrimSpace(payload.PurchaseToken)
		if productID == "" || token == "" {
			return Permanent(errors.New("google play subscription payload names no subscription"))
		}

		// A tenant that switched Google Play off or broke its key is retried
		// rather than dropped, as a consume is: the reader paid, and the
		// subscription is refunded unless someone restores the credentials
		// before the three days are out.
		credentials, err := paymentsettings.NewAppStores(dbmodels.New(cfg.DB), cfg.Encryptor).LoadGooglePlayCredentials(ctx, tenantID)
		if err != nil {
			return fmt.Errorf("load google play credentials: %w", err)
		}
		key := []byte(credentials.ServiceAccountKey)

		subscription, err := cfg.Purchases.GetSubscriptionPurchase(ctx, key, credentials.PackageName, token)
		if errors.Is(err, googleplay.ErrPurchaseNotFound) {
			return Permanent(err)
		}
		if err != nil {
			return fmt.Errorf("get google play subscription: %w", err)
		}
		if subscription.AcknowledgementState == googleplay.AcknowledgementStateAcknowledged {
			return nil
		}
		err = cfg.Purchases.AcknowledgeSubscriptionPurchase(ctx, key, credentials.PackageName, productID, token)
		if errors.Is(err, googleplay.ErrPurchaseNotFound) {
			return Permanent(err)
		}
		if err != nil {
			return fmt.Errorf("acknowledge google play subscription: %w", err)
		}
		if cfg.Logger != nil {
			cfg.Logger.InfoContext(ctx, "acknowledged a google play subscription",
				"tenant_id", tenantID,
				"subscription_id", payload.SubscriptionID,
				"outbox_event_id", event.ID,
			)
		}
		return nil
	}
}
