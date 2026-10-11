package adminapi

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// refundSale stands in for a refund notification recorded on a purchase: the
// running total refunded, and the instant once it reaches the price paid.
func (e *adminDBEnv) refundSale(t *testing.T, purchaseID uuid.UUID, refunded int32) {
	t.Helper()

	if _, err := e.PG.DB.ExecContext(context.Background(), `
		UPDATE purchases
		SET refunded_amount = $2::integer,
			refunded_at = CASE WHEN $2::integer >= price_at_purchase THEN COALESCE(refunded_at, now()) END
		WHERE id = $1
	`, purchaseID, refunded); err != nil {
		t.Fatalf("refund %d of purchase %s: %v", refunded, purchaseID, err)
	}
}

// adjustedLineFigures is what a line says about money and the closed month it
// adjusts, which is empty for a line of the month's own sales.
type adjustedLineFigures struct {
	adjustedPeriod string
	royaltyLineFigures
}

// expectedRoyaltyLine is a line by its credit, as linesByCredit keys it.
type expectedRoyaltyLine struct {
	credit  [3]string
	figures adjustedLineFigures
}

func adjustedFiguresOf(line *publiraadminv1.RoyaltyStatementLine) adjustedLineFigures {
	return adjustedLineFigures{line.AdjustedPeriod, figuresOf(line)}
}

// assertRoyaltyLines compares lines in order, by credit and figures.
func assertRoyaltyLines(t *testing.T, label string, lines []*publiraadminv1.RoyaltyStatementLine, want []expectedRoyaltyLine) {
	t.Helper()

	if len(lines) != len(want) {
		t.Fatalf("%s has %d lines %+v, want %d", label, len(lines), lines, len(want))
	}
	for i, line := range lines {
		credit := [3]string{line.CreatorName, line.RoleName, line.EpisodeTitle}
		if line.LineNumber != int32(i+1) || credit != want[i].credit || adjustedFiguresOf(line) != want[i].figures {
			t.Fatalf("%s line %d = #%d %v %+v, want %v %+v", label, i+1,
				line.LineNumber, credit, adjustedFiguresOf(line), want[i].credit, want[i].figures)
		}
	}
}

func assertRoyaltyTotals(t *testing.T, label string, got *publiraadminv1.RoyaltyStatementTotals, gross, refunded, adjustment, payout int64) {
	t.Helper()

	if got.Gross != gross || got.Refunded != refunded || got.Adjustment != adjustment || got.Payout != payout {
		t.Fatalf("%s totals = %+v, want gross %d, refunded %d, adjustment %d, payout %d", label, got, gross, refunded, adjustment, payout)
	}
}

// A sale refunded in full after its month was closed is taken back from the
// next statement, from each credited creator exactly what the sale paid them,
// after that month's own lines. A refund recorded before a close is that
// month's own, and no later statement carries it again.
func TestDBAdminRefundAfterCloseIsTakenBackFromTheNextStatement(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYF")
	artist := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYFARTIST001", Name: "Artist Person"})
	author := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYFAUTHOR001", Name: "Author Person"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, artist.ID, "Artist", "series", 3000)
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, author.ID, "Original Author", "series", 2000)
	artistCredit := [3]string{"Artist Person", "Artist", "Episode 1"}
	authorCredit := [3]string{"Author Person", "Original Author", "Episode 1"}

	refunded := env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 11, 12, 0, 0)})
	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January", january.Totals, 1000, 0, 0, 500)

	env.refundSale(t, refunded, 500)
	env.seedSale(t, f, f.episode.ID, royaltySale{
		price:          500,
		purchasedAt:    inRoyaltyZone(2026, time.February, 5, 12, 0, 0),
		refundedAmount: sql.NullInt32{Int32: 100, Valid: true},
	})

	want := []expectedRoyaltyLine{
		{artistCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 500, refunded: 100, shareBps: 3000, payout: 120}}},
		{authorCredit, adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 500, refunded: 100, shareBps: 2000, payout: 80}}},
		{artistCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: -1, gross: -500, shareBps: 3000, payout: -150}}},
		{authorCredit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: -1, gross: -500, shareBps: 2000, payout: -100}}},
	}
	preview := env.previewRoyalties(t, f.admin, "2026-02")
	assertRoyaltyLines(t, "February's preview", preview.Lines, want)
	assertRoyaltyTotals(t, "February's preview", preview.Totals, 500, 100, -500, -50)

	february := env.closeRoyalties(t, f.admin, "2026-02")
	assertRoyaltyTotals(t, "February", february.Totals, 500, 100, -500, -50)
	closed := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-02"})
	assertRoyaltyLines(t, "February", closed.Lines, want)

	january = env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-01"}).Statement
	assertRoyaltyTotals(t, "January after the refund", january.Totals, 1000, 0, 0, 500)

	march := env.closeRoyalties(t, f.admin, "2026-03")
	assertRoyaltyTotals(t, "March", march.Totals, 0, 0, 0, 0)
	if lines := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-03"}).Lines; len(lines) != 0 {
		t.Fatalf("March lines = %+v, want none: every refund was carried by February", lines)
	}
}

