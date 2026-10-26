package adminapi

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/coinledger"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedPackSale records the purchase of a pack of coins at price, paid through
// Stripe at purchasedAt, and the grant of its coins to the fixture's reader.
// Returns the purchase and the grant.
func (e *adminDBEnv) seedPackSale(t *testing.T, f royaltyFixture, coins, price int32, purchasedAt time.Time) (uuid.UUID, uuid.UUID) {
	t.Helper()

	pack := e.PG.SeedCoinPack(t, f.admin.Tenant.ID, testutil.CoinPackSeed{Coins: coins, Price: price})
	purchaseID := uuid.Must(uuid.NewV7())
	grantID := uuid.Must(uuid.NewV7())
	ctx := context.Background()
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, coin_pack_id, price_at_purchase, purchased_at, currency, provider, provider_checkout_id, provider_payment_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'stripe', $8, $9)
	`, purchaseID, f.admin.Tenant.ID, f.reader.ID, pack.ID, price, purchasedAt, e.PG.TenantCurrency(t, f.admin.Tenant.ID),
		"cs_"+purchaseID.String(), "pi_"+purchaseID.String()); err != nil {
		t.Fatalf("insert the purchase of pack %s: %v", pack.ID, err)
	}
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO coin_grants (id, tenant_id, user_id, source, purchase_id, coins, remaining_coins, expires_at, granted_at)
		VALUES ($1, $2, $3, 'pack_purchase', $4, $5, $5, $6, $7)
	`, grantID, f.admin.Tenant.ID, f.reader.ID, purchaseID, coins, purchasedAt.AddDate(1, 0, 0), purchasedAt); err != nil {
		t.Fatalf("grant the coins of pack purchase %s: %v", purchaseID, err)
	}
	return purchaseID, grantID
}

