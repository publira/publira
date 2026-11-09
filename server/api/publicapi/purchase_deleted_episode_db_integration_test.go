package publicapi

import (
	"context"
	"testing"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
)

// deleteEpisode removes the env's episode the way a deletion leaves it: gone,
// with nothing that names it.
func (e refundWebhookEnv) deleteEpisode(t *testing.T) {
	t.Helper()
	if _, err := e.pg.DB.ExecContext(context.Background(), `
		DELETE FROM episodes
		WHERE tenant_id = $1
			AND id = $2
	`, e.tenant.ID, e.episode.ID); err != nil {
		t.Fatalf("delete episode: %v", err)
	}
}

// deliverCheckoutOf delivers the completed checkout id, paid through
// paymentIntentID, of purchase.
func (e refundWebhookEnv) deliverCheckoutOf(t *testing.T, id, paymentIntentID string, purchase paymentprovider.Purchase) {
	t.Helper()
	purchase.TenantID = e.tenant.ID
	purchase.ReaderID = e.user.ID
	purchase.EpisodeID = e.episode.ID
	e.deliver(t, "checkout.session.completed", map[string]any{
		"id":             id,
		"object":         "checkout.session",
		"amount_total":   purchase.Price,
		"currency":       "jpy",
		"payment_status": "paid",
		"payment_intent": paymentIntentID,
		"metadata":       stripetest.PurchaseMetadata(purchase),
	})
}

func (e refundWebhookEnv) purchaseCount(t *testing.T) int {
	t.Helper()
	var count int
	if err := e.pg.DB.QueryRowContext(context.Background(), `
		SELECT count(*)
		FROM purchases
		WHERE tenant_id = $1
	`, e.tenant.ID).Scan(&count); err != nil {
		t.Fatalf("count purchases: %v", err)
	}
	return count
}

func TestDBProcessPaymentWebhookRefundsACheckoutOfADeletedEpisode(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name     string
		slug     string
		purchase paymentprovider.Purchase
	}{
		{name: "purchase", slug: "DELEPBUY", purchase: paymentprovider.Purchase{Price: 500}},
		{name: "rental", slug: "DELEPRENT", purchase: paymentprovider.Purchase{Price: 200, Kind: paymentprovider.KindRental, ReadingPeriodHours: 48}},
		{name: "tip", slug: "DELEPTIP", purchase: paymentprovider.Purchase{Price: 300, Kind: paymentprovider.KindTip}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			api := stripetest.NewAPI(t)
			env := newUnpaidRefundWebhookEnvAnsweredBy(t, tc.slug, "deleted-episode-"+tc.name+".example.com", api)
			paymentIntentID := "pi_deleted_" + tc.name
			checkoutID := "cs_deleted_" + tc.name
			api.SetPaymentIntent(testCheckoutSecretKey, paymentIntentID, int64(tc.purchase.Price), "JPY")
			env.deleteEpisode(t)

			// The redelivery is what a provider sends until it is answered,
			// and the refund it asks for again is the same one.
			for range 2 {
				env.deliverCheckoutOf(t, checkoutID, paymentIntentID, tc.purchase)
			}

			refunds := api.Refunds()
			if len(refunds) != 1 {
				t.Fatalf("refunds = %+v, want one", refunds)
			}
			want := paymentprovider.UnrecordedCheckoutRefundKey(checkoutID)
			if got := refunds[0]; got.PaymentIntentID != paymentIntentID || got.IdempotencyKey != want || got.Status != "succeeded" {
				t.Fatalf("refund = %+v, want a refund of %s under %q", got, paymentIntentID, want)
			}
			if got, want := api.RefundedTotal(testCheckoutSecretKey, paymentIntentID), int64(tc.purchase.Price); got != want {
				t.Fatalf("refunded = %d, want the %d paid", got, want)
			}
			if got := env.purchaseCount(t); got != 0 {
				t.Fatalf("purchases = %d, want none", got)
			}
		})
	}
}

func TestDBProcessPaymentWebhookAcknowledgesARefusedRefundOfADeletedEpisode(t *testing.T) {
	t.Parallel()

	api := stripetest.NewAPI(t)
	env := newUnpaidRefundWebhookEnvAnsweredBy(t, "DELEPREF", "deleted-episode-refused.example.com", api)
	api.SetPaymentIntent(testCheckoutSecretKey, "pi_deleted_refused", 500, "JPY")
	api.FailNextRefund(testCheckoutSecretKey, "pi_deleted_refused")
	env.deleteEpisode(t)

	// A redelivery would be refused the same way, so the notification is
	// answered rather than left for the provider to retry until it gives up.
	env.deliverCheckoutOf(t, "cs_deleted_refused", "pi_deleted_refused", paymentprovider.Purchase{Price: 500})

	if got := api.RefundedTotal(testCheckoutSecretKey, "pi_deleted_refused"); got != 0 {
		t.Fatalf("refunded = %d, want nothing", got)
	}
	if got := env.purchaseCount(t); got != 0 {
		t.Fatalf("purchases = %d, want none", got)
	}
}

func TestDBProcessPaymentWebhookRecordsNothingForAFreeCheckoutOfADeletedEpisode(t *testing.T) {
	t.Parallel()

	api := stripetest.NewAPI(t)
	env := newUnpaidRefundWebhookEnvAnsweredBy(t, "DELEPFREE", "deleted-episode-free.example.com", api)
	env.deleteEpisode(t)

	// A promotion code that takes off the whole price leaves the checkout
	// with no payment, and so nothing to refund.
	env.deliver(t, "checkout.session.completed", map[string]any{
		"id":              "cs_deleted_free",
		"object":          "checkout.session",
		"amount_subtotal": 500,
		"amount_total":    0,
		"currency":        "jpy",
		"payment_status":  "no_payment_required",
		"discounts":       []map[string]any{{"coupon": "co_free", "promotion_code": "promo_free"}},
		"total_details":   map[string]any{"amount_discount": 500},
		"metadata": stripetest.PurchaseMetadata(paymentprovider.Purchase{
			TenantID:  env.tenant.ID,
			ReaderID:  env.user.ID,
			EpisodeID: env.episode.ID,
			Price:     500,
		}),
	})

	if got := api.Refunds(); len(got) != 0 {
		t.Fatalf("refunds = %+v, want none", got)
	}
	if got := env.purchaseCount(t); got != 0 {
		t.Fatalf("purchases = %d, want none", got)
	}
}
