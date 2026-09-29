package payjp_test

import (
	"errors"
	"net/url"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/payjp/payjptest"
)

const (
	testSecretKey    = "sk_test_ProviderTestAAAA"
	testWebhookToken = "whook_ProviderTestAAAA"
)

var testCredentials = paymentprovider.Credentials{
	payjp.FieldSecretKey:    testSecretKey,
	payjp.FieldWebhookToken: testWebhookToken,
}

func testPurchase() paymentprovider.Purchase {
	return paymentprovider.Purchase{
		TenantID:           uuid.New(),
		ReaderID:           uuid.New(),
		EpisodeID:          uuid.New(),
		Price:              500,
		ReadingPeriodHours: 72,
	}
}

func TestStartCheckoutAsksForACardPaymentWithThreeDSecure(t *testing.T) {
	api := payjptest.NewAPI(t)
	purchase := testPurchase()
	checkoutURL, err := payjp.New(payjp.WithBaseURL(api.URL())).StartCheckout(t.Context(), testCredentials, paymentprovider.CheckoutRequest{
		Purchase:       purchase,
		EpisodeTitle:   "Episode 1",
		SuccessURL:     "https://store.example/series/SR01/episodes/EP01?checkout=success",
		CancelURL:      "https://store.example/series/SR01/episodes/EP01?checkout=cancelled",
		IdempotencyKey: "episode-checkout:key",
	})
	if err != nil {
		t.Fatalf("StartCheckout: %v", err)
	}
	if checkoutURL != "https://checkout.pay.jp/c/cs_fake0001" {
		t.Fatalf("url = %q, want the Checkout Session's", checkoutURL)
	}

	sessions := api.CheckoutSessions()
	if len(sessions) != 1 {
		t.Fatalf("checkout sessions = %d, want 1", len(sessions))
	}
	session := sessions[0]
	if session.SecretKey != testSecretKey || session.IdempotencyKey != "episode-checkout:key" {
		t.Fatalf("request key = %q, idempotency key = %q", session.SecretKey, session.IdempotencyKey)
	}
	body := session.Body
	if body["mode"] != "payment" || body["cancel_url"] != "https://store.example/series/SR01/episodes/EP01?checkout=cancelled" {
		t.Fatalf("session = %v, want a payment returning to the episode", body)
	}
	successURL, err := url.Parse(body["success_url"].(string))
	if err != nil {
		t.Fatalf("success_url: %v", err)
	}
	if successURL.Path != "/series/SR01/episodes/EP01" || successURL.Query().Get("checkout") != "success" || successURL.Query().Get("session_id") == "" {
		t.Fatalf("success_url = %s, want the episode with checkout=success and a session_id", successURL)
	}
	if methods, _ := body["payment_method_types"].([]any); len(methods) != 1 || methods[0] != "card" {
		t.Fatalf("payment_method_types = %v, want card alone", body["payment_method_types"])
	}
	options, _ := body["payment_method_options"].(map[string]any)
	card, _ := options["card"].(map[string]any)
	if card["request_three_d_secure"] != "any" {
		t.Fatalf("payment_method_options = %v, want 3-D Secure required", body["payment_method_options"])
	}
	items, _ := body["line_items"].([]any)
	if len(items) != 1 {
		t.Fatalf("line_items = %v, want one", body["line_items"])
	}
	item, _ := items[0].(map[string]any)
	price, _ := item["price_data"].(map[string]any)
	product, _ := price["product_data"].(map[string]any)
	if item["quantity"] != float64(1) || price["unit_amount"] != float64(500) || price["currency"] != "jpy" || product["name"] != "Episode 1" {
		t.Fatalf("line item = %v, want one Episode 1 at 500 yen", item)
	}
	metadata, _ := body["metadata"].(map[string]any)
	for key, want := range payjptest.PurchaseMetadata(purchase) {
		if metadata[key] != want {
			t.Fatalf("metadata[%s] = %v, want %v", key, metadata[key], want)
		}
	}
}

