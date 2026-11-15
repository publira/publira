package paidy_test

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/paidy"
	"github.com/publira/publira/server/internal/paymentprovider/paidy/paidytest"
)

var testCredentials = paymentprovider.Credentials{
	paidy.FieldPublicKey: "pk_test_providertest",
	paidy.FieldSecretKey: "sk_test_providertest",
}

func storedCheckout(checkoutID string) paymentprovider.StoredCheckout {
	return paymentprovider.StoredCheckout{
		CheckoutID: checkoutID,
		Purchase: paymentprovider.Purchase{
			TenantID:  uuid.New(),
			ReaderID:  uuid.New(),
			EpisodeID: uuid.New(),
			Kind:      paymentprovider.KindPurchase,
			Price:     500,
			Currency:  "JPY",
		},
		LineItemName: "Episode 1",
	}
}

func TestStartCheckoutAnswersTheStorefrontPageAndChargesInYenOnly(t *testing.T) {
	provider := paidy.New(paidy.WithAPIURL("http://127.0.0.1:1"))
	req := paymentprovider.CheckoutRequest{
		Purchase:   storedCheckout("0123456789abcdef0123456789abcdef").Purchase,
		CheckoutID: "0123456789abcdef0123456789abcdef",
		PageURL:    "https://store.example/pay/paidy/0123456789abcdef0123456789abcdef",
	}
	got, err := provider.StartCheckout(t.Context(), testCredentials, req)
	if err != nil || got != req.PageURL {
		t.Fatalf("StartCheckout = %q, %v; want %q", got, err, req.PageURL)
	}
	req.Purchase.Currency = "USD"
	if _, err := provider.StartCheckout(t.Context(), testCredentials, req); err == nil {
		t.Fatal("a checkout in USD was started")
	}
}

// launched decodes what Paidy Checkout is launched with.
type launched struct {
	Amount    int64          `json:"amount"`
	Currency  string         `json:"currency"`
	BuyerData map[string]any `json:"buyer_data"`
	Order     struct {
		Items []struct {
			Title     string `json:"title"`
			UnitPrice int64  `json:"unit_price"`
			Quantity  int64  `json:"quantity"`
		} `json:"items"`
		OrderRef string `json:"order_ref"`
	} `json:"order"`
}

func TestCheckoutScript(t *testing.T) {
	// 2026-03-10 00:30 in Japan, which is still the 9th in UTC.
	now := time.Date(2026, time.March, 9, 15, 30, 0, 0, time.UTC)
	provider := paidy.New(paidy.WithClock(func() time.Time { return now }))
	script := func(t *testing.T, checkout paymentprovider.StoredCheckout, buyer paymentprovider.Buyer) launched {
		t.Helper()
		answered, err := provider.CheckoutScript(testCredentials, checkout, buyer)
		if err != nil {
			t.Fatalf("CheckoutScript: %v", err)
		}
		if len(answered.Credentials) != 1 || answered.Credentials[paidy.FieldPublicKey] != testCredentials[paidy.FieldPublicKey] {
			t.Fatalf("script credentials = %v, want the public key alone", answered.Credentials)
		}
		var payload launched
		if err := json.Unmarshal(answered.Payload, &payload); err != nil {
			t.Fatalf("decode %s: %v", answered.Payload, err)
		}
		return payload
	}

	t.Run("one line at the checkout's price, named by the checkout", func(t *testing.T) {
		checkout := storedCheckout("0123456789abcdef0123456789abcdef")
		payload := script(t, checkout, paymentprovider.Buyer{ID: "READER01", RegisteredAt: now.Add(-48 * time.Hour)})
		if payload.Amount != 500 || payload.Currency != "JPY" || payload.Order.OrderRef != checkout.CheckoutID {
			t.Fatalf("payload = %+v, want 500 JPY for order %s", payload, checkout.CheckoutID)
		}
		if len(payload.Order.Items) != 1 || payload.Order.Items[0].Title != "Episode 1" || payload.Order.Items[0].UnitPrice != 500 || payload.Order.Items[0].Quantity != 1 {
			t.Fatalf("items = %+v, want one Episode 1 at 500", payload.Order.Items)
		}
	})

	t.Run("a series bundle's lines and its discount add up to what it charges", func(t *testing.T) {
		checkout := storedCheckout("0123456789abcdef0123456789abcdee")
		checkout.Purchase.Price = 450
		checkout.LineItems = []paymentprovider.LineItem{{Name: "Episode 1", Price: 300, DiscountedPrice: 270}, {Name: "Episode 2", Price: 200, DiscountedPrice: 180}}
		checkout.Discount = &paymentprovider.Discount{Name: "Series bundle", Amount: 50}
		payload := script(t, checkout, paymentprovider.Buyer{ID: "READER01", RegisteredAt: now})
		var sum int64
		for _, line := range payload.Order.Items {
			sum += line.UnitPrice * line.Quantity
		}
		if len(payload.Order.Items) != 3 || payload.Order.Items[2].UnitPrice != -50 || sum != payload.Amount || payload.Amount != 450 {
			t.Fatalf("items = %+v summing to %d, want two episodes and a discount of 50 summing to 450", payload.Order.Items, sum)
		}
	})

	t.Run("the buyer's history is counted in days and dated in Japan", func(t *testing.T) {
		payload := script(t, storedCheckout("0123456789abcdef0123456789abcded"), paymentprovider.Buyer{
			ID:           "READER01",
			RegisteredAt: time.Date(2026, time.January, 1, 15, 0, 0, 0, time.UTC),
			Payments:     3,
			AmountPaid:   1200,
			LastPaidAt:   time.Date(2026, time.March, 2, 16, 0, 0, 0, time.UTC),
			LastAmount:   400,
		})
		want := map[string]any{
			"user_id":                   "READER01",
			"age":                       float64(67),
			"account_registration_date": "2026-01-02",
			"ltv":                       float64(1200),
			"order_count":               float64(3),
			"last_order_amount":         float64(400),
			"last_order_at":             float64(6),
			"last_order_date":           "2026-03-03",
		}
		if len(payload.BuyerData) != len(want) {
			t.Fatalf("buyer_data = %v, want %v", payload.BuyerData, want)
		}
		for key, value := range want {
			if payload.BuyerData[key] != value {
				t.Fatalf("buyer_data[%s] = %v, want %v", key, payload.BuyerData[key], value)
			}
		}
	})

	t.Run("a reader who has paid nothing has no last order", func(t *testing.T) {
		payload := script(t, storedCheckout("0123456789abcdef0123456789abcdec"), paymentprovider.Buyer{ID: "READER02", RegisteredAt: now})
		for _, key := range []string{"last_order_amount", "last_order_at", "last_order_date"} {
			if _, ok := payload.BuyerData[key]; ok {
				t.Fatalf("buyer_data = %v names %s", payload.BuyerData, key)
			}
		}
		if payload.BuyerData["age"] != float64(0) || payload.BuyerData["ltv"] != float64(0) {
			t.Fatalf("buyer_data = %v, want an account of no age that paid nothing", payload.BuyerData)
		}
	})
}

