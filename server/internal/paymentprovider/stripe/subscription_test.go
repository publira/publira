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
	checkout, err := provider.StartSubscriptionCheckout(t.Context(), checkoutCredentials, request)
	if err != nil {
		t.Fatalf("StartSubscriptionCheckout: %v", err)
	}
	if checkout.ID == "" || checkout.URL == "" || checkout.Status != paymentprovider.SubscriptionCheckoutOpen {
		t.Fatalf("checkout = %+v, want an open one with an id and a URL", checkout)
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

// Every notification about a subscription a plan's checkout started names that
// subscription, and leaves reading it to RetrieveSubscription.
func TestParseNotificationNamesTheSubscription(t *testing.T) {
	fixture := stripetest.NewFixture(t)
	provider := fixture.Provider()
	credentials := fixture.Credentials()
	subscription := stripetest.Subscription{
		ID:         "sub_parse",
		CustomerID: "cus_parse",
		PriceID:    "price_monthly",
		Status:     "active",
		Metadata:   stripetest.SubscriptionMetadata(uuid.New(), uuid.New(), uuid.New()),
	}
	cases := map[string]func() ([]byte, map[string][]string){
		"a completed subscription checkout": func() ([]byte, map[string][]string) {
			return fixture.SubscriptionCheckoutCompleted(t, credentials, "cs_parse", subscription)
		},
		"an update": func() ([]byte, map[string][]string) {
			return fixture.SubscriptionUpdated(t, credentials, subscription)
		},
		"a deletion": func() ([]byte, map[string][]string) {
			return fixture.SubscriptionDeleted(t, credentials, subscription)
		},
		"a failed renewal": func() ([]byte, map[string][]string) {
			return fixture.InvoicePaymentFailed(t, credentials, subscription)
		},
	}
	for name, notification := range cases {
		t.Run(name, func(t *testing.T) {
			payload, headers := notification()
			event, err := provider.ParseNotification(t.Context(), payload, headers, credentials)
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			changed, ok := event.(paymentprovider.SubscriptionChanged)
			if !ok {
				t.Fatalf("event = %T, want SubscriptionChanged", event)
			}
			if changed.ID == "" || changed.SubscriptionID != "sub_parse" {
				t.Fatalf("event = %+v, want it to name sub_parse", changed)
			}
		})
	}
}

// RetrieveSubscription answers the subscription as Stripe holds it at the
// moment it is asked, whatever a notification about it carried.
func TestRetrieveSubscriptionAnswersTheSubscriptionAsStripeHoldsItNow(t *testing.T) {
	fixture := stripetest.NewFixture(t)
	provider := stripe.New(stripe.WithAPIURL(fixture.API.URL()))
	credentials := fixture.Credentials()
	tenantID, readerID, planID := uuid.New(), uuid.New(), uuid.New()
	periodEnd := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	subscription := stripetest.Subscription{
		ID:               "sub_retrieve",
		CustomerID:       "cus_retrieve",
		PriceID:          "price_monthly",
		Status:           "active",
		CurrentPeriodEnd: periodEnd.Unix(),
		Metadata:         stripetest.SubscriptionMetadata(tenantID, readerID, planID),
	}
	fixture.SubscriptionUpdated(t, credentials, subscription)
	// The subscription changes again after the notification was sent.
	subscription.Status = "past_due"
	subscription.CancelAtPeriodEnd = true
	fixture.API.SetSubscription(credentials[stripe.FieldSecretKey], subscription)

	got, err := provider.RetrieveSubscription(t.Context(), credentials, "sub_retrieve")
	if err != nil {
		t.Fatalf("RetrieveSubscription: %v", err)
	}
	want := paymentprovider.Subscription{
		ID:                "sub_retrieve",
		CustomerID:        "cus_retrieve",
		TenantID:          tenantID,
		ReaderID:          readerID,
		PlanID:            planID,
		PriceID:           "price_monthly",
		Status:            paymentprovider.SubscriptionPastDue,
		CurrentPeriodEnd:  periodEnd,
		CancelAtPeriodEnd: true,
	}
	if got != want {
		t.Fatalf("subscription = %+v, want %+v", got, want)
	}
}

// A subscription Stripe does not hold, or one in a state this server does not
// know, is refused rather than recorded as something it was not read as.
func TestRetrieveSubscriptionRefusesASubscriptionItCannotRead(t *testing.T) {
	fixture := stripetest.NewFixture(t)
	provider := stripe.New(stripe.WithAPIURL(fixture.API.URL()))
	credentials := fixture.Credentials()

	if _, err := provider.RetrieveSubscription(t.Context(), credentials, "sub_missing"); !errors.Is(err, paymentprovider.ErrSubscriptionNotFound) {
		t.Fatalf("RetrieveSubscription of a missing subscription = %v, want ErrSubscriptionNotFound", err)
	}
	fixture.API.SetSubscription(credentials[stripe.FieldSecretKey], stripetest.Subscription{
		ID:         "sub_unknown_status",
		CustomerID: "cus_unknown_status",
		PriceID:    "price_monthly",
		Status:     "suspended",
		Metadata:   stripetest.SubscriptionMetadata(uuid.New(), uuid.New(), uuid.New()),
	})
	if _, err := provider.RetrieveSubscription(t.Context(), credentials, "sub_unknown_status"); err == nil {
		t.Fatal("RetrieveSubscription of an unknown status succeeded")
	}
	fixture.API.SetSubscription(credentials[stripe.FieldSecretKey], stripetest.Subscription{
		ID:         "sub_no_metadata",
		CustomerID: "cus_no_metadata",
		PriceID:    "price_monthly",
		Status:     "active",
		Metadata:   map[string]string{},
	})
	if _, err := provider.RetrieveSubscription(t.Context(), credentials, "sub_no_metadata"); err == nil {
		t.Fatal("RetrieveSubscription of a subscription no plan started succeeded")
	}
}

// An open checkout can be read and expired; one that is no longer open is
// refused as such, so the caller reads it again.
func TestSubscriptionCheckoutsCanBeReadAndExpired(t *testing.T) {
	api := stripetest.NewAPI(t)
	provider := stripe.New(stripe.WithAPIURL(api.URL()))
	start := func() paymentprovider.SubscriptionCheckout {
		t.Helper()
		checkout, err := provider.StartSubscriptionCheckout(t.Context(), checkoutCredentials, paymentprovider.SubscriptionCheckoutRequest{
			TenantID:   uuid.New(),
			ReaderID:   uuid.New(),
			PlanID:     uuid.New(),
			PriceID:    "price_monthly",
			SuccessURL: "https://store.example/my",
			CancelURL:  "https://store.example/plans",
		})
		if err != nil {
			t.Fatalf("StartSubscriptionCheckout: %v", err)
		}
		return checkout
	}

	open := start()
	got, err := provider.GetSubscriptionCheckout(t.Context(), checkoutCredentials, open.ID)
	if err != nil || got.Status != paymentprovider.SubscriptionCheckoutOpen || got.URL == "" {
		t.Fatalf("GetSubscriptionCheckout = (%+v, %v), want it open with its URL", got, err)
	}
	if err := provider.ExpireSubscriptionCheckout(t.Context(), checkoutCredentials, open.ID); err != nil {
		t.Fatalf("ExpireSubscriptionCheckout: %v", err)
	}
	got, err = provider.GetSubscriptionCheckout(t.Context(), checkoutCredentials, open.ID)
	if err != nil || got.Status != paymentprovider.SubscriptionCheckoutExpired || got.URL != "" {
		t.Fatalf("GetSubscriptionCheckout after expiring = (%+v, %v), want it expired", got, err)
	}
	if err := provider.ExpireSubscriptionCheckout(t.Context(), checkoutCredentials, open.ID); !errors.Is(err, paymentprovider.ErrCheckoutNotOpen) {
		t.Fatalf("ExpireSubscriptionCheckout of an expired checkout = %v, want ErrCheckoutNotOpen", err)
	}

	paid := start()
	api.CompleteCheckoutSession(paid.ID, "sub_paid")
	if err := provider.ExpireSubscriptionCheckout(t.Context(), checkoutCredentials, paid.ID); !errors.Is(err, paymentprovider.ErrCheckoutNotOpen) {
		t.Fatalf("ExpireSubscriptionCheckout of a paid checkout = %v, want ErrCheckoutNotOpen", err)
	}
	got, err = provider.GetSubscriptionCheckout(t.Context(), checkoutCredentials, paid.ID)
	if err != nil || got.Status != paymentprovider.SubscriptionCheckoutComplete || got.SubscriptionID != "sub_paid" {
		t.Fatalf("GetSubscriptionCheckout of a paid checkout = (%+v, %v), want it complete with its subscription", got, err)
	}
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
			return fixture.SubscriptionCheckoutCompleted(t, credentials, "cs_foreign", foreign)
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