// seedCoinSale records what CoinService.PayEpisodeWithCoins writes for a
// purchase of the episode with coins of one grant worth amount: the purchase
// at that price, the spend, and what it drew on the grant.
func (e *adminDBEnv) seedCoinSale(t *testing.T, f royaltyFixture, episodeID, grantID uuid.UUID, coins, amount int32, purchasedAt time.Time) uuid.UUID {
	t.Helper()

	purchaseID := uuid.Must(uuid.NewV7())
	spendID := uuid.Must(uuid.NewV7())
	ctx := context.Background()
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at, currency, provider, provider_checkout_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'coins', $8)
	`, purchaseID, f.admin.Tenant.ID, f.reader.ID, episodeID, amount, purchasedAt, e.PG.TenantCurrency(t, f.admin.Tenant.ID), spendID.String()); err != nil {
		t.Fatalf("insert the purchase of episode %s with coins: %v", episodeID, err)
	}
	if _, err := e.PG.DB.ExecContext(ctx, `
		UPDATE coin_grants SET remaining_coins = remaining_coins - $3 WHERE tenant_id = $1 AND id = $2
	`, f.admin.Tenant.ID, grantID, coins); err != nil {
		t.Fatalf("draw on coin grant %s: %v", grantID, err)
	}
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO coin_transactions (id, tenant_id, user_id, kind, coins, purchase_id, idempotency_key, created_at)
		VALUES ($1, $2, $3, 'spend', $4, $5, $6, $7)
	`, spendID, f.admin.Tenant.ID, f.reader.ID, coins, purchaseID, spendID.String(), purchasedAt); err != nil {
		t.Fatalf("insert the spend paying for purchase %s: %v", purchaseID, err)
	}
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO coin_spend_allocations (tenant_id, transaction_id, grant_id, coins, amount)
		VALUES ($1, $2, $3, $4, $5)
	`, f.admin.Tenant.ID, spendID, grantID, coins, amount); err != nil {
		t.Fatalf("insert what spend %s drew on grant %s: %v", spendID, grantID, err)
	}
	return purchaseID
}

// refundPack stands in for a refund in full of a pack purchase, which closes
// the coins it granted as the notification of the refund does.
func (e *adminDBEnv) refundPack(t *testing.T, f royaltyFixture, purchaseID uuid.UUID, price int32) {
	t.Helper()

	e.refundSale(t, purchaseID, price)
	ctx := context.Background()
	tx, err := e.PG.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the revocation of pack purchase %s: %v", purchaseID, err)
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := coinledger.RevokePackGrant(ctx, dbmodels.New(tx), f.admin.Tenant.ID, purchaseID); err != nil {
		t.Fatalf("revoke the coins of pack purchase %s: %v", purchaseID, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit the revocation of pack purchase %s: %v", purchaseID, err)
	}
}

// An episode paid with coins is a sale at what its coins were paid for, and a
// pack of coins is no sale: its money is counted once, as its coins are spent.
// Coins granted without a payment add a sale worth nothing. A refund of the
// pack after the close takes back from the next statement what its coins'
// sales paid, as a refund in full of a sale paid by card does: the reader
// keeps the episode, so the sale stays and its whole price is refunded.
func TestDBAdminRoyaltiesPayOnEpisodesSoldForCoins(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYC")
	card := env.PG.SeedEpisode(t, f.admin.Tenant.ID, f.series.ID, testutil.EpisodeSeed{
		PublicID: "RYCEPISODE2",
		Title:    "Episode 2",
		Price:    90,
		Status:   testutil.EpisodeStatusPublished,
	})
	artist := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYCARTIST001", Name: "Artist Person"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, artist.ID, "Artist", "series", 5000)
	env.creditEpisode(t, f.admin.Tenant.ID, card.ID, artist.ID, "Artist", "series", 5000)
	coinCredit := [3]string{"Artist Person", "Artist", "Episode 1"}
	cardCredit := [3]string{"Artist Person", "Artist", "Episode 2"}

	// 1,100 coins, 100 of them a bonus, for 1,000: 100 of them are worth 90.
	pack, packGrant := env.seedPackSale(t, f, 1100, 1000, inRoyaltyZone(2026, time.January, 3, 12, 0, 0))
	env.seedCoinSale(t, f, f.episode.ID, packGrant, 100, 90, inRoyaltyZone(2026, time.January, 10, 12, 0, 0))
	freeGrant := env.PG.SeedCoinGrant(t, f.admin.Tenant.ID, f.reader.ID, 50, time.Now().AddDate(1, 0, 0))
	env.seedCoinSale(t, f, f.episode.ID, freeGrant, 50, 0, inRoyaltyZone(2026, time.January, 12, 12, 0, 0))
	cardSale := env.seedSale(t, f, card.ID, royaltySale{price: 90, purchasedAt: inRoyaltyZone(2026, time.January, 11, 12, 0, 0)})

	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January", january.Totals, 180, 0, 0, 90)
	assertRoyaltyLines(t, "January", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-01"}).Lines, []expectedRoyaltyLine{
		{coinCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 2, gross: 90, shareBps: 5000, payout: 45}}},
		{cardCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 90, shareBps: 5000, payout: 45}}},
	})
	if got := env.countRoyaltyPurchases(t, f, pack); got != 0 {
		t.Fatalf("statements counting the pack purchase = %d, want none", got)
	}

	env.refundPack(t, f, pack, 1000)
	env.refundSale(t, cardSale, 90)

	want := []expectedRoyaltyLine{
		{coinCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: 0, gross: 0, refunded: 90, shareBps: 5000, payout: -45}}},
		{cardCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: -1, gross: -90, shareBps: 5000, payout: -45}}},
	}
	preview := env.previewRoyalties(t, f.admin, "2026-02")
	assertRoyaltyLines(t, "February's preview", preview.Lines, want)
	assertRoyaltyTotals(t, "February's preview", preview.Totals, 0, 0, -180, -90)
	february := env.closeRoyalties(t, f.admin, "2026-02")
	assertRoyaltyTotals(t, "February", february.Totals, 0, 0, -180, -90)
	assertRoyaltyLines(t, "February", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-02"}).Lines, want)

	march := env.closeRoyalties(t, f.admin, "2026-03")
	assertRoyaltyTotals(t, "March", march.Totals, 0, 0, 0, 0)
}

func (e *adminDBEnv) countRoyaltyPurchases(t *testing.T, f royaltyFixture, purchaseID uuid.UUID) int {
	t.Helper()

	var count int
	if err := e.PG.DB.QueryRowContext(context.Background(), `
		SELECT count(*) FROM royalty_statement_purchases WHERE tenant_id = $1 AND purchase_id = $2
	`, f.admin.Tenant.ID, purchaseID).Scan(&count); err != nil {
		t.Fatalf("count the statements of purchase %s: %v", purchaseID, err)
	}
	return count
}

// Revenue counts an episode paid with coins at what its coins were paid for,
// and a refund of their pack as money gone back on it, and leaves the pack's
// own purchase out, so the pack's money is counted once.
func TestDBAdminRevenueCountsEpisodesSoldForCoinsAndNotTheirPacks(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RVC")
	pack, packGrant := env.seedPackSale(t, f, 1100, 1000, inRoyaltyZone(2026, time.January, 10, 12, 0, 0))
	env.seedCoinSale(t, f, f.episode.ID, packGrant, 100, 90, inRoyaltyZone(2026, time.January, 11, 12, 0, 0))
	env.seedCoinSale(t, f, f.episode.ID, packGrant, 200, 181, inRoyaltyZone(2026, time.January, 12, 12, 0, 0))
	period := &publiraadminv1.GetRevenueStatsRequest{
		StartDate: "2026-01-10",
		EndDate:   "2026-01-12",
		GroupBy:   publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_DAY,
	}

	res := env.getRevenueStats(t, f.admin, period)
	assertRevenueRows(t, "by day", res.Rows, []expectedRevenueRow{
		{"2026-01-10", revenueFigures{0, 0, 0, 0}},
		{"2026-01-11", revenueFigures{1, 90, 0, 90}},
		{"2026-01-12", revenueFigures{1, 181, 0, 181}},
	})
	assertRevenueTotals(t, "by day", res.Totals, revenueFigures{2, 271, 0, 271})

	env.refundPack(t, f, pack, 1000)
	res = env.getRevenueStats(t, f.admin, period)
	assertRevenueTotals(t, "by day after the pack's refund", res.Totals, revenueFigures{2, 271, 271, 0})
}
