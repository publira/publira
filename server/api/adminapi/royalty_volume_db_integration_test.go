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

// volumeRoyaltyFixture is a royalty fixture whose series also sells a volume
// of three episodes for 600: the fixture's episode at 500, a second at 300,
// and a free third. Spread in proportion to their prices, the first accounts
// for 375 of a sale of the volume and the second for 225. An Artist is
// credited on the first and the third, and an Original Author on the second.
type volumeRoyaltyFixture struct {
	royaltyFixture
	volume testutil.Volume
}

var (
	volumeArtistCredit = [3]string{"Artist Person", "Artist", "Episode 1"}
	volumeAuthorCredit = [3]string{"Author Person", "Original Author", "Episode 2"}
)

func (e *adminDBEnv) seedVolumeRoyaltyFixture(t *testing.T, prefix string) volumeRoyaltyFixture {
	t.Helper()

	f := e.seedRoyaltyFixture(t, prefix)
	second := e.PG.SeedEpisode(t, f.admin.Tenant.ID, f.series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EPISODE2",
		Title:    "Episode 2",
		Price:    300,
		Status:   testutil.EpisodeStatusPublished,
	})
	free := e.PG.SeedEpisode(t, f.admin.Tenant.ID, f.series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EPISODE3",
		Title:    "Episode 3",
		Status:   testutil.EpisodeStatusPublished,
	})
	volume := e.PG.SeedVolume(t, f.admin.Tenant.ID, f.series.ID, testutil.VolumeSeed{
		Price:      600,
		Published:  true,
		EpisodeIDs: []uuid.UUID{f.episode.ID, second.ID, free.ID},
	})
	artist := e.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: prefix + "ARTIST01", Name: "Artist Person"})
	author := e.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: prefix + "AUTHOR01", Name: "Author Person"})
	e.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, artist.ID, "Artist", "series", 5000)
	e.creditEpisode(t, f.admin.Tenant.ID, second.ID, author.ID, "Original Author", "episode", 2000)
	e.creditEpisode(t, f.admin.Tenant.ID, free.ID, artist.ID, "Artist", "series", 5000)
	return volumeRoyaltyFixture{royaltyFixture: f, volume: volume}
}

// seedVolumeSale records a sale of the fixture's volume as the payment
// notification does: the purchase, then what each of its episodes accounts
// for.
func (e *adminDBEnv) seedVolumeSale(t *testing.T, f volumeRoyaltyFixture, sale royaltySale) uuid.UUID {
	t.Helper()

	ctx := context.Background()
	id := uuid.Must(uuid.NewV7())
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, volume_id, price_at_purchase, purchased_at, refunded_amount, currency)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, id, f.admin.Tenant.ID, f.reader.ID, f.volume.ID, sale.price, sale.purchasedAt, sale.refundedAmount, e.PG.TenantCurrency(t, f.admin.Tenant.ID)); err != nil {
		t.Fatalf("insert sale of volume %s: %v", f.volume.ID, err)
	}
	if err := dbmodels.New(e.PG.DB).CreateVolumePurchaseEpisodes(ctx, dbmodels.CreateVolumePurchaseEpisodesParams{
		TenantID:   f.admin.Tenant.ID,
		PurchaseID: id,
	}); err != nil {
		t.Fatalf("record the episodes of the sale of volume %s: %v", f.volume.ID, err)
	}
	return id
}

// A sale of a volume is a sale of each priced episode in it, at the part of
// the price it accounts for, beside the sales of the episode on its own. A
// free episode in the volume accounts for none of it and is credited with
// nothing. What the sale credits was fixed when it was recorded: an episode
// repriced, or one added to the volume, before the close changes nothing.
func TestDBAdminVolumeSalePaysTheCreditsOfEachEpisodeTheirPart(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedVolumeRoyaltyFixture(t, "RVS")

	env.seedVolumeSale(t, f, royaltySale{price: 600, purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})
	env.seedSale(t, f.royaltyFixture, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 11, 12, 0, 0)})

	added := env.PG.SeedEpisode(t, f.admin.Tenant.ID, f.series.ID, testutil.EpisodeSeed{
		PublicID: "RVSEPISODE4",
		Title:    "Episode 4",
		Price:    400,
		Status:   testutil.EpisodeStatusPublished,
	})
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO volume_episodes (tenant_id, volume_id, episode_id, "position") VALUES ($1, $2, $3, 3)
	`, f.admin.Tenant.ID, f.volume.ID, added.ID); err != nil {
		t.Fatalf("add an episode to the volume: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "UPDATE episode_listings SET price = 100 WHERE episode_id = $1", f.episode.ID); err != nil {
		t.Fatalf("reprice the first episode: %v", err)
	}

	want := []expectedRoyaltyLine{
		{volumeArtistCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 2, gross: 875, shareBps: 5000, payout: 437}}},
		{volumeAuthorCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 225, shareBps: 2000, payout: 45}}},
	}
	preview := env.previewRoyalties(t, f.admin, "2026-01")
	assertRoyaltyLines(t, "January's preview", preview.Lines, want)
	assertRoyaltyTotals(t, "January's preview", preview.Totals, 1100, 0, 0, 482)

	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January", january.Totals, 1100, 0, 0, 482)
	assertRoyaltyLines(t, "January", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-01"}).Lines, want)
}

// A refund of part of a volume recorded before its month closes is that
// month's own, divided over the episodes in proportion to their parts and
// rounded down for each. The totals keep the refund as it was paid back.
func TestDBAdminPartialRefundOfAVolumeIsDividedOverItsEpisodes(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedVolumeRoyaltyFixture(t, "RVP")

	env.seedVolumeSale(t, f, royaltySale{
		price:          600,
		purchasedAt:    inRoyaltyZone(2026, time.January, 10, 12, 0, 0),
		refundedAmount: sql.NullInt32{Int32: 100, Valid: true},
	})

	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January", january.Totals, 600, 100, 0, 193)
	assertRoyaltyLines(t, "January", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-01"}).Lines, []expectedRoyaltyLine{
		{volumeArtistCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 375, refunded: 62, shareBps: 5000, payout: 156}}},
		{volumeAuthorCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 225, refunded: 37, shareBps: 2000, payout: 37}}},
	})
}

// A refund of a volume after its month was closed is taken back from the
// line of each episode in it, by the episode's part, and so is the sale once
// a dispute of it is lost. Together the statements pay nothing for the sale.
func TestDBAdminRefundOfAVolumeAfterCloseIsTakenBackFromEachEpisode(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedVolumeRoyaltyFixture(t, "RVR")

	sale := env.seedVolumeSale(t, f, royaltySale{price: 600, purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})
	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January", january.Totals, 600, 0, 0, 232)

	env.refundSale(t, sale, 100)
	want := []expectedRoyaltyLine{
		{volumeArtistCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: 0, gross: 0, refunded: 62, shareBps: 5000, payout: -31}}},
		{volumeAuthorCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: 0, gross: 0, refunded: 37, shareBps: 2000, payout: -8}}},
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
		{volumeArtistCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: -1, gross: -375, refunded: -62, shareBps: 5000, payout: -156}}},
		{volumeAuthorCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: -1, gross: -225, refunded: -37, shareBps: 2000, payout: -37}}},
	})

	if paid := january.Totals.Payout + february.Totals.Payout + march.Totals.Payout; paid != 0 {
		t.Fatalf("the sale pays %d over three statements, want 0", paid)
	}
	april := env.closeRoyalties(t, f.admin, "2026-04")
	assertRoyaltyTotals(t, "April", april.Totals, 0, 0, 0, 0)
}
