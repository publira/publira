package stripe_test

import (
	"context"
	"errors"
	"maps"
	"testing"

	"github.com/google/uuid"
	stripego "github.com/stripe/stripe-go/v87"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paymentprovidertest"
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
	return stripe.New().ParseNotification(context.Background(), payload, headers, paymentprovider.Credentials{
		stripe.FieldWebhookSecret: testWebhookSecret,
	})
}

func TestParseNotification(t *testing.T) {
	purchase := paymentprovider.Purchase{
		TenantID:  uuid.New(),
		ReaderID:  uuid.New(),
		EpisodeID: uuid.New(),
		Kind:      paymentprovider.KindPurchase,
		Price:     500,
		Currency:  "JPY",
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

	t.Run("a session names the currency it was paid in", func(t *testing.T) {
		event, err := parse(t, "checkout.session.completed", checkoutSession(purchase, map[string]any{"currency": "usd"}))
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		completed, ok := event.(paymentprovider.PurchaseCompleted)
		if !ok {
			t.Fatalf("event = %T, want PurchaseCompleted", event)
		}
		if completed.Purchase.Currency != "USD" {
			t.Fatalf("currency = %q, want USD", completed.Purchase.Currency)
		}
	})

	t.Run("a session whose amount disagrees with its price fails", func(t *testing.T) {
		if _, err := parse(t, "checkout.session.completed", checkoutSession(purchase, map[string]any{"amount_total": 400})); err == nil {
			t.Fatal("ParseNotification error = nil, want an error")
		}
	})
}

func TestParseNotificationReadsDisputesAndExpiredCheckouts(t *testing.T) {
	fixture := stripetest.NewFixture(t)
	credentials := fixture.Credentials()
	checkout := paymentprovidertest.Checkout{
		CheckoutID: "cs_expired",
		Purchase: paymentprovider.Purchase{
			TenantID:           uuid.New(),
			ReaderID:           uuid.New(),
			EpisodeID:          uuid.New(),
			Kind:               paymentprovider.KindPurchase,
			Price:              500,
			Currency:           "JPY",
			ReadingPeriodHours: 72,
		},
	}

	t.Run("a dispute names the payment it disputes", func(t *testing.T) {
		payload, headers := fixture.Disputed(t, credentials, "pi_disputed")
		event, err := fixture.Provider().ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		disputed, ok := event.(paymentprovider.Disputed)
		if !ok {
			t.Fatalf("event = %T, want Disputed", event)
		}
		if disputed.PaymentID != "pi_disputed" {
			t.Fatalf("payment id = %q, want pi_disputed", disputed.PaymentID)
		}
	})

	t.Run("a dispute naming no payment intent is malformed", func(t *testing.T) {
		payload, headers := fixture.Disputed(t, credentials, "")
		_, err := fixture.Provider().ParseNotification(t.Context(), payload, headers, credentials)
		if !errors.Is(err, paymentprovider.ErrMalformedNotification) {
			t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
		}
	})

	t.Run("a lost dispute names the payment it returned to the reader", func(t *testing.T) {
		payload, headers := fixture.DisputeClosed(t, credentials, "pi_disputed", stripego.DisputeStatusLost)
		event, err := fixture.Provider().ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		lost, ok := event.(paymentprovider.DisputeLost)
		if !ok {
			t.Fatalf("event = %T, want DisputeLost", event)
		}
		if lost.PaymentID != "pi_disputed" {
			t.Fatalf("payment id = %q, want pi_disputed", lost.PaymentID)
		}
	})

	for _, status := range []stripego.DisputeStatus{stripego.DisputeStatusWon, stripego.DisputeStatusWarningClosed} {
		t.Run("a dispute closed as "+string(status)+" is ignored", func(t *testing.T) {
			payload, headers := fixture.DisputeClosed(t, credentials, "pi_disputed", status)
			event, err := fixture.Provider().ParseNotification(t.Context(), payload, headers, credentials)
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			if _, ok := event.(paymentprovider.Ignored); !ok {
				t.Fatalf("event = %T, want Ignored", event)
			}
		})
	}

	t.Run("a closed dispute naming no payment intent is malformed", func(t *testing.T) {
		payload, headers := fixture.DisputeClosed(t, credentials, "", stripego.DisputeStatusLost)
		_, err := fixture.Provider().ParseNotification(t.Context(), payload, headers, credentials)
		if !errors.Is(err, paymentprovider.ErrMalformedNotification) {
			t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
		}
	})

	t.Run("an expired session names the purchase it would have been", func(t *testing.T) {
		payload, headers := fixture.CheckoutExpired(t, credentials, checkout)
		event, err := fixture.Provider().ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		expired, ok := event.(paymentprovider.CheckoutExpired)
		if !ok {
			t.Fatalf("event = %T, want CheckoutExpired", event)
		}
		if expired.CheckoutID != checkout.CheckoutID || expired.Purchase != checkout.Purchase {
			t.Fatalf("event = %+v, want checkout %q of %+v", expired, checkout.CheckoutID, checkout.Purchase)
		}
	})

	t.Run("an expired session this integration did not start is ignored", func(t *testing.T) {
		payload, headers := stripetest.SignedEvent(t, credentials[stripe.FieldWebhookSecret], "checkout.session.expired", map[string]any{
			"id":       "cs_someone_else",
			"object":   "checkout.session",
			"currency": "jpy",
			"metadata": map[string]string{},
		})
		event, err := fixture.Provider().ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if _, ok := event.(paymentprovider.Ignored); !ok {
			t.Fatalf("event = %T, want Ignored", event)
		}
	})
}

// Stripe reports a canceled refund only as refund.updated, which it also sends
// for every other change of a refund.
func TestParseNotificationReadsACanceledRefundFromItsUpdate(t *testing.T) {
	fixture := stripetest.NewFixture(t)
	credentials := fixture.Credentials()
	fixture.API.SetPaymentIntent(credentials[stripe.FieldSecretKey], "pi_canceled_refund", 500, "JPY")
	updated := func(status string) paymentprovider.Event {
		t.Helper()
		payload, headers := stripetest.SignedEvent(t, credentials[stripe.FieldWebhookSecret], "refund.updated", map[string]any{
			"id":             "re_canceled",
			"object":         "refund",
			"amount":         500,
			"currency":       "jpy",
			"payment_intent": "pi_canceled_refund",
			"status":         status,
		})
		event, err := fixture.Provider().ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification of a %s refund: %v", status, err)
		}
		return event
	}

	failed, ok := updated("canceled").(paymentprovider.RefundFailed)
	if !ok {
		t.Fatal("a canceled refund is not a RefundFailed")
	}
	if failed.PaymentID != "pi_canceled_refund" || failed.AmountRefunded != 0 || failed.Currency != "JPY" {
		t.Fatalf("failed refund = %+v, want nothing staying refunded on pi_canceled_refund in JPY", failed)
	}
	for _, status := range []string{"pending", "requires_action", "succeeded"} {
		if event := updated(status); !isIgnored(event) {
			t.Fatalf("a %s refund's update = %T, want Ignored", status, event)
		}
	}
}

func isIgnored(event paymentprovider.Event) bool {
	_, ok := event.(paymentprovider.Ignored)
	return ok
}
