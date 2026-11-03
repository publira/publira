package adminapi

import (
	"bytes"
	"context"
	"encoding/csv"
	"testing"
	"time"

	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedTip records a tip to the Authors of the episode, as the webhook of a
// completed tip checkout does.
func (e *adminDBEnv) seedTip(t *testing.T, f royaltyFixture, amount int32, purchasedAt time.Time, isTest bool) uuid.UUID {
	t.Helper()

	id := uuid.Must(uuid.NewV7())
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, kind, price_at_purchase, purchased_at, currency, is_test, provider, provider_checkout_id, provider_payment_id)
		VALUES ($1, $2, $3, $4, 'tip', $5, $6, $7, $8, 'stripe', $9, $10)
	`, id, f.admin.Tenant.ID, f.reader.ID, f.episode.ID, amount, purchasedAt, e.PG.TenantCurrency(t, f.admin.Tenant.ID), isTest,
		"cs_tip_"+id.String(), "pi_tip_"+id.String()); err != nil {
		t.Fatalf("insert a tip of %d: %v", amount, err)
	}
	return id
}

// refundTipInFull stands in for a refund notification of the whole tip.
func (e *adminDBEnv) refundTipInFull(t *testing.T, purchaseID uuid.UUID) {
	t.Helper()

	if _, err := e.PG.DB.ExecContext(context.Background(), `
		UPDATE purchases SET refunded_amount = price_at_purchase, refunded_at = now(), revoked_at = now(), revocation_reason = 'refund' WHERE id = $1
	`, purchaseID); err != nil {
		t.Fatalf("refund tip %s: %v", purchaseID, err)
	}
}

type royaltyLineSummary struct {
	creator string
	source  publiraadminv1.RoyaltyLineSource
	sales   int32
	gross   int64
	payout  int64
}

func summarizeRoyaltyLines(lines []*publiraadminv1.RoyaltyStatementLine) []royaltyLineSummary {
	summaries := make([]royaltyLineSummary, 0, len(lines))
	for _, line := range lines {
		summaries = append(summaries, royaltyLineSummary{
			creator: line.CreatorPublicId,
			source:  line.Source,
			sales:   line.SaleCount,
			gross:   line.GrossAmount,
			payout:  line.PayoutAmount,
		})
	}
	return summaries
}

func assertRoyaltyLineSummaries(t *testing.T, label string, lines []*publiraadminv1.RoyaltyStatementLine, want []royaltyLineSummary) {
	t.Helper()

	got := summarizeRoyaltyLines(lines)
	if len(got) != len(want) {
		t.Fatalf("%s: lines = %+v, want %+v", label, got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("%s: line %d = %+v, want %+v", label, i+1, got[i], want[i])
		}
	}
}

// A tip is split among the episode's credits by their shares, as a sale is,
// on lines of its own after the lines of sales, and a tip in a provider's
// test mode is no line at all. A tip refunded in full while its month is open
// leaves that month.
func TestDBAdminRoyaltyStatementSplitsATipOnLinesOfItsOwn(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RTP")
	writer := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RTPCREATOR01", Name: "Writer"})
	artist := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RTPCREATOR02", Name: "Artist"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, writer.ID, "Original Author", "series", 6000)
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, artist.ID, "Artist", "series", 4000)

	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.July, 3, 9, 0, 0)})
	tip := env.seedTip(t, f, 300, inRoyaltyZone(2026, time.July, 4, 9, 0, 0), false)
	env.seedTip(t, f, 1000, inRoyaltyZone(2026, time.July, 5, 9, 0, 0), true)

	preview := env.previewRoyalties(t, f.admin, "2026-07")
	assertRoyaltyLineSummaries(t, "July with a tip", preview.Lines, []royaltyLineSummary{
		{creator: writer.PublicID, source: publiraadminv1.RoyaltyLineSource_ROYALTY_LINE_SOURCE_SALE, sales: 1, gross: 500, payout: 300},
		{creator: artist.PublicID, source: publiraadminv1.RoyaltyLineSource_ROYALTY_LINE_SOURCE_SALE, sales: 1, gross: 500, payout: 200},
		{creator: writer.PublicID, source: publiraadminv1.RoyaltyLineSource_ROYALTY_LINE_SOURCE_TIP, sales: 1, gross: 300, payout: 180},
		{creator: artist.PublicID, source: publiraadminv1.RoyaltyLineSource_ROYALTY_LINE_SOURCE_TIP, sales: 1, gross: 300, payout: 120},
	})
	if preview.Totals.Gross != 800 || preview.Totals.Payout != 800 {
		t.Fatalf("July totals = %+v, want the sale and the live tip, 800, paid out in full", preview.Totals)
	}

	env.refundTipInFull(t, tip)
	refunded := env.previewRoyalties(t, f.admin, "2026-07")
	assertRoyaltyLineSummaries(t, "July with the tip refunded", refunded.Lines, []royaltyLineSummary{
		{creator: writer.PublicID, source: publiraadminv1.RoyaltyLineSource_ROYALTY_LINE_SOURCE_SALE, sales: 1, gross: 500, payout: 300},
		{creator: artist.PublicID, source: publiraadminv1.RoyaltyLineSource_ROYALTY_LINE_SOURCE_SALE, sales: 1, gross: 500, payout: 200},
	})
}

// A tip refunded after its month was closed is taken back from the next
// statement, on an adjustment of its tip line rather than of its sales line,
// and the statement's CSV names the line's source as a tip.
func TestDBAdminRoyaltyStatementCarriesATipRefundedAfterTheClose(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RTA")
	creator := env.PG.SeedCreator(t, f.admin.Tenant.ID, testutil.CreatorSeed{PublicID: "RTACREATOR01", Name: "Creator"})
	env.creditEpisode(t, f.admin.Tenant.ID, f.episode.ID, creator.ID, "Artist", "series", 5000)

	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.July, 3, 9, 0, 0)})
	tip := env.seedTip(t, f, 300, inRoyaltyZone(2026, time.July, 4, 9, 0, 0), false)
	july := env.closeRoyalties(t, f.admin, "2026-07")
	if july.Totals.Payout != 400 {
		t.Fatalf("July payout = %d, want half of the sale and half of the tip", july.Totals.Payout)
	}

	env.refundTipInFull(t, tip)
	august := env.previewRoyalties(t, f.admin, "2026-08")
	assertRoyaltyLineSummaries(t, "August", august.Lines, []royaltyLineSummary{
		{creator: creator.PublicID, source: publiraadminv1.RoyaltyLineSource_ROYALTY_LINE_SOURCE_TIP, sales: -1, gross: -300, payout: -150},
	})
	if got := august.Lines[0].AdjustedPeriod; got != "2026-07" {
		t.Fatalf("adjusted period = %q, want 2026-07", got)
	}
	if august.Totals.Adjustment != -300 || august.Totals.Payout != -150 {
		t.Fatalf("August totals = %+v, want the tip taken back", august.Totals)
	}

	export, err := env.royaltyClient().ExportRoyaltyStatement(testutil.WithBearer(context.Background(), f.admin.token()), &publiraadminv1.ExportRoyaltyStatementRequest{
		Tenant: f.admin.tenantContext(),
		Period: "2026-07",
	})
	if err != nil {
		t.Fatalf("ExportRoyaltyStatement: %v", err)
	}
	records, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(export.Csv, []byte("\ufeff")))).ReadAll()
	if err != nil {
		t.Fatalf("read the statement CSV: %v", err)
	}
	sources := make([]string, 0, len(records)-1)
	for _, record := range records[1:] {
		sources = append(sources, record[len(record)-1])
	}
	if len(sources) != 2 || sources[0] != "sale" || sources[1] != "tip" {
		t.Fatalf("CSV sources = %v, want the line of sales and then the line of tips", sources)
	}
}

// A tip is a purchase of its episode, counted among the purchases, and
// tip_amount is the part of the gross that tips account for, on the totals, the
// day, the series, and the episode alike. A tip in a provider's test mode is
// in no figure.
func TestDBAdminRevenueCountsTipsAmongThePurchases(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RVT")
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 10, 12, 0, 0)})
	env.seedTip(t, f, 300, inRoyaltyZone(2026, time.January, 10, 13, 0, 0), false)
	env.seedTip(t, f, 1000, inRoyaltyZone(2026, time.January, 10, 14, 0, 0), true)

	period := func(groupBy publiraadminv1.RevenueGroupBy) *publiraadminv1.GetRevenueStatsResponse {
		return env.getRevenueStats(t, f.admin, &publiraadminv1.GetRevenueStatsRequest{
			StartDate: "2026-01-10",
			EndDate:   "2026-01-10",
			GroupBy:   groupBy,
		})
	}
	days := period(publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_DAY)
	assertRevenueTotals(t, "totals", days.Totals, revenueFigures{2, 800, 0, 800})
	if days.Totals.TipAmount != 300 {
		t.Fatalf("totals tip_amount = %d, want 300", days.Totals.TipAmount)
	}
	if len(days.Rows) != 1 || days.Rows[0].GrossAmount != 800 || days.Rows[0].TipAmount != 300 {
		t.Fatalf("day rows = %v, want the day's 800 with 300 of tips", days.Rows)
	}
	for _, groupBy := range []publiraadminv1.RevenueGroupBy{publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_SERIES, publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_EPISODE} {
		res := period(groupBy)
		if len(res.Rows) != 1 || res.Rows[0].PurchaseCount != 2 || res.Rows[0].GrossAmount != 800 || res.Rows[0].TipAmount != 300 {
			t.Fatalf("%s rows = %v, want one row of 800 with 300 of tips", groupBy, res.Rows)
		}
	}
}
