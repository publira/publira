package adminapi

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seriesBundleRoyaltyFixture is a royalty fixture whose series sells its rest
// at a 25% bundle discount: the fixture's episode at 500 and a second at 300,
// together 600, of which the first accounts for 375 and the second for 225.
// An Artist is credited on the first, and an Original Author on the second.
type seriesBundleRoyaltyFixture struct {
	royaltyFixture
	second testutil.Episode
}

var (
	bundleArtistCredit = [3]string{"Artist Person", "Artist", "Episode 1"}
	bundleAuthorCredit = [3]string{"Author Person", "Original Author", "Episode 2"}
)

func (e *adminDBEnv) seedSeriesBundleRoyaltyFixture(t *testing.T, prefix string) seriesBundleRoyaltyFixture {
	t.Helper()

	f := e.seedRoyaltyFixture(t, prefix)
	second := e.PG.SeedEpisode(t, f.admin.Tenant.ID, f.series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EPISODE2",
		Title:    "Episode 2",
		Price:    300,
		Status:   testutil.EpisodeStatusPublished,
	})
	artist := e.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: prefix + "ARTIST01", Name: "Artist Person"})
	author := e.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: prefix + "AUTHOR01", Name: "Author Person"})
	e.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, artist.ID, "Artist", "series", 5000)
	e.creditEpisode(t, f.admin.Tenant.ID, second.ID, author.ID, "Original Author", "episode", 2000)
	return seriesBundleRoyaltyFixture{royaltyFixture: f, second: second}
}

// seedSeriesBundleSale records a sale of the rest of the fixture's series as
// a checkout and its payment notification do: the bundle with each episode's
// part of its price when the checkout starts, then the purchase of what the
// reader paid for it.
func (e *adminDBEnv) seedSeriesBundleSale(t *testing.T, f seriesBundleRoyaltyFixture, sale royaltySale) uuid.UUID {
	t.Helper()

	ctx := context.Background()
	bundleID, err := dbmodels.New(e.PG.DB).CreateSeriesBundle(ctx, dbmodels.CreateSeriesBundleParams{
		ID:                 uuid.Must(uuid.NewV7()),
		TenantID:           f.admin.Tenant.ID,
		SeriesID:           f.series.ID,
		UserID:             f.reader.ID,
		IdempotencyKey:     uuid.NewString(),
		DiscountPercent:    sql.NullInt32{Int32: 25, Valid: true},
		Price:              600,
		ListPrices:         []int32{500, 300},
		Prices:             []int32{375, 225},
		ReadingPeriodHours: []int32{0, 0},
		EpisodeIds:         []uuid.UUID{f.episode.ID, f.second.ID},
	})
	if err != nil {
		t.Fatalf("record the bundle of series %s: %v", f.series.ID, err)
	}
	id := uuid.Must(uuid.NewV7())
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, series_bundle_id, price_at_purchase, purchased_at, refunded_amount, currency)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, id, f.admin.Tenant.ID, f.reader.ID, bundleID, sale.price, sale.purchasedAt, sale.refundedAmount, e.PG.TenantCurrency(t, f.admin.Tenant.ID)); err != nil {
		t.Fatalf("insert sale of series bundle %s: %v", bundleID, err)
	}
	return id
}

// A sale of the rest of a series is a sale of each episode in it, at the part
// of the price the bundle recorded for it, beside the sales of the episode on
// its own. The parts were fixed when the checkout started: an episode repriced,
// or the series' discount changed, before the close changes nothing.
func TestDBAdminSeriesBundleSalePaysTheCreditsOfEachEpisodeTheirPart(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedSeriesBundleRoyaltyFixture(t, "RBS")

	env.seedSeriesBundleSale(t, f, royaltySale{price: 600, purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})
	env.seedSale(t, f.royaltyFixture, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 11, 12, 0, 0)})

	if _, err := env.PG.DB.ExecContext(context.Background(), "UPDATE episode_listings SET price = 100 WHERE episode_id = $1", f.episode.ID); err != nil {
		t.Fatalf("reprice the first episode: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "UPDATE series_listings SET bundle_discount_percent = 50 WHERE series_id = $1", f.series.ID); err != nil {
		t.Fatalf("change the series' bundle discount: %v", err)
	}

	want := []expectedRoyaltyLine{
		{bundleArtistCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 2, gross: 875, shareBps: 5000, payout: 437}}},
		{bundleAuthorCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 225, shareBps: 2000, payout: 45}}},
	}
	preview := env.previewRoyalties(t, f.admin, "2026-01")
	assertRoyaltyLines(t, "January's preview", preview.Lines, want)
	assertRoyaltyTotals(t, "January's preview", preview.Totals, 1100, 0, 0, 482)

	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January", january.Totals, 1100, 0, 0, 482)
	assertRoyaltyLines(t, "January", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-01"}).Lines, want)
}

