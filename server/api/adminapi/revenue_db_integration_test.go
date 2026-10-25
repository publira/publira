package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

func (e *adminDBEnv) engagementClient() publiraadminv1connect.AdminEngagementServiceClient {
	return publiraadminv1connect.NewAdminEngagementServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

// revenueFixture is the volume royalty fixture, in Seoul, with a second series
// selling one episode at 200, and the tenant's purchases from the 10th to the
// 14th of January 2026:
//
//   - the 10th: the first episode at 500;
//   - the 11th, 00:30: the volume at 600 with 100 of it refunded, which UTC
//     still counts as the 10th;
//   - the 11th: the second series' episode at 200, whose dispute was lost;
//   - the 12th: the first episode at 500, refunded in full;
//   - the 12th: the first episode at 500 in a payment provider's test mode,
//     and again at 500 in a currency the tenant no longer sells in, neither
//     of which is revenue;
//   - the 14th: the first episode at 500, outside the period the tests ask for.
type revenueFixture struct {
	volumeRoyaltyFixture
	otherSeries  testutil.Series
	otherEpisode testutil.Episode
}

func (e *adminDBEnv) seedRevenueFixture(t *testing.T, prefix string) revenueFixture {
	t.Helper()

	f := revenueFixture{volumeRoyaltyFixture: e.seedVolumeRoyaltyFixture(t, prefix)}
	f.otherSeries = e.PG.SeedSeries(t, f.admin.Tenant.ID, testutil.SeriesSeed{PublicID: prefix + "SERIES02", Title: "Other Series"})
	f.otherEpisode = e.PG.SeedEpisode(t, f.admin.Tenant.ID, f.otherSeries.ID, testutil.EpisodeSeed{
		PublicID: prefix + "OTHEREP1",
		Title:    "Other Episode",
		Price:    200,
		Status:   testutil.EpisodeStatusPublished,
	})

	e.seedSale(t, f.royaltyFixture, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 10, 23, 30, 0)})
	e.seedVolumeSale(t, f.volumeRoyaltyFixture, royaltySale{
		price:          600,
		purchasedAt:    inRoyaltyZone(2026, time.January, 11, 0, 30, 0),
		refundedAmount: sql.NullInt32{Int32: 100, Valid: true},
	})
	disputed := e.seedSale(t, f.royaltyFixture, f.otherEpisode.ID, royaltySale{price: 200, purchasedAt: inRoyaltyZone(2026, time.January, 11, 12, 0, 0)})
	lostAt := inRoyaltyZone(2026, time.January, 20, 12, 0, 0)
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		UPDATE purchases SET revoked_at = $2, revocation_reason = 'dispute', dispute_lost_at = $2 WHERE id = $1
	`, disputed, lostAt); err != nil {
		t.Fatalf("lose the dispute of purchase %s: %v", disputed, err)
	}
	refundedAt := inRoyaltyZone(2026, time.January, 13, 12, 0, 0)
	e.seedSale(t, f.royaltyFixture, f.episode.ID, royaltySale{
		price:          500,
		purchasedAt:    inRoyaltyZone(2026, time.January, 12, 12, 0, 0),
		refundedAmount: sql.NullInt32{Int32: 500, Valid: true},
		refundedAt:     sql.NullTime{Time: refundedAt, Valid: true},
	})
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at, currency, is_test, provider, provider_checkout_id)
		VALUES ($1, $2, $3, $4, 500, $5, $6, true, 'stripe', $7)
	`, uuid.Must(uuid.NewV7()), f.admin.Tenant.ID, f.reader.ID, f.episode.ID, inRoyaltyZone(2026, time.January, 12, 13, 0, 0),
		e.PG.TenantCurrency(t, f.admin.Tenant.ID), "cs_test_"+prefix); err != nil {
		t.Fatalf("insert a test purchase: %v", err)
	}
	otherCurrency := "USD"
	if e.PG.TenantCurrency(t, f.admin.Tenant.ID) == otherCurrency {
		otherCurrency = "EUR"
	}
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at, currency)
		VALUES ($1, $2, $3, $4, 500, $5, $6)
	`, uuid.Must(uuid.NewV7()), f.admin.Tenant.ID, f.reader.ID, f.episode.ID, inRoyaltyZone(2026, time.January, 12, 14, 0, 0), otherCurrency); err != nil {
		t.Fatalf("insert a purchase in another currency: %v", err)
	}
	e.seedSale(t, f.royaltyFixture, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 14, 12, 0, 0)})
	return f
}

func (e *adminDBEnv) getRevenueStats(t *testing.T, tenant adminDBTenant, req *publiraadminv1.GetRevenueStatsRequest) *publiraadminv1.GetRevenueStatsResponse {
	t.Helper()

	req.Tenant = tenant.tenantContext()
	res, err := e.engagementClient().GetRevenueStats(testutil.WithBearer(context.Background(), tenant.token()), req)
	if err != nil {
		t.Fatalf("GetRevenueStats %s: %v", req.GroupBy, err)
	}
	return res
}

// revenueFigures is a row or the totals as purchase count, gross, refunded,
// and net.
type revenueFigures [4]int64

func revenueFiguresOf(row *publiraadminv1.RevenueStatsRow) revenueFigures {
	return revenueFigures{row.PurchaseCount, row.GrossAmount, row.RefundedAmount, row.NetAmount}
}

type expectedRevenueRow struct {
	key     string
	figures revenueFigures
}

// assertRevenueRows compares rows keyed by their date, their series, or their
// episode, whichever the grouping fills in.
func assertRevenueRows(t *testing.T, label string, rows []*publiraadminv1.RevenueStatsRow, want []expectedRevenueRow) {
	t.Helper()

	if len(rows) != len(want) {
		t.Fatalf("%s: %d rows, want %d: %v", label, len(rows), len(want), rows)
	}
	for i, row := range rows {
		key := row.Date
		switch {
		case row.EpisodePublicId != "":
			key = row.EpisodePublicId
		case row.SeriesPublicId != "":
			key = row.SeriesPublicId
		}
		if key != want[i].key || revenueFiguresOf(row) != want[i].figures {
			t.Fatalf("%s: row %d = %s %v, want %s %v", label, i, key, revenueFiguresOf(row), want[i].key, want[i].figures)
		}
	}
}

func assertRevenueTotals(t *testing.T, label string, totals *publiraadminv1.RevenueStatsTotals, want revenueFigures) {
	t.Helper()

	got := revenueFigures{totals.PurchaseCount, totals.GrossAmount, totals.RefundedAmount, totals.NetAmount}
	if got != want {
		t.Fatalf("%s: totals = %v, want %v", label, got, want)
	}
}

// The tenant's days, not UTC's, are what a day report cuts, every day of the
// period is in it whether or not anything sold, and a sale's refund and a lost
// dispute come off the day it was sold on. A test purchase and one in another
// currency are in no row and no total.
func TestDBAdminRevenueByDayCutsTheTenantsDays(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRevenueFixture(t, "RVD")

	res := env.getRevenueStats(t, f.admin, &publiraadminv1.GetRevenueStatsRequest{
		StartDate: "2026-01-10",
		EndDate:   "2026-01-13",
		GroupBy:   publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_DAY,
	})

	if res.TimeZone != royaltyZoneName || res.Currency != env.PG.TenantCurrency(t, f.admin.Tenant.ID) {
		t.Fatalf("zone %q, currency %q; want %q and the tenant's", res.TimeZone, res.Currency, royaltyZoneName)
	}
	if res.StartDate != "2026-01-10" || res.EndDate != "2026-01-13" || res.PreviousToken != "" || res.NextToken != "" {
		t.Fatalf("period %s..%s, tokens %q %q; want the period echoed and no tokens", res.StartDate, res.EndDate, res.PreviousToken, res.NextToken)
	}
	assertRevenueRows(t, "by day", res.Rows, []expectedRevenueRow{
		{"2026-01-10", revenueFigures{1, 500, 0, 500}},
		{"2026-01-11", revenueFigures{2, 800, 300, 500}},
		{"2026-01-12", revenueFigures{1, 500, 500, 0}},
		{"2026-01-13", revenueFigures{0, 0, 0, 0}},
	})
	assertRevenueTotals(t, "by day", res.Totals, revenueFigures{4, 1800, 800, 1000})
}

// A purchase of a volume is a sale of its series at all of its price, and of
// each priced episode in it at that episode's part, with its refund divided
// the way a royalty statement divides one. Each report ranks by net.
func TestDBAdminRevenueBySeriesAndEpisodeCreditsTheParts(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRevenueFixture(t, "RVG")
	period := func(groupBy publiraadminv1.RevenueGroupBy) *publiraadminv1.GetRevenueStatsRequest {
		return &publiraadminv1.GetRevenueStatsRequest{StartDate: "2026-01-10", EndDate: "2026-01-13", GroupBy: groupBy}
	}

	bySeries := env.getRevenueStats(t, f.admin, period(publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_SERIES))
	assertRevenueRows(t, "by series", bySeries.Rows, []expectedRevenueRow{
		{"RVGSERIES01", revenueFigures{3, 1600, 600, 1000}},
		{"RVGSERIES02", revenueFigures{1, 200, 200, 0}},
	})
	if got := bySeries.Rows[0].SeriesTitle; got != "Royalty Series" {
		t.Fatalf("series title = %q, want Royalty Series", got)
	}
	assertRevenueTotals(t, "by series", bySeries.Totals, revenueFigures{4, 1800, 800, 1000})

	byEpisode := env.getRevenueStats(t, f.admin, period(publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_EPISODE))
	assertRevenueRows(t, "by episode", byEpisode.Rows, []expectedRevenueRow{
		{"RVGEPISODE1", revenueFigures{3, 1375, 562, 813}},
		{"RVGEPISODE2", revenueFigures{1, 225, 37, 188}},
		{"RVGOTHEREP1", revenueFigures{1, 200, 200, 0}},
	})
	if row := byEpisode.Rows[1]; row.EpisodeTitle != "Episode 2" || row.SeriesPublicId != "RVGSERIES01" {
		t.Fatalf("second episode row = %s of %s, want Episode 2 of RVGSERIES01", row.EpisodeTitle, row.SeriesPublicId)
	}
	assertRevenueTotals(t, "by episode", byEpisode.Totals, revenueFigures{4, 1800, 800, 1000})
}

// A ranked report pages on (net, id) both ways, and a token is bound to the
// grouping and the period it was issued for. A request naming no grouping is
// refused.
func TestDBAdminRevenueByEpisodePagesAndBindsItsTokens(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRevenueFixture(t, "RVP")
	request := func(token string) *publiraadminv1.GetRevenueStatsRequest {
		return &publiraadminv1.GetRevenueStatsRequest{
			StartDate: "2026-01-10",
			EndDate:   "2026-01-13",
			GroupBy:   publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_EPISODE,
			Limit:     2,
			Token:     token,
		}
	}

	first := env.getRevenueStats(t, f.admin, request(""))
	assertRevenueRows(t, "first page", first.Rows, []expectedRevenueRow{
		{"RVPEPISODE1", revenueFigures{3, 1375, 562, 813}},
		{"RVPEPISODE2", revenueFigures{1, 225, 37, 188}},
	})
	if first.PreviousToken != "" || first.NextToken == "" {
		t.Fatalf("first page tokens %q %q, want a next token only", first.PreviousToken, first.NextToken)
	}

	second := env.getRevenueStats(t, f.admin, request(first.NextToken))
	assertRevenueRows(t, "second page", second.Rows, []expectedRevenueRow{
		{"RVPOTHEREP1", revenueFigures{1, 200, 200, 0}},
	})
	if second.PreviousToken == "" || second.NextToken != "" {
		t.Fatalf("second page tokens %q %q, want a previous token only", second.PreviousToken, second.NextToken)
	}
	assertRevenueTotals(t, "second page", second.Totals, revenueFigures{4, 1800, 800, 1000})

	back := env.getRevenueStats(t, f.admin, request(second.PreviousToken))
	assertRevenueRows(t, "back to the first page", back.Rows, []expectedRevenueRow{
		{"RVPEPISODE1", revenueFigures{3, 1375, 562, 813}},
		{"RVPEPISODE2", revenueFigures{1, 225, 37, 188}},
	})

	for name, req := range map[string]*publiraadminv1.GetRevenueStatsRequest{
		"another period": {
			StartDate: "2026-01-11", EndDate: "2026-01-13",
			GroupBy: publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_EPISODE, Token: first.NextToken,
		},
		"another grouping": {
			StartDate: "2026-01-10", EndDate: "2026-01-13",
			GroupBy: publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_SERIES, Token: first.NextToken,
		},
		"no grouping": {StartDate: "2026-01-10", EndDate: "2026-01-13"},
	} {
		t.Run(name, func(t *testing.T) {
			req.Tenant = f.admin.tenantContext()
			_, err := env.engagementClient().GetRevenueStats(testutil.WithBearer(context.Background(), f.admin.token()), req)
			if connectErr := new(connect.Error); !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeInvalidArgument {
				t.Fatalf("GetRevenueStats error = %v, want invalid_argument", err)
			}
		})
	}
}

// The totals and the day report read a tenant's range of purchases from
// idx_purchases_tenant_purchased_at_id_amounts alone, without visiting the
// table.
func TestDBAdminRevenueTotalsAndDaysScanOnlyTheIndex(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedRevenueFixture(t, "RVI")
	ctx := context.Background()
	if _, err := env.PG.DB.ExecContext(ctx, "VACUUM ANALYZE purchases"); err != nil {
		t.Fatalf("vacuum purchases: %v", err)
	}

	args := []any{f.admin.Tenant.ID, env.PG.TenantCurrency(t, f.admin.Tenant.ID), royaltyZoneName,
		time.Date(2026, time.January, 10, 0, 0, 0, 0, time.UTC), time.Date(2026, time.January, 13, 0, 0, 0, 0, time.UTC)}
	for name, query := range map[string]struct {
		sql  string
		args []any
	}{
		"GetRevenueTotals": {dbmodels.GetRevenueTotals, args},
		// ListRevenueByDay binds the period first.
		"ListRevenueByDay": {dbmodels.ListRevenueByDay, []any{args[3], args[4], args[2], args[0], args[1]}},
	} {
		t.Run(name, func(t *testing.T) {
			tx, err := env.PG.DB.BeginTx(ctx, nil)
			if err != nil {
				t.Fatalf("begin explain transaction: %v", err)
			}
			defer tx.Rollback() //nolint:errcheck
			if _, err := tx.ExecContext(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
				t.Fatalf("disable sequential scans: %v", err)
			}
			rows, err := tx.QueryContext(ctx, "EXPLAIN (COSTS OFF) "+query.sql, query.args...)
			if err != nil {
				t.Fatalf("explain %s: %v", name, err)
			}
			defer rows.Close() //nolint:errcheck
			var plan strings.Builder
			for rows.Next() {
				var line string
				if err := rows.Scan(&line); err != nil {
					t.Fatalf("scan plan: %v", err)
				}
				plan.WriteString(line + "\n")
			}
			if err := rows.Err(); err != nil {
				t.Fatalf("iterate plan: %v", err)
			}
			if !strings.Contains(plan.String(), "Index Only Scan using idx_purchases_tenant_purchased_at_id_amounts") {
				t.Fatalf("%s does not scan the index alone:\n%s", name, plan.String())
			}
		})
	}
}