func TestStartCheckoutReturnsTheSameURLForARetry(t *testing.T) {
	api := payjptest.NewAPI(t)
	provider := payjp.New(payjp.WithBaseURL(api.URL()))
	start := func(key string) {
		t.Helper()
		if _, err := provider.StartCheckout(t.Context(), testCredentials, paymentprovider.CheckoutRequest{
			Purchase:       testPurchase(),
			SuccessURL:     "https://store.example/series/SR01/episodes/EP01?checkout=success",
			IdempotencyKey: key,
		}); err != nil {
			t.Fatalf("StartCheckout: %v", err)
		}
	}
	start("episode-checkout:first")
	start("episode-checkout:first")
	start("episode-checkout:second")

	sessions := api.CheckoutSessions()
	if sessions[0].Body["success_url"] != sessions[1].Body["success_url"] {
		t.Fatalf("a retry returned to %v, then %v", sessions[0].Body["success_url"], sessions[1].Body["success_url"])
	}
	if sessions[0].Body["success_url"] == sessions[2].Body["success_url"] {
		t.Fatalf("two checkouts return to the same %v", sessions[0].Body["success_url"])
	}
}

func TestStartCheckoutNeedsASecretKey(t *testing.T) {
	api := payjptest.NewAPI(t)
	_, err := payjp.New(payjp.WithBaseURL(api.URL())).StartCheckout(t.Context(), paymentprovider.Credentials{}, paymentprovider.CheckoutRequest{
		Purchase: testPurchase(),
	})
	if err == nil {
		t.Fatal("StartCheckout without a secret key succeeded")
	}
	if got := len(api.CheckoutSessions()); got != 0 {
		t.Fatalf("checkout sessions = %d, want 0", got)
	}
}

func completedCheckout(t *testing.T, api *payjptest.API, purchase paymentprovider.Purchase) (paymentprovider.Event, error) {
	t.Helper()
	payload, headers := payjptest.Event(t, testWebhookToken, "checkout.session.completed.json", map[string]any{
		"id":              "cs_provider",
		"payment_flow_id": "pfw_provider",
		"metadata":        payjptest.PurchaseMetadata(purchase),
	})
	return payjp.New(payjp.WithBaseURL(api.URL())).ParseNotification(t.Context(), payload, headers, testCredentials)
}

func TestACompletedCheckoutWaitsForItsPaymentToSettle(t *testing.T) {
	purchase := testPurchase()
	tests := []struct {
		name    string
		status  string
		amount  int
		want    string
		wantErr bool
	}{
		{name: "succeeded", status: "succeeded", amount: 500, want: "completed"},
		{name: "still processing", status: "processing", amount: 0, wantErr: true},
		{name: "canceled", status: "canceled", amount: 0, want: "ignored"},
		{name: "paid another amount", status: "succeeded", amount: 300, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			api := payjptest.NewAPI(t)
			api.SetPaymentFlow(testSecretKey, "pfw_provider", tt.status, tt.amount)
			event, err := completedCheckout(t, api, purchase)
			if tt.wantErr {
				if err == nil || errors.Is(err, paymentprovider.ErrMalformedNotification) {
					t.Fatalf("ParseNotification error = %v, want one PAY.JP retries", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseNotification: %v", err)
			}
			switch event := event.(type) {
			case paymentprovider.PurchaseCompleted:
				if tt.want != "completed" {
					t.Fatalf("event = %+v, want %s", event, tt.want)
				}
				if event.CheckoutID != "cs_provider" || event.PaymentID != "pfw_provider" || event.Purchase != purchase {
					t.Fatalf("event = %+v, want the checkout's purchase", event)
				}
			case paymentprovider.Ignored:
				if tt.want != "ignored" {
					t.Fatalf("event = %+v, want %s", event, tt.want)
				}
			default:
				t.Fatalf("event = %T", event)
			}
		})
	}
}

func TestACompletedCheckoutOfAnotherAccountIsRefused(t *testing.T) {
	api := payjptest.NewAPI(t)
	api.SetPaymentFlow("sk_test_AnotherAccount", "pfw_provider", "succeeded", 500)
	if _, err := completedCheckout(t, api, testPurchase()); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
		t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
	}
}

