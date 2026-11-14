package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// EventTypePaymentCheckoutFollow reads back the payment of a checkout the
// server started through a payment provider that is a
// paymentprovider.CheckoutFollower, which may notify the payment once and
// never again. The handler is publicapi's, which records what the provider
// reports as the provider's notification would have.
const EventTypePaymentCheckoutFollow = "payment_checkout_follow"

// PaymentCheckoutFollowPayload names the checkout whose payment is read back.
type PaymentCheckoutFollowPayload struct {
	TenantID   string `json:"tenant_id"`
	Provider   string `json:"provider"`
	CheckoutID string `json:"checkout_id"`
}

// QueuePaymentCheckoutFollow queues the reading back of the payment of the
// checkout checkoutID, which the server starts through providerID. A retried
// request starts the same checkout and queues nothing more: the one event
// reads the checkout until it is paid or can no longer be, and a retry within
// that time only moves when that is.
func QueuePaymentCheckoutFollow(ctx context.Context, queries dbmodels.Querier, tenantID uuid.UUID, providerID, checkoutID string) error {
	return insertTenantEvent(ctx, queries, tenantID, EventTypePaymentCheckoutFollow, PaymentCheckoutFollowPayload{
		TenantID:   tenantID.String(),
		Provider:   providerID,
		CheckoutID: checkoutID,
	}, PaymentCheckoutFollowKey(tenantID, providerID, checkoutID))
}

// PaymentCheckoutFollowKey answers the idempotency key of the event
// [QueuePaymentCheckoutFollow] queues for the checkout checkoutID.
func PaymentCheckoutFollowKey(tenantID uuid.UUID, providerID, checkoutID string) string {
	return EventTypePaymentCheckoutFollow + ":" + tenantID.String() + ":" + providerID + ":" + checkoutID
}

// DecodePaymentCheckoutFollow reads the payload of event, answering a
// [Permanent] error for one that cannot be read or that names another tenant
// than its event.
func DecodePaymentCheckoutFollow(event dbmodels.OutboxEvent) (uuid.UUID, PaymentCheckoutFollowPayload, error) {
	var payload PaymentCheckoutFollowPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, PaymentCheckoutFollowPayload{}, Permanent(fmt.Errorf("decode payment checkout follow payload: %w", err))
	}
	if strings.TrimSpace(payload.Provider) == "" || strings.TrimSpace(payload.CheckoutID) == "" {
		return uuid.Nil, PaymentCheckoutFollowPayload{}, Permanent(errors.New("payment checkout follow payload names no provider or checkout"))
	}
	tenantID, err := eventTenant(event, payload.TenantID)
	if err != nil {
		return uuid.Nil, PaymentCheckoutFollowPayload{}, err
	}
	return tenantID, payload, nil
}