// A promotion code that makes the reader pay less than the bundle's price
// takes the same proportion off each episode's part, and the parts still add
// up to what was paid.
func TestDBAdminSeriesBundleSaleBelowItsPriceSpreadsThePaymentOverTheParts(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedSeriesBundleRoyaltyFixture(t, "RBC")

	env.seedSeriesBundleSale(t, f, royaltySale{price: 481, purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})

	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January", january.Totals, 481, 0, 0, 186)
	assertRoyaltyLines(t, "January", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-01"}).Lines, []expectedRoyaltyLine{
		{bundleArtistCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 300, shareBps: 5000, payout: 150}}},
		{bundleAuthorCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 181, shareBps: 2000, payout: 36}}},
	})
}

// A refund of part of the rest of a series recorded before its month closes
// is that month's own, divided over the episodes in proportion to their parts
// and rounded down for each. The totals keep the refund as it was paid back.
func TestDBAdminPartialRefundOfASeriesBundleIsDividedOverItsEpisodes(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedSeriesBundleRoyaltyFixture(t, "RBP")

	env.seedSeriesBundleSale(t, f, royaltySale{
		price:          600,
		purchasedAt:    inRoyaltyZone(2026, time.January, 10, 12, 0, 0),
		refundedAmount: sql.NullInt32{Int32: 100, Valid: true},
	})

	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January", january.Totals, 600, 100, 0, 193)
	assertRoyaltyLines(t, "January", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-01"}).Lines, []expectedRoyaltyLine{
		{bundleArtistCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 375, refunded: 62, shareBps: 5000, payout: 156}}},
		{bundleAuthorCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 225, refunded: 37, shareBps: 2000, payout: 37}}},
	})
}

// A refund of the rest of a series after its month was closed is taken back
// from the line of each episode in it, by the episode's part, and so is the
// sale once a dispute of it is lost. Together the statements pay nothing for
// the sale.
func TestDBAdminRefundOfASeriesBundleAfterCloseIsTakenBackFromEachEpisode(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedSeriesBundleRoyaltyFixture(t, "RBR")

	sale := env.seedSeriesBundleSale(t, f, royaltySale{price: 600, purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})
	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January", january.Totals, 600, 0, 0, 232)

	env.refundSale(t, sale, 100)
	want := []expectedRoyaltyLine{
		{bundleArtistCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: 0, gross: 0, refunded: 62, shareBps: 5000, payout: -31}}},
		{bundleAuthorCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: 0, gross: 0, refunded: 37, shareBps: 2000, payout: -8}}},
	}
	preview := env.previewRoyalties(t, f.admin, "2026-02")
	assertRoyaltyLines(t, "February's preview", preview.Lines, want)
	assertRoyaltyTotals(t, "February's preview", preview.Totals, 0, 0, -100, -39)
	february := env.closeRoyalties(t, f.admin, "2026-02")
	assertRoyaltyTotals(t, "February", february.Totals, 0, 0, -100, -39)
	assertRoyaltyLines(t, "February", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-02"}).Lines, want)

	env.loseDispute(t, sale)
	march := env.closeRoyalties(t, f.admin, "2026-03")
	assertRoyaltyTotals(t, "March", march.Totals, 0, 0, -500, -193)
	assertRoyaltyLines(t, "March", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-03"}).Lines, []expectedRoyaltyLine{
		{bundleArtistCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: -1, gross: -375, refunded: -62, shareBps: 5000, payout: -156}}},
		{bundleAuthorCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: -1, gross: -225, refunded: -37, shareBps: 2000, payout: -37}}},
	})

	if paid := january.Totals.Payout + february.Totals.Payout + march.Totals.Payout; paid != 0 {
		t.Fatalf("the sale pays %d over three statements, want 0", paid)
	}
	april := env.closeRoyalties(t, f.admin, "2026-04")
	assertRoyaltyTotals(t, "April", april.Totals, 0, 0, 0, 0)
}
