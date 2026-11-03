package adminapi

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Tips are saved with the rest of the purchase settings, in ascending order,
// and audited apart from them. A save that carries no tips, which is what a
// console that predates them sends, leaves them as they are.
func TestDBTenantTipSettingsAreStoredAndAuditedApart(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TIPSETTN", "tip-settings.example.com", "Tip settings", "TIPSETAD", "admin@tip-settings.example.com")
	client := env.tenantSettingsClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	auditCount := func(action string) int {
		t.Helper()
		return env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2", tenant.Tenant.ID, action)
	}

	initial, err := client.GetTenantPurchaseSettings(ctx, &publiraadminv1.GetTenantPurchaseSettingsRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("GetTenantPurchaseSettings: %v", err)
	}
	if tips := initial.Settings.GetTips(); tips == nil || tips.Enabled || len(tips.Amounts) != 0 {
		t.Fatalf("initial tips = %v, want off with no amounts", tips)
	}

	saved := updateDBTenantPurchaseSettings(t, env, tenant, &publiraadminv1.TenantPurchaseSettings{
		Tips: &publiraadminv1.TenantTipSettings{Enabled: true, Amounts: []int32{1000, 100, 300}},
	})
	if !saved.Tips.Enabled || !slices.Equal(saved.Tips.Amounts, []int32{100, 300, 1000}) {
		t.Fatalf("saved tips = %v, want on at 100, 300, and 1000", saved.Tips)
	}
	if got, want := auditCount("tenant_tip_settings_updated"), 1; got != want {
		t.Fatalf("tip settings audit entries = %d, want %d", got, want)
	}
	if got := env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'tenant_tip_settings_updated' AND target_type = 'tenant_tip_settings'", tenant.Tenant.ID); got != 1 {
		t.Fatalf("tip settings audit entries on their own target = %d, want 1", got)
	}
	if got := auditCount("tenant_purchase_settings_updated"); got != 0 {
		t.Fatalf("purchase settings audit entries after a save of tips alone = %d, want 0", got)
	}

	// The same amounts in another order are no change.
	updateDBTenantPurchaseSettings(t, env, tenant, &publiraadminv1.TenantPurchaseSettings{
		Tips: &publiraadminv1.TenantTipSettings{Enabled: true, Amounts: []int32{300, 1000, 100}},
	})
	if got := auditCount("tenant_tip_settings_updated"); got != 1 {
		t.Fatalf("tip settings audit entries after saving the same amounts = %d, want 1", got)
	}

	kept := updateDBTenantPurchaseSettings(t, env, tenant, &publiraadminv1.TenantPurchaseSettings{
		PurchaseAvailability: purchaseWeb,
	})
	if !kept.Tips.Enabled || !slices.Equal(kept.Tips.Amounts, []int32{100, 300, 1000}) {
		t.Fatalf("tips after a save without them = %v, want them as they were", kept.Tips)
	}
	if got := auditCount("tenant_purchase_settings_updated"); got != 1 {
		t.Fatalf("purchase settings audit entries = %d, want 1", got)
	}

	for _, invalid := range []*publiraadminv1.TenantTipSettings{
		{Enabled: true},
		{Enabled: true, Amounts: []int32{100, 200, 300, 400, 500, 600, 700}},
		{Enabled: true, Amounts: []int32{100, 100}},
		{Enabled: true, Amounts: []int32{0, 100}},
		{Enabled: false, Amounts: []int32{-100}},
	} {
		_, err := client.UpdateTenantPurchaseSettings(ctx, &publiraadminv1.UpdateTenantPurchaseSettingsRequest{
			Tenant:   tenant.tenantContext(),
			Settings: &publiraadminv1.TenantPurchaseSettings{PurchaseAvailability: purchaseWeb, Tips: invalid},
		})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("UpdateTenantPurchaseSettings(tips %v) = %v, want invalid_argument", invalid, err)
		}
	}

	off := updateDBTenantPurchaseSettings(t, env, tenant, &publiraadminv1.TenantPurchaseSettings{
		PurchaseAvailability: purchaseWeb,
		Tips:                 &publiraadminv1.TenantTipSettings{Amounts: []int32{300}},
	})
	if off.Tips.Enabled || !slices.Equal(off.Tips.Amounts, []int32{300}) {
		t.Fatalf("tips turned off = %v, want off keeping 300", off.Tips)
	}
}