func TestCompleteCheckout(t *testing.T) {
	const checkoutID = "0123456789abcdef0123456789abcdef"
	newAPI := func(t *testing.T) (*paidytest.API, *paidy.Provider) {
		t.Helper()
		api := paidytest.NewAPI(t)
		return api, api.Provider()
	}

	t.Run("a payment Paidy wrote in capitals is captured as one written in lower case", func(t *testing.T) {
		api, provider := newAPI(t)
		api.Authorize(testCredentials, "pay_capitals", checkoutID, 500, "JPY", false)
		api.SetStatus(testCredentials, "pay_capitals", "AUTHORIZED")
		completed, err := provider.CompleteCheckout(t.Context(), testCredentials, storedCheckout(checkoutID), "pay_capitals")
		if err != nil {
			t.Fatalf("CompleteCheckout: %v", err)
		}
		if completed.PaymentID != "pay_capitals" || completed.AmountPaid != 500 {
			t.Fatalf("completed = %+v, want pay_capitals paying 500", completed)
		}
		if held, _ := api.Payment(testCredentials, "pay_capitals"); len(held.Captures) != 1 {
			t.Fatalf("captures = %d, want 1", len(held.Captures))
		}
	})

	for name, prepare := range map[string]func(*paidytest.API){
		"a payment Paidy rejected": func(api *paidytest.API) {
			api.Reject(testCredentials, "pay_refused", checkoutID, 500)
		},
		"a payment closed without a capture": func(api *paidytest.API) {
			api.Authorize(testCredentials, "pay_refused", checkoutID, 500, "JPY", false)
			api.SetStatus(testCredentials, "pay_refused", paidytest.StatusClosed)
		},
		"a payment past its time to be captured": func(api *paidytest.API) {
			api.Authorize(testCredentials, "pay_refused", checkoutID, 500, "JPY", false)
			api.Expire(testCredentials, "pay_refused")
		},
	} {
		t.Run(name+" completes nothing", func(t *testing.T) {
			api, provider := newAPI(t)
			prepare(api)
			if _, err := provider.CompleteCheckout(t.Context(), testCredentials, storedCheckout(checkoutID), "pay_refused"); !errors.Is(err, paymentprovider.ErrPaymentMismatch) {
				t.Fatalf("CompleteCheckout error = %v, want ErrPaymentMismatch", err)
			}
			if held, _ := api.Payment(testCredentials, "pay_refused"); len(held.Captures) != 0 {
				t.Fatalf("captures = %d, want 0", len(held.Captures))
			}
		})
	}

	t.Run("an id the page made up is no payment, and is sent nowhere", func(t *testing.T) {
		_, provider := newAPI(t)
		if _, err := provider.CompleteCheckout(t.Context(), testCredentials, storedCheckout(checkoutID), "../pay_other/captures"); !errors.Is(err, paymentprovider.ErrPaymentMismatch) {
			t.Fatalf("CompleteCheckout error = %v, want ErrPaymentMismatch", err)
		}
	})

	t.Run("credentials Paidy does not answer are refused", func(t *testing.T) {
		_, provider := newAPI(t)
		credentials := paymentprovider.Credentials{paidy.FieldPublicKey: "pk_test_x", paidy.FieldSecretKey: "not_a_secret_key"}
		if _, err := provider.CompleteCheckout(t.Context(), credentials, storedCheckout(checkoutID), "pay_any"); !errors.Is(err, paymentprovider.ErrCredentialsRefused) {
			t.Fatalf("CompleteCheckout error = %v, want ErrCredentialsRefused", err)
		}
	})
}

