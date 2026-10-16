package publicapi

import (
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/locale"
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
		LineItemName: "Episode 1",
		SuccessURL:   "https://tenant.example/series/SERIES001/episodes/EPISODE001?checkout=success",
		CancelURL:    "https://tenant.example/series/SERIES001/episodes/EPISODE001?checkout=cancelled",
	}
	key, err := checkoutIdempotencyKey(request, "", "")
	if err != nil {
		t.Fatalf("checkoutIdempotencyKey: %v", err)
	}
	if len(key) > 255 {
		t.Fatalf("key is %d bytes, longer than the 255 Stripe accepts", len(key))
	}
	retried := request
	retried.IdempotencyKey = "a key from an earlier attempt"
	if again, err := checkoutIdempotencyKey(retried, "", ""); err != nil || again != key {
		t.Fatalf("key of the same request = (%q, %v), want %q", again, err, key)
	}

	changes := map[string]func(*paymentprovider.CheckoutRequest){
		"price":          func(r *paymentprovider.CheckoutRequest) { r.Purchase.Price = 500 },
		"reading period": func(r *paymentprovider.CheckoutRequest) { r.Purchase.ReadingPeriodHours = 48 },
		"line item name": func(r *paymentprovider.CheckoutRequest) { r.LineItemName = "Episode 1: The Beginning" },
		"kind":           func(r *paymentprovider.CheckoutRequest) { r.Purchase.Kind = paymentprovider.KindRental },
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
		got, err := checkoutIdempotencyKey(changed, "", "")
		if err != nil {
			t.Fatalf("checkoutIdempotencyKey after a change of %s: %v", name, err)
		}
		if got == key {
			t.Fatalf("key after a change of %s = %q, the key of the earlier request", name, got)
		}
	}
}

// Once the provider reports the reader's checkout expired, the same request
// starts a checkout of its own rather than being answered with the expired one,
// and a repeated report of that expiry keeps the new key.
func TestCheckoutIdempotencyKeyMovesPastAnExpiredCheckout(t *testing.T) {
	request := paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID:  uuid.Must(uuid.NewV7()),
			ReaderID:  uuid.Must(uuid.NewV7()),
			EpisodeID: uuid.Must(uuid.NewV7()),
			Price:     300,
		},
		LineItemName: "Episode 1",
		SuccessURL:   "https://tenant.example/series/SERIES001/episodes/EPISODE001?checkout=success",
		CancelURL:    "https://tenant.example/series/SERIES001/episodes/EPISODE001?checkout=cancelled",
	}
	keys := map[string]bool{}
	for _, expired := range []string{"", "cs_first", "cs_second"} {
		key, err := checkoutIdempotencyKey(request, expired, "")
		if err != nil {
			t.Fatalf("checkoutIdempotencyKey(%q): %v", expired, err)
		}
		if keys[key] {
			t.Fatalf("key after the expiry of %q = %q, a key already used", expired, key)
		}
		keys[key] = true
		if again, err := checkoutIdempotencyKey(request, expired, ""); err != nil || again != key {
			t.Fatalf("key after the same expiry of %q = (%q, %v), want %q", expired, again, err, key)
		}
	}
}

// Once the reader has paid a checkout, the same request starts a checkout of
// its own rather than being answered with the completed one, so a rental that
// ran out can be rented again, and a repeat of the same state keeps the key.
func TestCheckoutIdempotencyKeyMovesPastAPaidCheckout(t *testing.T) {
	request := paymentprovider.CheckoutRequest{
		Purchase: paymentprovider.Purchase{
			TenantID:           uuid.Must(uuid.NewV7()),
			ReaderID:           uuid.Must(uuid.NewV7()),
			EpisodeID:          uuid.Must(uuid.NewV7()),
			Kind:               paymentprovider.KindRental,
			Price:              200,
			ReadingPeriodHours: 1,
		},
		LineItemName: "Episode 1 (rental, 1 hour)",
		SuccessURL:   "https://tenant.example/series/SERIES001/episodes/EPISODE001?checkout=success",
		CancelURL:    "https://tenant.example/series/SERIES001/episodes/EPISODE001?checkout=cancelled",
	}
	keys := map[string]bool{}
	for _, paid := range []string{"", "cs_first_rental", "cs_second_rental"} {
		key, err := checkoutIdempotencyKey(request, "", paid)
		if err != nil {
			t.Fatalf("checkoutIdempotencyKey(paid %q): %v", paid, err)
		}
		if keys[key] {
			t.Fatalf("key after paying %q = %q, a key already used", paid, key)
		}
		keys[key] = true
		if again, err := checkoutIdempotencyKey(request, "", paid); err != nil || again != key {
			t.Fatalf("key after the same payment %q = (%q, %v), want %q", paid, again, err, key)
		}
	}
	// An expired checkout and a paid one with the same id are different
	// states, and key different checkouts.
	expired, err := checkoutIdempotencyKey(request, "cs_same", "")
	if err != nil {
		t.Fatalf("checkoutIdempotencyKey(expired): %v", err)
	}
	paid, err := checkoutIdempotencyKey(request, "", "cs_same")
	if err != nil {
		t.Fatalf("checkoutIdempotencyKey(paid): %v", err)
	}
	if expired == paid {
		t.Fatalf("an expired and a paid checkout of the same id share the key %q", paid)
	}
}

// Every locale names a rental by the episode's title and the period it is
// rented for, so a catalog that drops either would show the payment page a sale
// the reader cannot tell from the permanent copy.
func TestRentalLineItemNameCarriesTheTitleAndThePeriodInEveryLocale(t *testing.T) {
	for _, code := range locale.Supported {
		t.Run(code, func(t *testing.T) {
			name, err := rentalLineItemName(code, "Episode 1", 1200)
			if err != nil {
				t.Fatalf("rentalLineItemName: %v", err)
			}
			if !strings.Contains(name, "Episode 1") {
				t.Fatalf("rentalLineItemName = %q, which leaves out the title", name)
			}
			// The period is grouped the way the locale groups digits.
			if ungrouped := strings.NewReplacer(",", "", ".", "", "\u00a0", "").Replace(name); !strings.Contains(ungrouped, "1200") {
				t.Fatalf("rentalLineItemName = %q, which leaves out the period", name)
			}
		})
	}
}

func TestRentalLineItemNameAgreesWithTheCountInEnglish(t *testing.T) {
	for hours, want := range map[int32]string{
		1:  "Episode 1 (rental, 1 hour)",
		48: "Episode 1 (rental, 48 hours)",
	} {
		got, err := rentalLineItemName("en", "Episode 1", hours)
		if err != nil {
			t.Fatalf("rentalLineItemName(%d): %v", hours, err)
		}
		if got != want {
			t.Fatalf("rentalLineItemName(%d) = %q, want %q", hours, got, want)
		}
	}
}
