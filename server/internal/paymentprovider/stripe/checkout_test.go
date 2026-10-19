package stripe_test

import (
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentprovider/stripe/stripetest"
)

var checkoutCredentials = paymentprovider.Credentials{stripe.FieldSecretKey: "sk_test_checkout"}

// A checkout of the rest of a series lists each episode at its own price and
// takes the discount off with a coupon made for that checkout alone, which a
// retried request reuses.
func TestStartCheckoutListsEveryLineAndTakesTheDiscountOffWithACoupon(t *testing.T) {
	api := stripetest.NewAPI(t)
	provider := stripe.New(stripe.WithAPIURL(api.URL()))
	request := paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID:       uuid.New(),
			ReaderID:       uuid.New(),
			SeriesBundleID: uuid.New(),
			Kind:           paymentprovider.KindPurchase,
			Price:          450,
			Currency:       "JPY",
		},
		LineItems: []paymentprovider.LineItem{
			{Name: "Second", Price: 300, DiscountedPrice: 270},
			{Name: "Third", Price: 200, DiscountedPrice: 180},
		},
		Discount:       &paymentprovider.Discount{Name: "Bundle discount (10%)", Amount: 50},
		SuccessURL:     "https://store.example/series/SR01?checkout=success&remainder=1",
		CancelURL:      "https://store.example/series/SR01?checkout=cancelled&remainder=1",
		IdempotencyKey: "series-remainder-checkout:key",
	}
	for range 2 {
		checkoutURL, err := provider.StartCheckout(t.Context(), checkoutCredentials, request)
		if err != nil {
			t.Fatalf("StartCheckout: %v", err)
		}
		if checkoutURL == "" {
			t.Fatal("StartCheckout answered no URL")
		}
	}

	coupons := api.Coupons()
	if len(coupons) != 1 {
		t.Fatalf("coupons = %d, want the one a retry reuses", len(coupons))
	}
	coupon := coupons[0].Form
	if coupon.Get("amount_off") != "50" || coupon.Get("currency") != "jpy" || coupon.Get("duration") != "once" || coupon.Get("max_redemptions") != "1" || coupon.Get("name") != "Bundle discount (10%)" {
		t.Fatalf("coupon = %v, want 50 yen off once under its name", coupon)
	}

	session := api.CheckoutSessions()[0].Form
	for i, want := range []struct{ name, amount string }{{"Second", "300"}, {"Third", "200"}} {
		prefix := fmt.Sprintf("line_items[%d]", i)
		if session.Get(prefix+"[price_data][product_data][name]") != want.name || session.Get(prefix+"[price_data][unit_amount]") != want.amount || session.Get(prefix+"[quantity]") != "1" {
			t.Fatalf("line %d = %v, want one %s at %s", i, session, want.name, want.amount)
		}
	}
	if session.Get("line_items[2][price_data][unit_amount]") != "" {
		t.Fatalf("session = %v, want two lines", session)
	}
	if session.Get("discounts[0][coupon]") != coupons[0].ID {
		t.Fatalf("discounts = %v, want the coupon %s", session, coupons[0].ID)
	}
	if session.Get("metadata[series_bundle_id]") != request.Purchase.SeriesBundleID.String() || session.Get("metadata[price]") != "450" || session.Has("metadata[episode_id]") {
		t.Fatalf("metadata = %v, want the bundle at 450 and no episode", session)
	}
}

// A checkout of one episode sells one line at the purchase's price and makes
// no coupon.
func TestStartCheckoutSellsOneLineWithoutADiscount(t *testing.T) {
	api := stripetest.NewAPI(t)
	if _, err := stripe.New(stripe.WithAPIURL(api.URL())).StartCheckout(t.Context(), checkoutCredentials, paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID:  uuid.New(),
			ReaderID:  uuid.New(),
			EpisodeID: uuid.New(),
			Kind:      paymentprovider.KindPurchase,
			Price:     500,
			Currency:  "JPY",
		},
		LineItemName:   "Episode 1",
		SuccessURL:     "https://store.example/series/SR01/episodes/EP01?checkout=success",
		CancelURL:      "https://store.example/series/SR01/episodes/EP01?checkout=cancelled",
		IdempotencyKey: "episode-checkout:key",
	}); err != nil {
		t.Fatalf("StartCheckout: %v", err)
	}
	if coupons := api.Coupons(); len(coupons) != 0 {
		t.Fatalf("coupons = %v, want none", coupons)
	}
	session := api.CheckoutSessions()[0].Form
	if session.Get("line_items[0][price_data][product_data][name]") != "Episode 1" || session.Get("line_items[0][price_data][unit_amount]") != "500" || session.Has("line_items[1][quantity]") || session.Has("discounts[0][coupon]") {
		t.Fatalf("session = %v, want one Episode 1 at 500 and no discount", session)
	}
}