func refund(t *testing.T, api *payjptest.API) (paymentprovider.Event, error) {
	t.Helper()
	payload, headers := payjptest.Event(t, testWebhookToken, "refund.created.json", map[string]any{
		"payment_flow_id": "pfw_provider",
	})
	return payjp.New(payjp.WithBaseURL(api.URL())).ParseNotification(t.Context(), payload, headers, testCredentials)
}

func TestARefundReportsTheTotalThatWentThrough(t *testing.T) {
	api := payjptest.NewAPI(t)
	api.SetPaymentFlow(testSecretKey, "pfw_provider", "succeeded", 500)
	api.AddRefund(testSecretKey, "pfw_provider", 200, "succeeded")
	api.AddRefund(testSecretKey, "pfw_provider", 100, "failed")
	api.AddRefund(testSecretKey, "pfw_provider", 300, "succeeded")

	event, err := refund(t, api)
	if err != nil {
		t.Fatalf("ParseNotification: %v", err)
	}
	refunded, ok := event.(paymentprovider.Refunded)
	if !ok {
		t.Fatalf("event = %T, want Refunded", event)
	}
	if refunded.PaymentID != "pfw_provider" || refunded.AmountRefunded != 500 || refunded.Currency != "JPY" {
		t.Fatalf("refund = %+v, want 500 JPY on pfw_provider", refunded)
	}
}

func TestARefundThatHasNotGoneThroughChangesNothing(t *testing.T) {
	api := payjptest.NewAPI(t)
	api.SetPaymentFlow(testSecretKey, "pfw_provider", "succeeded", 500)
	api.AddRefund(testSecretKey, "pfw_provider", 500, "pending")

	event, err := refund(t, api)
	if err != nil {
		t.Fatalf("ParseNotification: %v", err)
	}
	if _, ok := event.(paymentprovider.Ignored); !ok {
		t.Fatalf("event = %T, want Ignored", event)
	}
}

func TestARefundSumsEveryPageOfRefunds(t *testing.T) {
	api := payjptest.NewAPI(t)
	api.SetPaymentFlow(testSecretKey, "pfw_provider", "succeeded", 500)
	for range 250 {
		api.AddRefund(testSecretKey, "pfw_provider", 2, "succeeded")
	}

	event, err := refund(t, api)
	if err != nil {
		t.Fatalf("ParseNotification: %v", err)
	}
	if refunded, ok := event.(paymentprovider.Refunded); !ok || refunded.AmountRefunded != 500 {
		t.Fatalf("event = %+v, want 500 refunded", event)
	}
}

func TestParseNotificationRejectsMalformedMetadata(t *testing.T) {
	purchase := testPurchase()
	tests := map[string]map[string]any{
		"a price of nothing":                    {payjp.MetadataPrice: "0"},
		"a number price":                        {payjp.MetadataPrice: 500},
		"no tenant":                             {payjp.MetadataTenantID: nil},
		"a reading period that is not a string": {payjp.MetadataReadingPeriodHours: 72},
	}
	for name, fields := range tests {
		t.Run(name, func(t *testing.T) {
			api := payjptest.NewAPI(t)
			api.SetPaymentFlow(testSecretKey, "pfw_provider", "succeeded", 500)
			metadata := payjptest.PurchaseMetadata(purchase)
			for key, value := range fields {
				if value == nil {
					delete(metadata, key)
					continue
				}
				metadata[key] = value
			}
			payload, headers := payjptest.Event(t, testWebhookToken, "checkout.session.completed.json", map[string]any{
				"payment_flow_id": "pfw_provider",
				"metadata":        metadata,
			})
			_, err := payjp.New(payjp.WithBaseURL(api.URL())).ParseNotification(t.Context(), payload, headers, testCredentials)
			if !errors.Is(err, paymentprovider.ErrMalformedNotification) {
				t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
			}
		})
	}
}
