package adminapi

import (
	"database/sql"
	"testing"
	"time"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A sale a promotion code discounted is credited at its list price, the
// tenant having chosen the promotion, and a sale a code took the whole price
// off is credited all the same. A refund takes back the share of the list
// price the reader was refunded of what they paid, before the close and after
// it, and one in full drops the sale, so that over every statement the
// refunded sale pays its creator nothing.
func TestDBAdminADiscountedSaleIsPaidOnItsListPrice(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYC")
	creator := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYCCREATOR01", Name: "Creator"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, creator.ID, "Artist", "series", 5000)
	credit := [3]string{"Creator", "Artist", "Episode 1"}
	listPrice := func(price int32) sql.NullInt32 { return sql.NullInt32{Int32: price, Valid: true} }

	discounted := env.seedSale(t, f, f.episode.ID, royaltySale{price: 800, listPrice: listPrice(1000), purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})
	env.seedSale(t, f, f.episode.ID, royaltySale{
		price:          400,
		listPrice:      listPrice(500),
		purchasedAt:    inRoyaltyZone(2026, time.January, 11, 12, 0, 0),
		refundedAmount: sql.NullInt32{Int32: 200, Valid: true},
	})
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 0, listPrice: listPrice(500), purchasedAt: inRoyaltyZone(2026, time.January, 12, 12, 0, 0)})
	refundedAt := inRoyaltyZone(2026, time.January, 14, 12, 0, 0)
	env.seedSale(t, f, f.episode.ID, royaltySale{
		price:          400,
		listPrice:      listPrice(500),
		purchasedAt:    inRoyaltyZone(2026, time.January, 13, 12, 0, 0),
		refundedAmount: sql.NullInt32{Int32: 400, Valid: true},
		refundedAt:     sql.NullTime{Time: refundedAt, Valid: true},
	})

	// The three sales that stand are credited at 1000, 500, and 500; the half
	// refund of the second takes back half of its 500.
	want := []expectedRoyaltyLine{
		{credit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 3, gross: 2000, refunded: 250, shareBps: 5000, payout: 875}}},
	}
	preview := env.previewRoyalties(t, f.admin, "2026-01")
	assertRoyaltyLines(t, "January's preview", preview.Lines, want)
	assertRoyaltyTotals(t, "January's preview", preview.Totals, 2000, 250, 0, 875)
	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January", january.Totals, 2000, 250, 0, 875)

	env.refundSale(t, discounted, 400)
	february := env.closeRoyalties(t, f.admin, "2026-02")
	assertRoyaltyLines(t, "February", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-02"}).Lines, []expectedRoyaltyLine{
		{credit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: 0, gross: 0, refunded: 500, shareBps: 5000, payout: -250}}},
	})
	assertRoyaltyTotals(t, "February", february.Totals, 0, 0, -500, -250)

	env.refundSale(t, discounted, 800)
	march := env.closeRoyalties(t, f.admin, "2026-03")
	assertRoyaltyLines(t, "March", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-03"}).Lines, []expectedRoyaltyLine{
		{credit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: -1, gross: -1000, refunded: -500, shareBps: 5000, payout: -250}}},
	})
	assertRoyaltyTotals(t, "March", march.Totals, 0, 0, -500, -250)
}

// A sale recorded before list prices were, or by the previous release, has no
// list price and is credited at what was paid, as it always was.
func TestDBAdminASaleWithoutAListPriceIsPaidOnWhatWasPaid(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYN")
	creator := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYNCREATOR01", Name: "Creator"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, creator.ID, "Artist", "series", 5000)

	env.seedSale(t, f, f.episode.ID, royaltySale{
		price:          400,
		purchasedAt:    inRoyaltyZone(2026, time.January, 10, 12, 0, 0),
		refundedAmount: sql.NullInt32{Int32: 100, Valid: true},
	})
	preview := env.previewRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January's preview", preview.Totals, 400, 100, 0, 150)
}
