package publicapi

import (
	"net/url"
	"testing"

	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v82"
)

func TestStripePurchaseMetadata(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	episodeID := uuid.New()
	session := &stripe.CheckoutSession{Metadata: map[string]string{
		stripeMetadataTenantID:           tenantID.String(),
		stripeMetadataUserID:             userID.String(),
		stripeMetadataEpisodeID:          episodeID.String(),
		stripeMetadataPrice:              "500",
		stripeMetadataReadingPeriodHours: "72",
	}}

	gotTenantID, gotUserID, gotEpisodeID, price, readingPeriodHours, err := stripePurchaseMetadata(session)
	if err != nil {
		t.Fatalf("stripePurchaseMetadata() error = %v", err)
	}
	if gotTenantID != tenantID || gotUserID != userID || gotEpisodeID != episodeID {
		t.Fatalf("metadata IDs = (%s, %s, %s), want (%s, %s, %s)", gotTenantID, gotUserID, gotEpisodeID, tenantID, userID, episodeID)
	}
	if price != 500 || readingPeriodHours != 72 {
		t.Fatalf("price/hours = (%d, %d), want (500, 72)", price, readingPeriodHours)
	}
}

func TestStripePurchaseMetadataRejectsInvalidPrice(t *testing.T) {
	_, _, _, _, _, err := stripePurchaseMetadata(&stripe.CheckoutSession{Metadata: map[string]string{
		stripeMetadataTenantID:  uuid.New().String(),
		stripeMetadataUserID:    uuid.New().String(),
		stripeMetadataEpisodeID: uuid.New().String(),
		stripeMetadataPrice:     "0",
	}})
	if err == nil {
		t.Fatal("stripePurchaseMetadata() error = nil, want invalid price error")
	}
}

func TestPurchaseReturnURL(t *testing.T) {
	base, err := url.Parse("https://host.example/store")
	if err != nil {
		t.Fatal(err)
	}
	got, err := url.Parse(purchaseReturnURL(base, "tenant", "series", "episode", "success"))
	if err != nil {
		t.Fatal(err)
	}
	if got.Path != "/store/tenant/series/series/episodes/episode" {
		t.Fatalf("path = %q", got.Path)
	}
	if got.Query().Get("checkout") != "success" || got.Query().Get("session_id") != "{CHECKOUT_SESSION_ID}" {
		t.Fatalf("query = %q", got.RawQuery)
	}
}