func TestParseNotification(t *testing.T) {
	const checkoutID = "0123456789abcdef0123456789abcdef"
	api := paidytest.NewAPI(t)
	provider := api.Provider()
	parse := func(t *testing.T, name string, fields map[string]any) (paymentprovider.Event, error) {
		t.Helper()
		payload, headers := paidytest.Notification(t, name, fields)
		return provider.ParseNotification(t.Context(), payload, headers, testCredentials)
	}

	t.Run("the capture of a payment is its authorization, so a capture whose purchase was never recorded is completed", func(t *testing.T) {
		api.Take(testCredentials, "pay_captured", checkoutID, 500, "JPY", false, time.Now())
		event, err := parse(t, "capture_success.json", map[string]any{"payment_id": "pay_captured"})
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		authorized, ok := event.(paymentprovider.CheckoutAuthorized)
		if !ok || authorized.CheckoutID != checkoutID || authorized.PaymentID != "pay_captured" {
			t.Fatalf("event = %+v, want the authorization of pay_captured for %s", event, checkoutID)
		}
	})

	t.Run("a payment Paidy rejected is ignored", func(t *testing.T) {
		api.Reject(testCredentials, "pay_rejected", checkoutID, 500)
		event, err := parse(t, "authorize_success.json", map[string]any{"payment_id": "pay_rejected"})
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if _, ok := event.(paymentprovider.Ignored); !ok {
			t.Fatalf("event = %T, want Ignored", event)
		}
	})

	t.Run("a payment that names no order is ignored", func(t *testing.T) {
		api.Authorize(testCredentials, "pay_unnamed", "", 500, "JPY", false)
		event, err := parse(t, "authorize_success.json", map[string]any{"payment_id": "pay_unnamed"})
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if _, ok := event.(paymentprovider.Ignored); !ok {
			t.Fatalf("event = %T, want Ignored", event)
		}
	})

	t.Run("a notification of a token is ignored", func(t *testing.T) {
		event, err := provider.ParseNotification(t.Context(), []byte(`{"token_id":"tok_0000000000000000","status":"activate_success","timestamp":"2026-01-02T03:04:05.000Z"}`), nil, testCredentials)
		if err != nil {
			t.Fatalf("ParseNotification: %v", err)
		}
		if _, ok := event.(paymentprovider.Ignored); !ok {
			t.Fatalf("event = %T, want Ignored", event)
		}
	})

	for name, payload := range map[string]string{
		"not JSON":                    `payment_id=pay_0000000000000000`,
		"no status":                   `{"payment_id":"pay_0000000000000000","event_type":"payment"}`,
		"no payment":                  `{"event_type":"payment","status":"authorize_success"}`,
		"a payment id that is a path": `{"payment_id":"../pay_0000000000000000","event_type":"payment","status":"authorize_success"}`,
	} {
		t.Run("a notification with "+name+" is malformed", func(t *testing.T) {
			if _, err := provider.ParseNotification(t.Context(), []byte(payload), nil, testCredentials); !errors.Is(err, paymentprovider.ErrMalformedNotification) {
				t.Fatalf("ParseNotification error = %v, want ErrMalformedNotification", err)
			}
		})
	}
}

func TestRefundOfAPaymentNeverCapturedIsRefused(t *testing.T) {
	api := paidytest.NewAPI(t)
	provider := api.Provider()
	api.Authorize(testCredentials, "pay_uncaptured", "0123456789abcdef0123456789abcdef", 500, "JPY", false)
	_, err := provider.Refund(t.Context(), testCredentials, paymentprovider.RefundRequest{PaymentID: "pay_uncaptured", IdempotencyKey: "refund-uncaptured"})
	if !errors.Is(err, paymentprovider.ErrRefundRefused) {
		t.Fatalf("Refund error = %v, want ErrRefundRefused", err)
	}
	if got := api.RefundedTotal(testCredentials, "pay_uncaptured"); got != 0 {
		t.Fatalf("refunded = %d, want 0", got)
	}
}
