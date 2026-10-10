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

// A retry on the same terms reuses the provider's checkout, and a change of
// price or reading period starts another one.
func TestCheckoutIdempotencyKeyFollowsTheTerms(t *testing.T) {
	purchase := paymentprovider.Purchase{
		TenantID:           uuid.Must(uuid.NewV7()),
		ReaderID:           uuid.Must(uuid.NewV7()),
		EpisodeID:          uuid.Must(uuid.NewV7()),
		Price:              300,
		ReadingPeriodHours: 24,
	}
	key := checkoutIdempotencyKey(purchase)
	if again := checkoutIdempotencyKey(purchase); again != key {
		t.Fatalf("key of the same terms = %q, want %q", again, key)
	}
	repriced := purchase
	repriced.Price = 500
	extended := purchase
	extended.ReadingPeriodHours = 48
	for name, changed := range map[string]paymentprovider.Purchase{"price": repriced, "reading period": extended} {
		if got := checkoutIdempotencyKey(changed); got == key {
			t.Fatalf("key after a change of %s = %q, the key of the old terms", name, got)
		}
	}
}
