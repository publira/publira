package adminapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A series' bundle discount is written when a save states it, kept when a
// save leaves it out, cleared by an explicit zero, and refused outside 0 to
// 99.
func TestDBSeriesBundleDiscountIsWrittenWhenStated(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	_, err := client.CreateSeries(ctx, &publiraadminv1.CreateSeriesRequest{
		Tenant:                tenant.tenantContext(),
		Title:                 "Refused Story",
		BundleDiscountPercent: 100,
	})
	assertConnectCode(t, "CreateSeries at 100%", err, connect.CodeInvalidArgument)

	created, err := client.CreateSeries(ctx, &publiraadminv1.CreateSeriesRequest{
		Tenant:                tenant.tenantContext(),
		Title:                 "Bundled Story",
		BundleDiscountPercent: 15,
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	discount := func() int32 {
		t.Helper()
		got, err := client.GetSeries(ctx, &publiraadminv1.GetSeriesRequest{Tenant: tenant.tenantContext(), PublicId: created.Series.PublicId})
		if err != nil {
			t.Fatalf("GetSeries: %v", err)
		}
		return got.Series.BundleDiscountPercent
	}
	if got := discount(); got != 15 {
		t.Fatalf("created discount = %d, want 15", got)
	}
	update := func(percent *int32) error {
		_, err := client.UpdateSeries(ctx, &publiraadminv1.UpdateSeriesRequest{
			Tenant:                tenant.tenantContext(),
			SeriesId:              created.Series.Id,
			Title:                 "Bundled Story",
			BundleDiscountPercent: percent,
		})
		return err
	}
	if err := update(nil); err != nil {
		t.Fatalf("UpdateSeries leaving the discount out: %v", err)
	}
	if got := discount(); got != 15 {
		t.Fatalf("discount after a save that left it out = %d, want 15", got)
	}
	assertConnectCode(t, "UpdateSeries at -1%", update(new(int32(-1))), connect.CodeInvalidArgument)
	if err := update(new(int32(0))); err != nil {
		t.Fatalf("UpdateSeries clearing the discount: %v", err)
	}
	if got := discount(); got != 0 {
		t.Fatalf("discount after an explicit zero = %d, want 0", got)
	}
}

// The console names a purchase of the rest of a series by its bundle, and
// lists it under the series it was bought from.
func TestDBListPurchasesNamesTheSeriesBundleBought(t *testing.T) {
	t.Parallel()

	f := newPurchaseFixture(t)
	ctx := context.Background()

	bundleID := uuid.Must(uuid.NewV7())
	if _, err := f.env.PG.DB.ExecContext(ctx, `
		INSERT INTO series_bundles (id, tenant_id, series_id, user_id, idempotency_key, discount_percent, price)
		VALUES ($1, $2, $3, $4, 'series-remainder-checkout:console', 10, 900)
	`, bundleID, f.admin.Tenant.ID, f.seriesA.ID, f.alice.ID); err != nil {
		t.Fatalf("insert the bundle: %v", err)
	}
	if _, err := f.env.PG.DB.ExecContext(ctx, `
		INSERT INTO series_bundle_episodes (tenant_id, series_bundle_id, episode_id, "position", list_price, price)
		VALUES ($1, $2, $3, 0, 500, 450), ($1, $2, $4, 1, 500, 450)
	`, f.admin.Tenant.ID, bundleID, f.episodeA.ID, f.episodeC.ID); err != nil {
		t.Fatalf("insert the bundle's episodes: %v", err)
	}
	purchaseID := uuid.Must(uuid.NewV7())
	if _, err := f.env.PG.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, series_bundle_id, price_at_purchase, purchased_at, currency, provider, provider_checkout_id, provider_payment_id)
		VALUES ($1, $2, $3, $4, 900, $5, 'JPY', 'stripe', 'cs_bundle', 'pi_bundle')
	`, purchaseID, f.admin.Tenant.ID, f.alice.ID, bundleID, time.Now().Add(-time.Hour)); err != nil {
		t.Fatalf("insert the purchase: %v", err)
	}
	f.seedPurchase(t, purchaseSeed{reader: f.bob, episode: f.episodeB, purchasedAt: time.Now().Add(-2 * time.Hour), paymentID: "pi_other_series"})

	res := f.list(t, &publiraadminv1.ListPurchasesRequest{SeriesPublicId: f.seriesA.PublicID})
	if len(res.Purchases) != 1 {
		t.Fatalf("purchases of series A = %+v, want the bundle alone", res.Purchases)
	}
	bought := res.Purchases[0]
	if bought.Id != purchaseID.String() || bought.EpisodeId != "" || bought.VolumeId != "" || bought.SeriesPublicId != f.seriesA.PublicID {
		t.Fatalf("purchase = %+v, want the bundle of series A with no episode or volume", bought)
	}
	if bundle := bought.SeriesBundle; bundle.GetId() != bundleID.String() || bundle.GetEpisodeCount() != 2 || bundle.GetDiscountPercent() != 10 {
		t.Fatalf("series bundle = %+v, want 2 episodes at 10%% off", bundle)
	}
}
