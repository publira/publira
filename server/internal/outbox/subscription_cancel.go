package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentsettings"
)

// EventTypeSubscriptionCancel cancels, through the tenant's payment provider,
// a subscription whose reader no longer has an account. It is queued in the
// transaction that deletes the account, and by the webhook that records a
// subscription for a reader already gone: without an account the reader can
// reach no billing page to cancel it, and the provider would bill them for
// every period to come.
const EventTypeSubscriptionCancel = "subscription_cancel"

// SubscriptionCancelPayload names the subscription by the provider's id, which
// is all the provider needs and stays true after the account is gone.
type SubscriptionCancelPayload struct {
	TenantID       string `json:"tenant_id"`
	SubscriptionID string `json:"subscription_id"`
}

// SubscriptionCancelHandlerConfig is what the worker resolves once at startup.
// The tenant's credentials are read per event.
type SubscriptionCancelHandlerConfig struct {
	DB        *sql.DB
	Encryptor paymentsettings.SecretManager
	Providers *paymentprovider.Registry
	Logger    *slog.Logger
}

// QueueSubscriptionCancellation queues the cancellation of the subscription
// the provider knows as subscriptionID. Queuing it again while it is queued, or
// after it was sent, does nothing.
func QueueSubscriptionCancellation(ctx context.Context, queries dbmodels.Querier, tenantID uuid.UUID, subscriptionID string) error {
	return insertTenantEvent(ctx, queries, tenantID, EventTypeSubscriptionCancel, SubscriptionCancelPayload{
		TenantID:       tenantID.String(),
		SubscriptionID: subscriptionID,
	}, EventTypeSubscriptionCancel+":"+tenantID.String()+":"+subscriptionID)
}

// QueueSubscriptionCancellationsForUser queues the cancellation of every
// subscription the provider goes on billing an account for. Call it in the
// transaction that deletes the account, before the delete: the delete leaves
// the subscriptions naming no one. It holds the reader's subscriptions lock
// until that transaction ends, so a webhook recording one of them either
// commits before the read here or waits and finds the account gone.
func QueueSubscriptionCancellationsForUser(ctx context.Context, queries dbmodels.Querier, tenantID, userID uuid.UUID) error {
	if err := queries.LockSubscriptionsOfUser(ctx, dbmodels.LockSubscriptionsOfUserParams{TenantID: tenantID, UserID: userID}); err != nil {
		return fmt.Errorf("lock the subscriptions of the account: %w", err)
	}
	subscriptionIDs, err := queries.ListBilledStripeSubscriptionIDsForUser(ctx, dbmodels.ListBilledStripeSubscriptionIDsForUserParams{
		TenantID: tenantID,
		UserID:   uuid.NullUUID{UUID: userID, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("list the subscriptions of the account: %w", err)
	}
	for _, subscriptionID := range subscriptionIDs {
		if err := QueueSubscriptionCancellation(ctx, queries, tenantID, subscriptionID); err != nil {
			return err
		}
	}
	return nil
}

// NewSubscriptionCancelHandler cancels the subscription an event names. It
// reads the subscription first, so a delivery that repeats one already sent,
// or follows a cancellation the reader or the tenant made meanwhile, asks the
// provider for nothing more.
func NewSubscriptionCancelHandler(cfg SubscriptionCancelHandlerConfig) Handler {
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		if cfg.DB == nil || cfg.Providers == nil {
			return errors.New("subscription cancel handler is not configured")
		}
		var payload SubscriptionCancelPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode subscription cancel payload: %w", err))
		}
		tenantID, err := eventTenant(event, payload.TenantID)
		if err != nil {
			return err
		}
		subscriptionID := strings.TrimSpace(payload.SubscriptionID)
		if subscriptionID == "" {
			return Permanent(errors.New("subscription cancel payload names no subscription"))
		}

		// A tenant that switched its payments off, or broke or replaced its
		// key, is retried rather than dropped: the subscription bills the
		// reader all the same, and restored credentials can still end it.
		config, credentials, err := paymentsettings.New(dbmodels.New(cfg.DB), cfg.Encryptor, cfg.Providers, nil, cfg.Logger).LoadEnabledSecrets(ctx, tenantID)
		if err != nil {
			return fmt.Errorf("load the payment settings: %w", err)
		}
		provider, ok := cfg.Providers.Lookup(config.Provider)
		if !ok {
			return fmt.Errorf("the tenant's payment provider %q is not registered", config.Provider)
		}
		subscriptions, ok := provider.(paymentprovider.Subscriptions)
		if !ok {
			return fmt.Errorf("the tenant's payment provider %q sells no subscriptions", config.Provider)
		}

		subscription, err := subscriptions.RetrieveSubscription(ctx, credentials, subscriptionID)
		if errors.Is(err, paymentprovider.ErrSubscriptionNotFound) {
			// Nothing the account holds bills anyone under this id.
			return nil
		}
		if err != nil {
			return fmt.Errorf("read the subscription: %w", err)
		}
		if !subscription.Status.Billed() {
			return nil
		}
		err = subscriptions.CancelSubscription(ctx, credentials, subscriptionID)
		if errors.Is(err, paymentprovider.ErrSubscriptionNotFound) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("cancel the subscription: %w", err)
		}
		if cfg.Logger != nil {
			cfg.Logger.InfoContext(ctx, "canceled the subscription of a deleted account",
				"tenant_id", tenantID,
				"subscription_id", subscriptionID,
				"outbox_event_id", event.ID,
			)
		}
		return nil
	}
}
