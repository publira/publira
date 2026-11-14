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

// EventTypePaymentRefundFollow reads back what became of a refund the server
// asked a payment provider for, when the provider is a
// paymentprovider.RefundFollower and so sends no notification of it. The
// handler is publicapi's, which records what the provider reports as the
// provider's notification would have.
const EventTypePaymentRefundFollow = "payment_refund_follow"

// PaymentRefundFollowPayload names the payment whose refunds are read back.
type PaymentRefundFollowPayload struct {
	TenantID  string `json:"tenant_id"`
	Provider  string `json:"provider"`
	PaymentID string `json:"payment_id"`
}

// QueuePaymentRefundFollow queues the reading back of the refunds of the
// payment paymentID names, after a request for a refund of it. Every request
// queues a follow-up of its own, a retry of the same refund included: one
// that read the payment before the refund was made, as a request that failed
// before reaching the provider leaves it, has finished, and only the retry's
// follow-up reads what the retry made.
func QueuePaymentRefundFollow(ctx context.Context, queries dbmodels.Querier, tenantID uuid.UUID, providerID, paymentID string) error {
	requestID, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate the follow-up id: %w", err)
	}
	return insertTenantEvent(ctx, queries, tenantID, EventTypePaymentRefundFollow, PaymentRefundFollowPayload{
		TenantID:  tenantID.String(),
		Provider:  providerID,
		PaymentID: paymentID,
	}, EventTypePaymentRefundFollow+":"+tenantID.String()+":"+requestID.String())
}

// DecodePaymentRefundFollow reads the payload of event, answering a
// [Permanent] error for one that cannot be read or that names another tenant
// than its event.
func DecodePaymentRefundFollow(event dbmodels.OutboxEvent) (uuid.UUID, PaymentRefundFollowPayload, error) {
	var payload PaymentRefundFollowPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return uuid.Nil, PaymentRefundFollowPayload{}, Permanent(fmt.Errorf("decode payment refund follow payload: %w", err))
	}
	if strings.TrimSpace(payload.Provider) == "" || strings.TrimSpace(payload.PaymentID) == "" {
		return uuid.Nil, PaymentRefundFollowPayload{}, Permanent(errors.New("payment refund follow payload names no provider or payment"))
	}
	tenantID, err := eventTenant(event, payload.TenantID)
	if err != nil {
		return uuid.Nil, PaymentRefundFollowPayload{}, err
	}
	return tenantID, payload, nil
}
