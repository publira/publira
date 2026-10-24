package stripe_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
)

func TestDescribePriceAnswersOnlyARecurringPrice(t *testing.T) {
	api := stripetest.NewAPI(t)
	provider := stripe.New(stripe.WithAPIURL(api.URL()))
	secretKey := checkoutCredentials[stripe.FieldSecretKey]
	api.SetPrice(secretKey, stripetest.Price{ID: "price_monthly", Active: true, Amount: 980, Currency: "JPY", Type: "recurring", Interval: "month", IntervalCount: 1})
	api.SetPrice(secretKey, stripetest.Price{ID: "price_archived", Active: false, Amount: 9800, Currency: "JPY", Type: "recurring", Interval: "year", IntervalCount: 1})
	api.SetPrice(secretKey, stripetest.Price{ID: "price_once", Active: true, Amount: 500, Currency: "JPY", Type: "one_time"})

	price, err := provider.DescribePrice(t.Context(), checkoutCredentials, "price_monthly")
	if err != nil {
		t.Fatalf("DescribePrice: %v", err)
	}
	want := paymentprovider.Price{ID: "price_monthly", Active: true, Amount: 980, Currency: "JPY", Interval: paymentprovider.IntervalMonth, IntervalCount: 1}
	if price != want {
		t.Fatalf("price = %+v, want %+v", price, want)
	}

	price, err = provider.DescribePrice(t.Context(), checkoutCredentials, "price_archived")
	if err != nil {
		t.Fatalf("DescribePrice of an archived price: %v", err)
	}
	if price.Active {
		t.Fatalf("price = %+v, want it reported inactive", price)
	}

	for _, id := range []string{"price_once", "price_missing"} {
		if _, err := provider.DescribePrice(t.Context(), checkoutCredentials, id); !errors.Is(err, paymentprovider.ErrPriceNotFound) {
			t.Errorf("DescribePrice(%s) = %v, want ErrPriceNotFound", id, err)
		}
	}
	// Each account holds its own prices.
	other := paymentprovider.Credentials{stripe.FieldSecretKey: "sk_test_other"}
	if _, err := provider.DescribePrice(t.Context(), other, "price_monthly"); !errors.Is(err, paymentprovider.ErrPriceNotFound) {
		t.Errorf("DescribePrice on another account = %v, want ErrPriceNotFound", err)
	}
}

// The session and the subscription it starts both carry the plan, so every
// later notification about the subscription names whose it is.
func TestStartSubscriptionCheckoutCarriesThePlanOnTheSessionAndTheSubscription(t *testing.T) {
	api := stripetest.NewAPI(t)
	provider := stripe.New(stripe.WithAPIURL(api.URL()))
	request := paymentprovider.SubscriptionCheckoutRequest{
		TenantID:       uuid.New(),
		ReaderID:       uuid.New(),
		PlanID:         uuid.New(),
		PriceID:        "price_monthly",
		SuccessURL:     "https://store.example/my?subscription=success",
		CancelURL:      "https://store.example/plans?subscription=cancelled",
		IdempotencyKey: "subscription-checkout:key",
	}
	checkoutURL, err := provider.StartSubscriptionCheckout(t.Context(), checkoutCredentials, request)
	if err != nil {
		t.Fatalf("StartSubscriptionCheckout: %v", err)
	}
	if checkoutURL == "" {
		t.Fatal("StartSubscriptionCheckout answered no URL")
	}
	request.CustomerID = "cus_returning"
	if _, err := provider.StartSubscriptionCheckout(t.Context(), checkoutCredentials, request); err != nil {
		t.Fatalf("StartSubscriptionCheckout for a returning customer: %v", err)
	}

	sessions := api.CheckoutSessions()
	if len(sessions) != 2 {
		t.Fatalf("checkout sessions = %d, want 2", len(sessions))
	}
	form := sessions[0].Form
	if form.Get("mode") != "subscription" || form.Get("line_items[0][price]") != "price_monthly" || form.Get("line_items[0][quantity]") != "1" {
		t.Fatalf("session = %v, want one line of the plan's price in subscription mode", form)
	}
	for _, prefix := range []string{"metadata", "subscription_data[metadata]"} {
		if form.Get(prefix+"["+stripe.MetadataTenantID+"]") != request.TenantID.String() ||
			form.Get(prefix+"["+stripe.MetadataUserID+"]") != request.ReaderID.String() ||
			form.Get(prefix+"["+stripe.MetadataPlanID+"]") != request.PlanID.String() {
			t.Fatalf("session = %v, want the tenant, the reader, and the plan in %s", form, prefix)
		}
	}
	if form.Get("success_url") != "https://store.example/my?session_id=%7BCHECKOUT_SESSION_ID%7D&subscription=success" {
		t.Fatalf("success_url = %q, want the session named in it", form.Get("success_url"))
	}
	if form.Get("allow_promotion_codes") != "true" || form.Has("customer") {
		t.Fatalf("session = %v, want promotion codes allowed and no customer named", form)
	}
	if sessions[0].IdempotencyKey != "subscription-checkout:key" {
		t.Fatalf("idempotency key = %q", sessions[0].IdempotencyKey)
	}
	if got := sessions[1].Form.Get("customer"); got != "cus_returning" {
		t.Fatalf("customer = %q, want the reader's earlier customer", got)
	}
}

