package adminapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentprovider/payjp"
	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/platformconfig"
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

// A tenant sells in the platform's default currency until it saves one its
// provider charges in, and keeps that currency once a purchase has been
// recorded in it.
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

	if got := dbTenantCurrency(t, env, tenant); got != platformconfig.DefaultCurrency {
		t.Fatalf("currency on a platform with no settings = %q, want %q", got, platformconfig.DefaultCurrency)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO platform_config (singleton, default_locale, default_currency) VALUES (TRUE, 'en', 'EUR')
	`); err != nil {
		t.Fatalf("save the platform default currency: %v", err)
	}
	if got := dbTenantCurrency(t, env, tenant); got != "EUR" {
		t.Fatalf("currency before any settings = %q, want the platform's EUR", got)
	}

	settings, err := updateDBPaymentCurrency(env, tenant, stripe.ID, "")
	if err != nil {
		t.Fatalf("save Stripe naming no currency: %v", err)
	}
	if settings.Currency != "EUR" || settings.CurrencyLocked {
		t.Fatalf("settings currency = %q locked %v, want an unlocked EUR from the platform", settings.Currency, settings.CurrencyLocked)
	}
	if settings, err = updateDBPaymentCurrency(env, tenant, stripe.ID, "USD"); err != nil {
		t.Fatalf("save USD with Stripe: %v", err)
	}
	if settings.Currency != "USD" {
		t.Fatalf("settings currency = %q, want USD", settings.Currency)
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

// A price above zero is an amount of the currency it was entered in, so it is
// written only while the tenant still sells in that currency. A free episode
// is free in every currency.
func TestDBAPriceIsWrittenOnlyInTheCurrencyItWasEnteredIn(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA1", Title: "Series A"})
	episode := env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODE1", Title: "Chapter One", Price: 300})
	client := env.seriesClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	currency := dbTenantCurrency(t, env, tenant)
	other := "JPY"
	if currency == other {
		other = "EUR"
	}
	price := func(amount int32, in string) error {
		_, err := client.UpdateEpisodePricing(ctx, &publiraadminv1.UpdateEpisodePricingRequest{
			Tenant:    tenant.tenantContext(),
			EpisodeId: episode.ID.String(),
			Price:     amount,
			Currency:  in,
		})
		return err
	}

	if err := price(500, currency); err != nil {
		t.Fatalf("price in %s: %v", currency, err)
	}
	err := price(700, other)
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeFailedPrecondition || violatedField(t, connectErr) != "currency" {
		t.Fatalf("price in %s error = %v, want failed_precondition on currency", other, err)
	}
	if got := getDBEpisode(t, env, tenant, series.PublicID, episode.PublicID).Episode.Price; got != 500 {
		t.Fatalf("price after the refusal = %d, want 500", got)
	}
	if err := price(0, other); err != nil {
		t.Fatalf("free in %s: %v", other, err)
	}

	create := func(in string) error {
		_, err := client.CreateEpisode(ctx, &publiraadminv1.CreateEpisodeRequest{
			Tenant:   tenant.tenantContext(),
			SeriesId: series.ID.String(),
			Title:    "Chapter Two",
			Price:    100,
			Currency: in,
		})
		return err
	}
	if err := create(other); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("create priced in %s error = %v, want failed_precondition", other, err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM episodes WHERE series_id = $1", series.ID); got != 1 {
		t.Fatalf("episodes after the refused create = %d, want 1", got)
	}
	if err := create(currency); err != nil {
		t.Fatalf("create priced in %s: %v", currency, err)
	}
}

// A price checked against the tenant currency waits for a change of that
// currency in progress, and is then checked against the currency the change
// made, rather than written in the one it read before the change committed.
func TestDBAPriceCheckWaitsForACurrencyChange(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	ctx := context.Background()
	before := dbTenantCurrency(t, env, tenant)
	after := "EUR"
	if before == after {
		after = "GBP"
	}

	change, err := env.PG.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the change: %v", err)
	}
	defer change.Rollback() //nolint:errcheck
	if err := dbmodels.New(change).LockTenantCurrency(ctx, tenant.Tenant.ID); err != nil {
		t.Fatalf("hold the currency: %v", err)
	}
	if _, err := change.ExecContext(ctx, `
		INSERT INTO platform_config (singleton, default_locale, default_currency) VALUES (TRUE, 'en', $1)
		ON CONFLICT (singleton) DO UPDATE SET default_currency = EXCLUDED.default_currency
	`, after); err != nil {
		t.Fatalf("change the default currency: %v", err)
	}

	checked := make(chan error, 1)
	go func() {
		write, err := env.PG.DB.BeginTx(ctx, nil)
		if err != nil {
			checked <- err
			return
		}
		defer write.Rollback() //nolint:errcheck
		checked <- paymentsettings.CheckPriceCurrency(ctx, dbmodels.New(write), tenant.Tenant.ID, before)
	}()
	select {
	case err := <-checked:
		t.Fatalf("the check returned %v while the change was in progress, want it to wait", err)
	case <-time.After(300 * time.Millisecond):
	}
	if err := change.Commit(); err != nil {
		t.Fatalf("commit the change: %v", err)
	}
	select {
	case err := <-checked:
		if !errors.Is(err, paymentsettings.ErrPriceCurrencyChanged) {
			t.Fatalf("check after the change = %v, want ErrPriceCurrencyChanged", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the check never returned after the change committed")
	}
}