// Each amount a tenant takes tips in is a store product of its own while tips
// are on, after the products of prices and before those of packs.
func TestDBListTenantStoreProductsNamesTheProductOfEveryTipAmount(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TIPPRDTN", "tip-products.example.com", "Tip products", "TIPPRDAD", "admin@tip-products.example.com")
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "TIPPRDSE", Title: "Series"})
	env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "TIPPRDEP", Title: "Episode", Price: 300, Status: testutil.EpisodeStatusPublished})

	updateDBTenantPurchaseSettings(t, env, tenant, &publiraadminv1.TenantPurchaseSettings{
		Tips: &publiraadminv1.TenantTipSettings{Enabled: true, Amounts: []int32{300, 100}},
	})
	got := listDBStoreProducts(t, env, tenant)
	ids := make([]string, 0, len(got))
	for _, product := range got {
		ids = append(ids, product.ProductId)
	}
	if !slices.Equal(ids, []string{"episode_300", "tip_100", "tip_300"}) {
		t.Fatalf("products = %v, want the episode's price and then each tip amount", ids)
	}
	if !got[1].Tip || got[1].Price != 100 || got[1].EpisodeCount != 0 || got[0].Tip {
		t.Fatalf("products = %v, want the tip products marked as tips", got)
	}

	updateDBTenantPurchaseSettings(t, env, tenant, &publiraadminv1.TenantPurchaseSettings{
		Tips: &publiraadminv1.TenantTipSettings{Amounts: []int32{100, 300}},
	})
	if got := listDBStoreProducts(t, env, tenant); len(got) != 1 || got[0].ProductId != "episode_300" {
		t.Fatalf("products with tips off = %v, want the episode's price alone", got)
	}
}

// The console names a tip as one, and refunds it through the provider as it
// refunds a sale.
func TestDBAdminPurchasesNameATipAndRefundIt(t *testing.T) {
	t.Parallel()

	f := newPurchaseFixture(t)
	tipID := f.seedPurchase(t, purchaseSeed{reader: f.alice, episode: f.episodeA, purchasedAt: time.Now().Add(-time.Hour), paymentID: "pi_tip"})
	if _, err := f.env.PG.DB.ExecContext(context.Background(), "UPDATE purchases SET kind = 'tip' WHERE id = $1", tipID); err != nil {
		t.Fatalf("make the purchase a tip: %v", err)
	}
	f.seedPurchase(t, purchaseSeed{reader: f.bob, episode: f.episodeA, purchasedAt: time.Now().Add(-2 * time.Hour)})

	listed := f.list(t, &publiraadminv1.ListPurchasesRequest{})
	kinds := map[string]publirattypesv1.PurchaseKind{}
	for _, purchase := range listed.Purchases {
		kinds[purchase.ReaderPublicId] = purchase.Kind
	}
	if kinds[f.alice.PublicID] != publirattypesv1.PurchaseKind_PURCHASE_KIND_TIP || kinds[f.bob.PublicID] != publirattypesv1.PurchaseKind_PURCHASE_KIND_PURCHASE {
		t.Fatalf("listed kinds = %v, want Alice's tip and Bob's purchase", kinds)
	}

	refunded, err := f.refund(tipID)
	if err != nil {
		t.Fatalf("RefundPurchase of a tip: %v", err)
	}
	if refunded.Kind != publirattypesv1.PurchaseKind_PURCHASE_KIND_TIP || refunded.RevokedAt == "" || refunded.Refundable {
		t.Fatalf("refunded tip = %+v, want a tip revoked and no longer refundable", refunded)
	}
	if refunds := f.stripe.Refunds(); len(refunds) != 1 || refunds[0].PaymentIntentID != "pi_tip" || refunds[0].Amount != 500 {
		t.Fatalf("refunds = %+v, want the whole tip on pi_tip", refunds)
	}
}