func TestStartBillingPortalOpensTheCustomersPortal(t *testing.T) {
	api := stripetest.NewAPI(t)
	provider := stripe.New(stripe.WithAPIURL(api.URL()))
	portalURL, err := provider.StartBillingPortal(t.Context(), checkoutCredentials, paymentprovider.BillingPortalRequest{
		CustomerID: "cus_reader",
		ReturnURL:  "https://store.example/my",
	})
	if err != nil {
		t.Fatalf("StartBillingPortal: %v", err)
	}
	if portalURL == "" {
		t.Fatal("StartBillingPortal answered no URL")
	}
	portals := api.BillingPortalSessions()
	if len(portals) != 1 || portals[0].Form.Get("customer") != "cus_reader" || portals[0].Form.Get("return_url") != "https://store.example/my" {
		t.Fatalf("portal sessions = %+v, want one for the customer returning to /my", portals)
	}
}

func TestParseNotificationReadsTheSubscriptionAsStripeHoldsItNow(t *testing.T) {
	fixture := stripetest.NewFixture(t)
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	tenantID, readerID, planID := uuid.New(), uuid.New(), uuid.New()
	periodEnd := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	subscription := stripetest.Subscription{
		ID:               "sub_parse",
		CustomerID:       "cus_parse",
		PriceID:          "price_monthly",
		Status:           "active",
		CurrentPeriodEnd: periodEnd.Unix(),
		Metadata:         stripetest.SubscriptionMetadata(tenantID, readerID, planID),
	}
	want := func(status paymentprovider.SubscriptionStatus, cancelAtPeriodEnd bool) paymentprovider.Subscription {
		return paymentprovider.Subscription{
			ID:                "sub_parse",
			CustomerID:        "cus_parse",
			TenantID:          tenantID,
			ReaderID:          readerID,
			PlanID:            planID,
			PriceID:           "price_monthly",
			Status:            status,
			CurrentPeriodEnd:  periodEnd,
			CancelAtPeriodEnd: cancelAtPeriodEnd,
		}
	}
	parse := func(t *testing.T, payload []byte, headers map[string][]string) paymentprovider.Subscription {
		t.Helper()
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		changed, ok := event.(paymentprovider.SubscriptionChanged)
		if !ok {
			t.Fatalf("event = %T, want SubscriptionChanged", event)
		}
		if changed.ID == "" {
			t.Fatal("the event names no notification")
		}
		return changed.Subscription
	}

	t.Run("a completed subscription checkout", func(t *testing.T) {
		payload, headers := fixture.SubscriptionCheckoutCompleted(t, credentials, subscription)
		if got := parse(t, payload, headers); got != want(paymentprovider.SubscriptionActive, false) {
			t.Fatalf("subscription = %+v", got)
		}
	})

	t.Run("an update reports the state the API answers, not the event's copy", func(t *testing.T) {
		payload, headers := fixture.SubscriptionUpdated(t, credentials, subscription)
		// The subscription changes again before the notification is read.
		later := subscription
		later.CancelAtPeriodEnd = true
		fixture.API.SetSubscription(credentials[stripe.FieldSecretKey], later)
		if got := parse(t, payload, headers); got != want(paymentprovider.SubscriptionActive, true) {
			t.Fatalf("subscription = %+v, want it set to cancel as the API now holds it", got)
		}
	})

	t.Run("a deletion", func(t *testing.T) {
		payload, headers := fixture.SubscriptionDeleted(t, credentials, subscription)
		if got := parse(t, payload, headers); got != want(paymentprovider.SubscriptionCanceled, false) {
			t.Fatalf("subscription = %+v", got)
		}
	})

	t.Run("a failed renewal", func(t *testing.T) {
		pastDue := subscription
		pastDue.Status = "past_due"
		payload, headers := fixture.InvoicePaymentFailed(t, credentials, pastDue)
		if got := parse(t, payload, headers); got != want(paymentprovider.SubscriptionPastDue, false) {
			t.Fatalf("subscription = %+v", got)
		}
	})
}

