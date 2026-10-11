package adminapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func updateDBPaymentCurrency(env *adminDBEnv, tenant adminDBTenant, provider, currency string) (*publiraadminv1.TenantPaymentSettings, error) {
	resp, err := env.paymentClient().UpdateTenantPaymentSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateTenantPaymentSettingsRequest{
		Tenant:   tenant.tenantContext(),
		Provider: provider,
		Currency: currency,
	})
	if err != nil {
		return nil, err
	}
	return resp.Settings, nil
}

func dbTenantCurrency(t *testing.T, env *adminDBEnv, tenant adminDBTenant) string {
	t.Helper()
	resp, err := env.authClient().GetTenant(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.AdminAuthServiceGetTenantRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	return resp.Tenant.Currency
}

// A tenant sells in JPY until it saves another currency its provider charges
// in, and keeps that currency once a purchase has been recorded in it.
func TestDBTenantCurrencyIsSavedUntilATenantHasAPurchase(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA1", Title: "Series A"})
	episode := env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "EP499A01",
		Title:       "Priced 4.99",
		Price:       499,
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Hour),
	})

	if got := dbTenantCurrency(t, env, tenant); got != "JPY" {
		t.Fatalf("currency before any settings = %q, want JPY", got)
	}

	settings, err := updateDBPaymentCurrency(env, tenant, stripe.ID, "USD")
	if err != nil {
		t.Fatalf("save USD with Stripe: %v", err)
	}
	if settings.Currency != "USD" || settings.CurrencyLocked {
		t.Fatalf("settings currency = %q locked %v, want an unlocked USD", settings.Currency, settings.CurrencyLocked)
	}
	if got := dbTenantCurrency(t, env, tenant); got != "USD" {
		t.Fatalf("currency = %q, want USD", got)
	}
	products := listDBStoreProducts(t, env, tenant)
	if len(products) != 1 || products[0].Price != 499 || products[0].Currency != "USD" {
		t.Fatalf("store products = %v, want one at 499 USD", products)
	}

	// PAY.JP charges in yen alone, so it cannot take over a tenant in USD.
	if _, err := updateDBPaymentCurrency(env, tenant, payjp.ID, ""); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("switch to PAY.JP in USD: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	reader := env.PG.SeedEndUser(t, tenant.Tenant.ID, "TAREADER1", "reader@tenant-a.example.com", "Reader")
	env.PG.SeedPurchase(t, tenant.Tenant.ID, reader.ID, episode.ID, 499)

	if _, err := updateDBPaymentCurrency(env, tenant, stripe.ID, "JPY"); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("change to JPY after a purchase: code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	settings, err = updateDBPaymentCurrency(env, tenant, stripe.ID, "")
	if err != nil {
		t.Fatalf("save naming no currency after a purchase: %v", err)
	}
	if settings.Currency != "USD" || !settings.CurrencyLocked {
		t.Fatalf("settings currency = %q locked %v, want USD locked", settings.Currency, settings.CurrencyLocked)
	}
}
