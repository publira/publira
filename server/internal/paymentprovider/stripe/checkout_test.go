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
	// Stripe takes a session's own discount or a promotion code, never both.
	if session.Has("allow_promotion_codes") {
		t.Fatalf("session = %v, want no promotion codes beside the bundle's coupon", session)
	}
	if session.Get("metadata[series_bundle_id]") != request.Purchase.SeriesBundleID.String() || session.Get("metadata[price]") != "450" || session.Has("metadata[episode_id]") {
		t.Fatalf("metadata = %v, want the bundle at 450 and no episode", session)
	}
}

// A checkout of one episode sells one line at the purchase's price, makes no
// coupon, and lets the reader enter a promotion code.
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
	if session.Get("allow_promotion_codes") != "true" {
		t.Fatalf("session = %v, want promotion codes allowed", session)
	}
}

// A checkout of a pack carries what it grants to the notification that
// confirms it, and takes no promotion code: the coins are worth what was paid
// for them, and a code would grant them for less.
func TestStartCheckoutOfACoinPackTakesNoPromotionCode(t *testing.T) {
	api := stripetest.NewAPI(t)
	purchase := paymentprovider.Purchase{
		TenantID:       uuid.New(),
		ReaderID:       uuid.New(),
		CoinPackID:     uuid.New(),
		Coins:          1000,
		BonusCoins:     100,
		CoinExpiryDays: 180,
		Kind:           paymentprovider.KindPurchase,
		Price:          1000,
		Currency:       "JPY",
	}
	if _, err := stripe.New(stripe.WithAPIURL(api.URL())).StartCheckout(t.Context(), checkoutCredentials, paymentprovider.CheckoutRequest{
		Purchase:       purchase,
		LineItemName:   "1,100 Points (including 100 bonus)",
		SuccessURL:     "https://store.example/my/coins?checkout=success&coin_pack=PACK01",
		CancelURL:      "https://store.example/my/coins?checkout=cancelled&coin_pack=PACK01",
		IdempotencyKey: "coin-pack-checkout:key",
	}); err != nil {
		t.Fatalf("StartCheckout: %v", err)
	}
	session := api.CheckoutSessions()[0].Form
	if session.Has("allow_promotion_codes") || session.Has("discounts[0][coupon]") {
		t.Fatalf("session = %v, want neither a promotion code nor a discount", session)
	}
	for key, want := range map[string]string{
		"metadata[coin_pack_id]":     purchase.CoinPackID.String(),
		"metadata[coins]":            "1000",
		"metadata[bonus_coins]":      "100",
		"metadata[coin_expiry_days]": "180",
		"metadata[price]":            "1000",
	} {
		if got := session.Get(key); got != want {
			t.Fatalf("%s = %q, want %q", key, got, want)
		}
	}
	if session.Has("metadata[episode_id]") {
		t.Fatalf("metadata = %v, want no episode", session)
	}
}