// A Stripe account can sell subscriptions this integration did not start; a
// notification about one is acknowledged and changes nothing.
func TestParseNotificationIgnoresSubscriptionsItDidNotStart(t *testing.T) {
	fixture := stripetest.NewFixture(t)
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	foreign := stripetest.Subscription{
		ID:         "sub_foreign",
		CustomerID: "cus_foreign",
		PriceID:    "price_other",
		Status:     "active",
		Metadata:   map[string]string{},
	}
	cases := map[string]func() ([]byte, map[string][]string){
		"checkout": func() ([]byte, map[string][]string) {
			return fixture.SubscriptionCheckoutCompleted(t, credentials, foreign)
		},
		"update": func() ([]byte, map[string][]string) {
			return fixture.SubscriptionUpdated(t, credentials, foreign)
		},
		"deletion": func() ([]byte, map[string][]string) {
			return fixture.SubscriptionDeleted(t, credentials, foreign)
		},
		"failed renewal": func() ([]byte, map[string][]string) {
			return fixture.InvoicePaymentFailed(t, credentials, foreign)
		},
	}
	for name, notification := range cases {
		t.Run(name, func(t *testing.T) {
			payload, headers := notification()
			event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			if _, ok := event.(paymentprovider.Ignored); !ok {
				t.Fatalf("event = %T, want Ignored", event)
			}
		})
	}

	t.Run("an invoice no subscription raised", func(t *testing.T) {
		payload, headers := stripetest.SignedEvent(t, credentials[stripe.FieldWebhookSecret], "invoice.payment_failed", map[string]any{
			"id":     "in_once",
			"object": "invoice",
		})
		event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if _, ok := event.(paymentprovider.Ignored); !ok {
			t.Fatalf("event = %T, want Ignored", event)
		}
	})
}

func TestParseNotificationIgnoresAnExpiredSubscriptionCheckout(t *testing.T) {
	payload, headers := stripetest.SignedEvent(t, testWebhookSecret, "checkout.session.expired", map[string]any{
		"id":       "cs_expired_subscription",
		"object":   "checkout.session",
		"mode":     "subscription",
		"metadata": stripetest.SubscriptionMetadata(uuid.New(), uuid.New(), uuid.New()),
	})
	event, err := stripe.New().ParseNotification(t.Context(), payload, headers, paymentprovider.Credentials{
		stripe.FieldWebhookSecret: testWebhookSecret,
	})
	if err != nil {
		t.Fatalf("ParseNotification: %v", err)
	}
	if _, ok := event.(paymentprovider.Ignored); !ok {
		t.Fatalf("event = %T, want Ignored", event)
	}
}

// A subscription Stripe no longer knows, or one it answers in a state this
// server does not, is refused, so Stripe delivers the notification again
// rather than the server recording something it did not read.
func TestParseNotificationRefusesASubscriptionItCannotRead(t *testing.T) {
	fixture := stripetest.NewFixture(t)
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	metadata := stripetest.SubscriptionMetadata(uuid.New(), uuid.New(), uuid.New())

	payload, headers := stripetest.SignedEvent(t, credentials[stripe.FieldWebhookSecret], "customer.subscription.updated", map[string]any{
		"id":       "sub_missing",
		"object":   "subscription",
		"metadata": metadata,
	})
	if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
		t.Fatalf("ParseNotification of a missing subscription = %v, want ErrMalformedNotification", err)
	}

	payload, headers = fixture.SubscriptionUpdated(t, credentials, stripetest.Subscription{
		ID:         "sub_unknown_status",
		CustomerID: "cus_unknown_status",
		PriceID:    "price_monthly",
		Status:     "suspended",
		Metadata:   metadata,
	})
	if _, err := provider.ParseNotification(t.Context(), payload, headers, credentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
		t.Fatalf("ParseNotification of an unknown status = %v, want ErrMalformedNotification", err)
	}
}
