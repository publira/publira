package publicapi

import (
	"net/url"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
)

func TestPurchaseReturnURL(t *testing.T) {
	base, err := url.Parse("https://store.example")
	if err != nil {
		t.Fatal(err)
	}
	got, err := url.Parse(purchaseReturnURL(base, "series", "episode", "success"))
	if err != nil {
		t.Fatal(err)
	}
	if got.Host != "store.example" {
		t.Fatalf("host = %q", got.Host)
	}
	if got.Path != "/series/series/episodes/episode" {
		t.Fatalf("path = %q", got.Path)
	}
	if got.Query().Get("checkout") != "success" {
		t.Fatalf("query = %q", got.RawQuery)
	}
}

func TestMobilePurchaseReturnURL(t *testing.T) {
	base, err := url.Parse("https://store.example")
	if err != nil {
		t.Fatal(err)
	}
	got, err := url.Parse(mobilePurchaseReturnURL(base, "ja", "episode", "success"))
	if err != nil {
		t.Fatal(err)
	}
	if got.Host != "store.example" {
		t.Fatalf("host = %q", got.Host)
	}
	if got.Path != "/ja/checkout/return" {
		t.Fatalf("path = %q", got.Path)
	}
	if got.Query().Get("episode") != "episode" || got.Query().Get("status") != "success" {
		t.Fatalf("query = %q", got.RawQuery)
	}
}

// A retry of the same request reuses the provider's checkout, and a request
// that differs in anything it sends starts another one.
func TestCheckoutIdempotencyKeyFollowsTheRequest(t *testing.T) {
	request := paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID:           uuid.Must(uuid.NewV7()),
			ReaderID:           uuid.Must(uuid.NewV7()),
			EpisodeID:          uuid.Must(uuid.NewV7()),
			Price:              300,
			ReadingPeriodHours: 24,
		},
		EpisodeTitle: "Episode 1",
		SuccessURL:   "https://tenant.example/series/SERIES001/episodes/EPISODE001?checkout=success",
		CancelURL:    "https://tenant.example/series/SERIES001/episodes/EPISODE001?checkout=cancelled",
	}
	key, err := checkoutIdempotencyKey(request)
	if err != nil {
		t.Fatalf("checkoutIdempotencyKey: %v", err)
	}
	if len(key) > 255 {
		t.Fatalf("key is %d bytes, longer than the 255 Stripe accepts", len(key))
	}
	retried := request
	retried.IdempotencyKey = "a key from an earlier attempt"
	if again, err := checkoutIdempotencyKey(retried); err != nil || again != key {
		t.Fatalf("key of the same request = (%q, %v), want %q", again, err, key)
	}

	changes := map[string]func(*paymentprovider.CheckoutRequest){
		"price":          func(r *paymentprovider.CheckoutRequest) { r.Purchase.Price = 500 },
		"reading period": func(r *paymentprovider.CheckoutRequest) { r.Purchase.ReadingPeriodHours = 48 },
		"episode title":  func(r *paymentprovider.CheckoutRequest) { r.EpisodeTitle = "Episode 1: The Beginning" },
		"success URL": func(r *paymentprovider.CheckoutRequest) {
			r.SuccessURL = "https://tenant.example/en/checkout/return?episode=EPISODE001&status=success"
		},
		"cancel URL": func(r *paymentprovider.CheckoutRequest) {
			r.CancelURL = "https://tenant.example/en/checkout/return?episode=EPISODE001&status=cancelled"
		},
	}
	for name, change := range changes {
		changed := request
		change(&changed)
		got, err := checkoutIdempotencyKey(changed)
		if err != nil {
			t.Fatalf("checkoutIdempotencyKey after a change of %s: %v", name, err)
		}
		if got == key {
			t.Fatalf("key after a change of %s = %q, the key of the earlier request", name, got)
		}
	}
}
