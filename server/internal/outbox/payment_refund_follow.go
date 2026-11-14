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
// payment paymentID names, after the refund requested under refundKey. Each
// refund is followed once: queuing the same refund again, as a retried
// request does, does nothing, while another refund of the payment is followed
// again.
func QueuePaymentRefundFollow(ctx context.Context, queries dbmodels.Querier, tenantID uuid.UUID, providerID, paymentID, refundKey string) error {
	return insertTenantEvent(ctx, queries, tenantID, EventTypePaymentRefundFollow, PaymentRefundFollowPayload{
		TenantID:  tenantID.String(),
		Provider:  providerID,
		PaymentID: paymentID,
	}, EventTypePaymentRefundFollow+":"+tenantID.String()+":"+providerID+":"+paymentID+":"+refundKey)
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
