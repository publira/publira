package stripe

import (
	"net/url"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider"
)

func TestPurchaseMetadataRoundTrips(t *testing.T) {
	purchase := paymentprovider.Purchase{
		TenantID:           uuid.New(),
		ReaderID:           uuid.New(),
		EpisodeID:          uuid.New(),
		Price:              500,
		ReadingPeriodHours: 72,
	}
	got, err := parsePurchaseMetadata(purchaseMetadata(purchase))
	if err != nil {
		t.Fatalf("parsePurchaseMetadata: %v", err)
	}
	if got != purchase {
		t.Fatalf("purchase = %+v, want %+v", got, purchase)
	}
}

func TestPurchaseMetadataLeavesOutAReadingPeriodThatDoesNotExpire(t *testing.T) {
	metadata := purchaseMetadata(paymentprovider.Purchase{Price: 500})
	if _, ok := metadata[MetadataReadingPeriodHours]; ok {
		t.Fatalf("metadata = %v, want no reading period", metadata)
	}
}

func TestParsePurchaseMetadataRejectsInvalidPrice(t *testing.T) {
	_, err := parsePurchaseMetadata(map[string]string{
		MetadataTenantID:  uuid.New().String(),
		MetadataUserID:    uuid.New().String(),
		MetadataEpisodeID: uuid.New().String(),
		MetadataPrice:     "0",
	})
	if err == nil {
		t.Fatal("parsePurchaseMetadata() error = nil, want invalid price error")
	}
}

func TestWithSessionIDHasStripeNameTheSession(t *testing.T) {
	got, err := withSessionID("https://store.example/series/S/episodes/E?checkout=success")
	if err != nil {
		t.Fatalf("withSessionID: %v", err)
	}
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("checkout") != "success" || parsed.Query().Get("session_id") != "{CHECKOUT_SESSION_ID}" {
		t.Fatalf("query = %q", parsed.RawQuery)
	}
}
