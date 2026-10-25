package adminapi

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/paymentprovider/stripe"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedCoinPackPurchase inserts a Stripe purchase of a pack of 1,000 coins and
// 100 bonus coins at 1,000, paid as paymentID, as the webhook records one.
func (f *purchaseFixture) seedCoinPackPurchase(t *testing.T, reader testutil.TenantUser, pack testutil.CoinPack, paymentID string) uuid.UUID {
	t.Helper()

	id := uuid.Must(uuid.NewV7())
	f.stripe.SetPaymentIntent(purchaseTestSecretKey, paymentID, 1000, "JPY")
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, coin_pack_id, price_at_purchase, currency, provider, provider_checkout_id, provider_payment_id)
		VALUES ($1, $2, $3, $4, 1000, 'JPY', $5, $6, $7)
	`, id, f.admin.Tenant.ID, reader.ID, pack.ID, stripe.ID, "cs_"+paymentID, paymentID); err != nil {
		t.Fatalf("insert a purchase of a pack: %v", err)
	}
	if _, err := f.env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO coin_pack_purchases (tenant_id, purchase_id, coins, bonus_coins)
		VALUES ($1, $2, 1000, 100)
	`, f.admin.Tenant.ID, id); err != nil {
		t.Fatalf("insert the pack the purchase bought: %v", err)
	}
	return id
}

// The console lists a purchase of a pack with the pack it bought and the
// tenant's word for its coins, outside every series, and refunds it as it
// refunds any purchase paid through the provider.
func TestDBListPurchasesNamesThePackAPurchaseBought(t *testing.T) {
	f := newPurchaseFixture(t)
	f.env.PG.SeedCoinSettings(t, f.admin.Tenant.ID, testutil.CoinSettingsSeed{Names: map[string]string{"en": "Points"}})
	pack := f.env.PG.SeedCoinPack(t, f.admin.Tenant.ID, testutil.CoinPackSeed{PublicID: "ADMINPACK001", Coins: 1000, BonusCoins: 100, Price: 1000})
	episodePurchase := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_episode"})
	packPurchase := f.seedCoinPackPurchase(t, f.alice, pack, "pi_pack")

	all := f.list(t, &publiraadminv1.ListPurchasesRequest{})
	assertPurchaseIDs(t, "purchases", all.Purchases, packPurchase, episodePurchase)
	bought := all.Purchases[0]
	if got := bought.GetCoinPack(); got.GetId() != pack.ID.String() || got.GetPublicId() != pack.PublicID || got.GetCoins() != 1000 || got.GetBonusCoins() != 100 {
		t.Fatalf("coin_pack = %+v, want the pack as it was bought", got)
	}
	if bought.GetCoinName() != "Points" || bought.GetSeriesPublicId() != "" || bought.GetSeriesTitle() != "" || bought.GetEpisodeId() != "" || bought.GetPrice() != 1000 {
		t.Fatalf("purchase = %+v, want a pack of Points at 1,000 in no series", bought)
	}
	if !bought.GetRefundable() {
		t.Fatal("a pack paid through the tenant's provider is not refundable")
	}
	if got := all.Purchases[1]; got.GetCoinPack() != nil || got.GetCoinName() != "" {
		t.Fatalf("episode purchase = %+v, want no pack and no coin name", got)
	}
	inSeries := f.list(t, &publiraadminv1.ListPurchasesRequest{SeriesPublicId: f.seriesA.PublicID})
	assertPurchaseIDs(t, "purchases in series A", inSeries.Purchases, episodePurchase)

	refunded, err := f.refund(packPurchase)
	if err != nil {
		t.Fatalf("RefundPurchase: %v", err)
	}
	if refunded.GetRevocationReason() != publiraadminv1.PurchaseRevocationReason_PURCHASE_REVOCATION_REASON_STAFF || refunded.GetCoinPack().GetId() != pack.ID.String() {
		t.Fatalf("refunded purchase = %+v, want the pack revoked by staff", refunded)
	}
	if refunds := f.stripe.Refunds(); len(refunds) != 1 || refunds[0].PaymentIntentID != "pi_pack" || refunds[0].Amount != 1000 {
		t.Fatalf("refunds = %+v, want 1,000 back on pi_pack", refunds)
	}
}

// Every pack the tenant has not retired is a store product after the
// products of its prices, on sale or not, named by its public ID.
func TestDBListTenantStoreProductsNamesTheProductOfEveryPack(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA1", Title: "Series A"})
	env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EP300A01", Title: "Published 300", Price: 300, Status: testutil.EpisodeStatusPublished})
	large := env.PG.SeedCoinPack(t, tenant.Tenant.ID, testutil.CoinPackSeed{PublicID: "PACKLARGE001", Coins: 1000, BonusCoins: 100, Price: 1000, SortOrder: 2})
	small := env.PG.SeedCoinPack(t, tenant.Tenant.ID, testutil.CoinPackSeed{PublicID: "PACKSMALL001", Coins: 100, Price: 100, SortOrder: 1, OffSale: true})
	retired := env.PG.SeedCoinPack(t, tenant.Tenant.ID, testutil.CoinPackSeed{PublicID: "PACKRETIRED1", SortOrder: 0, OffSale: true})
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE tenant_coin_packs SET retired_at = now() WHERE id = $1`, retired.ID); err != nil {
		t.Fatalf("retire a pack: %v", err)
	}

	got := listDBStoreProducts(t, env, tenant)
	if len(got) != 3 {
		t.Fatalf("products = %v, want the price's and the two packs'", got)
	}
	if got[0].GetProductId() != "episode_300" || got[0].GetCoinPack() != nil {
		t.Fatalf("products[0] = %v, want episode_300", got[0])
	}
	for i, want := range []struct {
		productID string
		pack      testutil.CoinPack
		price     int32
	}{
		{productID: "coins_PACKSMALL001", pack: small, price: 100},
		{productID: "coins_PACKLARGE001", pack: large, price: 1000},
	} {
		product := got[i+1]
		if product.GetProductId() != want.productID || product.GetPrice() != want.price || product.GetEpisodeCount() != 0 || product.GetCoinPack().GetId() != want.pack.ID.String() {
			t.Fatalf("products[%d] = %v, want %s at %d", i+1, product, want.productID, want.price)
		}
	}
}