// A partial refund after the close is carried as the refund it adds, and the
// rest of the refund, arriving after the next close, as the sale leaving
// altogether, net of the part already carried. Together the statements pay
// the creator nothing for the sale.
func TestDBAdminRefundCarriedInPartsIsTakenBackOnce(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYP")
	creator := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYPCREATOR01", Name: "Creator"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, creator.ID, "Artist", "series", 5000)
	credit := [3]string{"Creator", "Artist", "Episode 1"}

	sale := env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})
	january := env.closeRoyalties(t, f.admin, "2026-01")

	env.refundSale(t, sale, 200)
	february := env.closeRoyalties(t, f.admin, "2026-02")
	assertRoyaltyLines(t, "February", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-02"}).Lines, []expectedRoyaltyLine{
		{credit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: 0, gross: 0, refunded: 200, shareBps: 5000, payout: -100}}},
	})
	assertRoyaltyTotals(t, "February", february.Totals, 0, 0, -200, -100)

	env.refundSale(t, sale, 500)
	march := env.closeRoyalties(t, f.admin, "2026-03")
	assertRoyaltyLines(t, "March", env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-03"}).Lines, []expectedRoyaltyLine{
		{credit, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: -1, gross: -500, refunded: -200, shareBps: 5000, payout: -150}}},
	})
	assertRoyaltyTotals(t, "March", march.Totals, 0, 0, -300, -150)

	if paid := january.Totals.Payout + february.Totals.Payout + march.Totals.Payout; paid != 0 {
		t.Fatalf("the refunded sale pays %d over three statements, want 0", paid)
	}
	april := env.closeRoyalties(t, f.admin, "2026-04")
	assertRoyaltyTotals(t, "April", april.Totals, 0, 0, 0, 0)
}

// An adjustment takes back what the closed line paid, at the share it applied
// and under the credit it named, whatever the credits have become since: a
// share edited after the close, and a creator credited after it, change
// nothing about it.
func TestDBAdminRefundAfterCloseKeepsTheShareTheClosedMonthApplied(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYK")
	artist := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYKARTIST001", Name: "Artist Person"})
	guest := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYKGUEST0001", Name: "Guest"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, artist.ID, "Artist", "series", 5000)

	sale := env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})
	env.closeRoyalties(t, f.admin, "2026-01")

	if _, err := env.PG.DB.ExecContext(context.Background(), "UPDATE episode_creators SET share_bps = 1000 WHERE episode_id = $1", f.episode.ID); err != nil {
		t.Fatalf("edit the share: %v", err)
	}
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, guest.ID, "Original Author", "episode", 4000)
	if _, err := env.PG.DB.ExecContext(context.Background(), "UPDATE creators SET name = 'Renamed Artist' WHERE id = $1", artist.ID); err != nil {
		t.Fatalf("rename the artist: %v", err)
	}
	env.refundSale(t, sale, 500)

	want := []expectedRoyaltyLine{
		{[3]string{"Artist Person", "Artist", "Episode 1"}, adjustedLineFigures{"2026-01", royaltyLineFigures{saleCount: -1, gross: -500, shareBps: 5000, payout: -250}}},
	}
	assertRoyaltyLines(t, "February's preview", env.previewRoyalties(t, f.admin, "2026-02").Lines, want)
	february := env.closeRoyalties(t, f.admin, "2026-02")
	assertRoyaltyTotals(t, "February", february.Totals, 0, 0, -500, -250)
	lines := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-02"}).Lines
	assertRoyaltyLines(t, "February", lines, want)
	if lines[0].CreatorPublicId != "RYKARTIST001" {
		t.Fatalf("adjustment names creator %q, want RYKARTIST001", lines[0].CreatorPublicId)
	}

	export := env.exportRoyalties(t, f.admin, "2026-02")
	wantRow := "2026-02," + artist.ID.String() + ",Artist Person,"
	wantTail := ",-1,-500,0,50.00,-250," + env.PG.TenantCurrency(t, f.admin.Tenant.ID) + ",2026-01\r\n"
	if !containsRow(export, wantRow, wantTail) {
		t.Fatalf("csv =\n%q\nwant a row starting %q and ending %q", export, wantRow, wantTail)
	}
}

// A month closed before an earlier one carries none of that earlier month's
// refunds, and the earlier month, closed afterwards, counts its own refunds as
// they stand. Only the next statement of a later month carries what was
// refunded after either close.
func TestDBAdminRefundIsCarriedOnlyIntoALaterMonth(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RYL")
	creator := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RYLCREATOR01", Name: "Creator"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, creator.ID, "Artist", "series", 5000)

	february := env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.February, 10, 12, 0, 0)})
	env.closeRoyalties(t, f.admin, "2026-02")
	env.refundSale(t, february, 500)

	january := env.closeRoyalties(t, f.admin, "2026-01")
	assertRoyaltyTotals(t, "January closed after February", january.Totals, 0, 0, 0, 0)

	march := env.closeRoyalties(t, f.admin, "2026-03")
	assertRoyaltyTotals(t, "March", march.Totals, 0, 0, -500, -250)
}

func containsRow(csv, prefix, suffix string) bool {
	for row := range strings.Lines(csv) {
		if strings.HasPrefix(row, prefix) && strings.HasSuffix(row, suffix) {
			return true
		}
	}
	return false
}
