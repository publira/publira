package publicapi

import (
	"context"
	"database/sql"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
)

// staffRefundState reads the purchase's refund in part: the amount waiting,
// the attempt it waits under, and the amount recorded as refunded.
func (e refundWebhookEnv) staffRefundState(t *testing.T, purchaseID uuid.UUID) (sql.NullInt32, int32, sql.NullInt32) {
	t.Helper()
	var (
		requested sql.NullInt32
		attempt   int32
		refunded  sql.NullInt32
	)
	if err := e.pg.DB.QueryRowContext(context.Background(), `
		SELECT staff_refund_requested_amount, staff_refund_attempt, refunded_amount
		FROM purchases
		WHERE tenant_id = $1 AND id = $2
	`, e.tenant.ID, purchaseID).Scan(&requested, &attempt, &refunded); err != nil {
		t.Fatalf("read the refund in part: %v", err)
	}
	return requested, attempt, refunded
}

// A refund notification ends the wait of a refund in part staff asked for only
// once Stripe has made the refund under the key of the attempt waiting: a
// total that reaches it through a refund made in Stripe's dashboard leaves it
// waiting, and a repeated notification moves nothing further on.
func TestDBProcessPaymentWebhookSettlesARefundInPartStripeMadeUnderItsKey(t *testing.T) {
	t.Parallel()

	api := stripetest.NewAPI(t)
	env := newUnpaidRefundWebhookEnvAnsweredBy(t, "REFUNDPART", "refund-part.example.com", api)
	env.deliverCheckout(t, "pi_refund_part")
	api.SetPaymentIntent(testCheckoutSecretKey, "pi_refund_part", 500, "JPY")
	var purchaseID uuid.UUID
	if err := env.pg.DB.QueryRowContext(context.Background(), `SELECT id FROM purchases WHERE tenant_id = $1`, env.tenant.ID).Scan(&purchaseID); err != nil {
		t.Fatalf("read the purchase: %v", err)
	}
	attempt, err := env.queries.RequestStaffRefundInPart(context.Background(), dbmodels.RequestStaffRefundInPartParams{
		TenantID: env.tenant.ID,
		ID:       purchaseID,
		Amount:   200,
	})
	if err != nil {
		t.Fatalf("mark the refund in part: %v", err)
	}

	api.SetRefunded(testCheckoutSecretKey, "pi_refund_part", 200)
	env.deliver(t, "charge.refunded", refundedCharge("pi_refund_part", 500, 200))
	if requested, got, refunded := env.staffRefundState(t, purchaseID); requested.Int32 != 200 || got != attempt || refunded.Int32 != 200 {
		t.Fatalf("after the dashboard refund: requested %v under attempt %d with %v refunded, want 200 under %d with 200", requested, got, refunded, attempt)
	}

	credentials := paymentprovider.Credentials{stripe.FieldSecretKey: testCheckoutSecretKey}
	if _, err := stripe.New(stripe.WithAPIURL(api.URL())).Refund(context.Background(), credentials, paymentprovider.RefundRequest{
		PaymentID:      "pi_refund_part",
		IdempotencyKey: paymentprovider.StaffRefundKey(purchaseID, attempt),
		Amount:         200,
	}); err != nil {
		t.Fatalf("Refund: %v", err)
	}
	for range 2 {
		env.deliver(t, "charge.refunded", refundedCharge("pi_refund_part", 500, 400))
		if requested, got, refunded := env.staffRefundState(t, purchaseID); requested.Valid || got != attempt+1 || refunded.Int32 != 400 {
			t.Fatalf("after the refund in part: requested %v under attempt %d with %v refunded, want nothing under %d with 400", requested, got, refunded, attempt+1)
		}
	}
}
