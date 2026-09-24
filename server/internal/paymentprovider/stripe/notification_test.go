package stripe_test

import (
	"maps"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
)

const testWebhookSecret = "whsec_NotificationTestAAAA"

func checkoutSession(purchase paymentprovider.Purchase, fields map[string]any) map[string]any {
	session := map[string]any{
		"id":             "cs_notification",
		"object":         "checkout.session",
		"amount_total":   purchase.Price,
		"currency":       "jpy",
		"payment_status": "paid",
		"payment_intent": "pi_notification",
		"metadata":       stripetest.PurchaseMetadata(purchase),
	}
	maps.Copy(session, fields)
	return session
}

func parse(t *testing.T, eventType string, session map[string]any) (paymentprovider.Event, error) {
	t.Helper()
	payload, headers := stripetest.SignedEvent(t, testWebhookSecret, eventType, session)
	return stripe.New().ParseNotification(payload, headers, paymentprovider.Credentials{
		stripe.FieldWebhookSecret: testWebhookSecret,
	})
}

func TestParseNotification(t *testing.T) {
	purchase := paymentprovider.Purchase{
		TenantID:  uuid.New(),
		ReaderID:  uuid.New(),
		EpisodeID: uuid.New(),
		Price:     500,
	}

	t.Run("an unpaid completed session is ignored", func(t *testing.T) {
		event, err := parse(t, "checkout.session.completed", checkoutSession(purchase, map[string]any{"payment_status": "unpaid"}))
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if _, ok := event.(paymentprovider.Ignored); !ok {
			t.Fatalf("event = %T, want Ignored", event)
		}
	})

	t.Run("a succeeded delayed payment completes the purchase", func(t *testing.T) {
		event, err := parse(t, "checkout.session.async_payment_succeeded", checkoutSession(purchase, nil))
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		completed, ok := event.(paymentprovider.PurchaseCompleted)
		if !ok {
			t.Fatalf("event = %T, want PurchaseCompleted", event)
		}
		if completed.CheckoutID != "cs_notification" || completed.PaymentID != "pi_notification" || completed.Purchase != purchase {
			t.Fatalf("event = %+v", completed)
		}
	})

	t.Run("a failed delayed payment is ignored", func(t *testing.T) {
		event, err := parse(t, "checkout.session.async_payment_failed", checkoutSession(purchase, map[string]any{"payment_status": "unpaid"}))
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if _, ok := event.(paymentprovider.Ignored); !ok {
			t.Fatalf("event = %T, want Ignored", event)
		}
	})

	t.Run("a session paid in another currency fails", func(t *testing.T) {
		if _, err := parse(t, "checkout.session.completed", checkoutSession(purchase, map[string]any{"currency": "usd"})); err == nil {
			t.Fatal("ParseNotification error = nil, want an error")
		}
	})

	t.Run("a session whose amount disagrees with its price fails", func(t *testing.T) {
		if _, err := parse(t, "checkout.session.completed", checkoutSession(purchase, map[string]any{"amount_total": 400})); err == nil {
			t.Fatal("ParseNotification error = nil, want an error")
		}
	})
}
