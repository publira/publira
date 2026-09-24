package publicapi

import (
	"net/url"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
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

func TestTenantSiteURL(t *testing.T) {
	got, err := tenantSiteURL(dbmodels.Tenant{Domain: "https://store.example/"})
	if err != nil {
		t.Fatalf("tenantSiteURL: %v", err)
	}
	if got.String() != "https://store.example" {
		t.Fatalf("tenantSiteURL = %q, want https://store.example", got.String())
	}
	if _, err := tenantSiteURL(dbmodels.Tenant{}); err == nil {
		t.Fatal("tenantSiteURL empty domain error = nil")
	}
}
