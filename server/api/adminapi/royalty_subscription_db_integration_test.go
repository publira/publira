package adminapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// subscriptionPaymentSeed is one paid invoice of a subscription, as the
// webhook records it.
type subscriptionPaymentSeed struct {
	amount      int32
	periodStart time.Time
	periodEnd   time.Time
	paidAt      time.Time
	currency    string
	test        bool
}

func (e *adminDBEnv) seedSubscriptionPayment(t *testing.T, tenantID, subscriptionID, planID uuid.UUID, seed subscriptionPaymentSeed) uuid.UUID {
	t.Helper()

	currency := seed.currency
	if currency == "" {
		currency = e.PG.TenantCurrency(t, tenantID)
	}
	paidAt := seed.paidAt
	if paidAt.IsZero() {
		paidAt = seed.periodStart
	}
	id := uuid.Must(uuid.NewV7())
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO subscription_payments (id, tenant_id, subscription_id, plan_id, stripe_invoice_id, stripe_payment_intent_id, amount, currency, period_start, period_end, paid_at, is_test)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, id, tenantID, subscriptionID, planID, "in_"+id.String(), "pi_"+id.String(), seed.amount, currency,
		seed.periodStart, seed.periodEnd, paidAt, seed.test); err != nil {
		t.Fatalf("insert subscription payment: %v", err)
	}
	return id
}

// refundSubscriptionPayment stands in for a refund notification recorded on a
// subscription payment: the running total refunded.
func (e *adminDBEnv) refundSubscriptionPayment(t *testing.T, paymentID uuid.UUID, refunded int32) {
	t.Helper()

	if _, err := e.PG.DB.ExecContext(context.Background(),
		"UPDATE subscription_payments SET refunded_amount = $2 WHERE id = $1", paymentID, refunded,
	); err != nil {
		t.Fatalf("refund %d of subscription payment %s: %v", refunded, paymentID, err)
	}
}

// finishEpisode records a member's first completed read of an episode, as the
// projection of it lands in content_events.
func (e *adminDBEnv) finishEpisode(t *testing.T, tenantID, userID uuid.UUID, episode testutil.Episode, seriesID uuid.UUID, at time.Time) {
	t.Helper()

	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO content_events (id, tenant_id, event_type, user_id, series_id, episode_id, source_table, source_id, occurred_at)
		VALUES ($1, $2, 'episode_complete', $3, $4, $5, 'episode_reads', $6, $7)
	`, uuid.Must(uuid.NewV7()), tenantID, userID, seriesID, episode.ID, uuid.Must(uuid.NewV7()), at); err != nil {
		t.Fatalf("finish episode %s: %v", episode.ID, err)
	}
}

func sourcesOf(lines []*publiraadminv1.RoyaltyStatementLine) []publiraadminv1.RoyaltyLineSource {
	sources := make([]publiraadminv1.RoyaltyLineSource, 0, len(lines))
	for _, line := range lines {
		sources = append(sources, line.Source)
	}
	return sources
}

func assertSources(t *testing.T, label string, lines []*publiraadminv1.RoyaltyStatementLine, want ...publiraadminv1.RoyaltyLineSource) {
	t.Helper()

	got := sourcesOf(lines)
	if len(got) != len(want) {
		t.Fatalf("%s sources = %v, want %v", label, got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("%s sources = %v, want %v", label, got, want)
		}
	}
}

const (
	sourceSale         = publiraadminv1.RoyaltyLineSource_ROYALTY_LINE_SOURCE_SALE
	sourceSubscription = publiraadminv1.RoyaltyLineSource_ROYALTY_LINE_SOURCE_SUBSCRIPTION
)

// A payment whose period ends in a month is shared evenly among the episodes
// of its plan the subscriber finished in that period, each part credited at
// its credits' shares as a subscription line after the month's sales. A
// payment whose subscriber finished nothing is shared with no one, and a
// refund recorded after the close is taken back from the next statement, from
// the same episodes.
func TestDBAdminRoyaltyStatementSharesASubscriptionPaymentAmongTheEpisodesFinished(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RSB")
	tenantID := f.admin.Tenant.ID
	second := env.PG.SeedEpisode(t, tenantID, f.series.ID, testutil.EpisodeSeed{
		PublicID: "RSBEPISODE2", Title: "Episode 2", Price: 300, Status: testutil.EpisodeStatusPublished,
	})
	elsewhere := env.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: "RSBSERIES02", Title: "Elsewhere"})
	outside := env.PG.SeedEpisode(t, tenantID, elsewhere.ID, testutil.EpisodeSeed{
		PublicID: "RSBOUTSIDE1", Title: "Outside Episode", Price: 300, Status: testutil.EpisodeStatusPublished,
	})
	author := env.PG.SeedCreator(t, tenantID, testutil.CreatorSeed{PublicID: "RSBAUTHOR001", Name: "First Author"})
	other := env.PG.SeedCreator(t, tenantID, testutil.CreatorSeed{PublicID: "RSBAUTHOR002", Name: "Second Author"})
	env.creditEpisode(t, tenantID, f.episode.ID, author.ID, "Original Author", "episode", 10000)
	env.creditEpisode(t, tenantID, second.ID, other.ID, "Original Author", "episode", 10000)
	env.creditEpisode(t, tenantID, outside.ID, other.ID, "Original Author", "episode", 10000)

	// The plan opens the first series alone, so finishing the episode of the
	// other one shares nothing with it.
	plan := env.PG.SeedSubscriptionPlan(t, tenantID, testutil.SubscriptionPlanSeed{Scope: "series", SeriesIDs: []uuid.UUID{f.series.ID}})
	subscription := env.PG.SeedSubscription(t, tenantID, f.reader.ID, plan.ID, testutil.SubscriptionSeed{})
	periodStart := inRoyaltyZone(2026, time.June, 15, 12, 0, 0)
	periodEnd := inRoyaltyZone(2026, time.July, 15, 12, 0, 0)
	shared := env.seedSubscriptionPayment(t, tenantID, subscription, plan.ID, subscriptionPaymentSeed{amount: 1000, periodStart: periodStart, periodEnd: periodEnd})
	env.finishEpisode(t, tenantID, f.reader.ID, f.episode, f.series.ID, inRoyaltyZone(2026, time.June, 20, 12, 0, 0))
	env.finishEpisode(t, tenantID, f.reader.ID, second, f.series.ID, inRoyaltyZone(2026, time.July, 1, 12, 0, 0))
	env.finishEpisode(t, tenantID, f.reader.ID, outside, elsewhere.ID, inRoyaltyZone(2026, time.July, 2, 12, 0, 0))

	// A subscriber who finished nothing in the period is paid for by no line,
	// and so is a payment in Stripe's test mode, or whose period ends in
	// another month.
	idle := env.PG.SeedEndUser(t, tenantID, "RSBREADER02", "idle@rsb.example.com", "Idle Reader")
	idleSubscription := env.PG.SeedSubscription(t, tenantID, idle.ID, plan.ID, testutil.SubscriptionSeed{})
	env.seedSubscriptionPayment(t, tenantID, idleSubscription, plan.ID, subscriptionPaymentSeed{amount: 980, periodStart: periodStart, periodEnd: periodEnd})
	env.seedSubscriptionPayment(t, tenantID, subscription, plan.ID, subscriptionPaymentSeed{amount: 1000, periodStart: periodStart, periodEnd: periodEnd, test: true})
	env.seedSubscriptionPayment(t, tenantID, subscription, plan.ID, subscriptionPaymentSeed{amount: 1000, periodStart: periodEnd, periodEnd: inRoyaltyZone(2026, time.August, 15, 12, 0, 0)})

	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.July, 3, 9, 0, 0)})

	julyLines := []expectedRoyaltyLine{
		{credit: [3]string{"First Author", "Original Author", "Episode 1"}, figures: adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 500, shareBps: 10000, payout: 500}}},
		{credit: [3]string{"First Author", "Original Author", "Episode 1"}, figures: adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 500, shareBps: 10000, payout: 500}}},
		{credit: [3]string{"Second Author", "Original Author", "Episode 2"}, figures: adjustedLineFigures{"", royaltyLineFigures{saleCount: 1, gross: 500, shareBps: 10000, payout: 500}}},
	}
	preview := env.previewRoyalties(t, f.admin, "2026-07")
	assertRoyaltyLines(t, "July's preview", preview.Lines, julyLines)
	assertSources(t, "July's preview", preview.Lines, sourceSale, sourceSubscription, sourceSubscription)
	assertRoyaltyTotals(t, "July's preview", preview.Totals, 1500, 0, 0, 1500)

	statement := env.closeRoyalties(t, f.admin, "2026-07")
	assertRoyaltyTotals(t, "July", statement.Totals, 1500, 0, 0, 1500)
	closed := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-07"})
	assertRoyaltyLines(t, "July", closed.Lines, julyLines)
	assertSources(t, "July", closed.Lines, sourceSale, sourceSubscription, sourceSubscription)
	if csv := env.exportRoyalties(t, f.admin, "2026-07"); !strings.HasSuffix(strings.SplitN(csv, "\r\n", 2)[0], ",adjusted_period,source") ||
		strings.Count(csv, ",,subscription\r\n") != 2 || strings.Count(csv, ",,sale\r\n") != 1 {
		t.Fatalf("July's csv =\n%s\nwant a source column naming one sale line and two subscription lines", csv)
	}

	// Finishing another episode after the close moves nothing a closed month
	// shared.
	third := env.PG.SeedEpisode(t, tenantID, f.series.ID, testutil.EpisodeSeed{
		PublicID: "RSBEPISODE3", Title: "Episode 3", Price: 300, Status: testutil.EpisodeStatusPublished,
	})
	env.finishEpisode(t, tenantID, f.reader.ID, third, f.series.ID, inRoyaltyZone(2026, time.July, 10, 12, 0, 0))

	// A refund in part after the close takes back from each episode its part
	// of the refund, from the subscription line alone.
	env.refundSubscriptionPayment(t, shared, 400)
	augustLines := []expectedRoyaltyLine{
		{credit: [3]string{"First Author", "Original Author", "Episode 1"}, figures: adjustedLineFigures{"2026-07", royaltyLineFigures{refunded: 200, shareBps: 10000, payout: -200}}},
		{credit: [3]string{"Second Author", "Original Author", "Episode 2"}, figures: adjustedLineFigures{"2026-07", royaltyLineFigures{refunded: 200, shareBps: 10000, payout: -200}}},
	}
	preview = env.previewRoyalties(t, f.admin, "2026-08")
	assertRoyaltyLines(t, "August's preview", preview.Lines, augustLines)
	assertSources(t, "August's preview", preview.Lines, sourceSubscription, sourceSubscription)
	assertRoyaltyTotals(t, "August's preview", preview.Totals, 0, 0, -400, -400)
	env.closeRoyalties(t, f.admin, "2026-08")
	august := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-08"})
	assertRoyaltyLines(t, "August", august.Lines, augustLines)
	assertSources(t, "August", august.Lines, sourceSubscription, sourceSubscription)

	// Refunded in full, it takes back the rest, and nothing is carried twice.
	env.refundSubscriptionPayment(t, shared, 1000)
	env.closeRoyalties(t, f.admin, "2026-09")
	september := env.getRoyalties(t, f.admin, &publiraadminv1.GetRoyaltyStatementRequest{Period: "2026-09"})
	assertRoyaltyLines(t, "September", september.Lines, []expectedRoyaltyLine{
		{credit: [3]string{"First Author", "Original Author", "Episode 1"}, figures: adjustedLineFigures{"2026-07", royaltyLineFigures{saleCount: -1, gross: -500, refunded: -200, shareBps: 10000, payout: -300}}},
		{credit: [3]string{"Second Author", "Original Author", "Episode 2"}, figures: adjustedLineFigures{"2026-07", royaltyLineFigures{saleCount: -1, gross: -500, refunded: -200, shareBps: 10000, payout: -300}}},
	})
	assertRoyaltyTotals(t, "September", september.Statement.Totals, 0, 0, -600, -600)
	if lines := env.previewRoyalties(t, f.admin, "2026-10").Lines; len(lines) != 0 {
		t.Fatalf("October's preview = %+v, want nothing left to carry", lines)
	}
}

// A payment the statement shares is divided so that its parts add up to it,
// however many episodes it is shared among.
func TestDBAdminRoyaltyStatementSharesAPaymentToTheLastMinorUnit(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RSU")
	tenantID := f.admin.Tenant.ID
	author := env.PG.SeedCreator(t, tenantID, testutil.CreatorSeed{PublicID: "RSUAUTHOR001", Name: "Only Author"})
	episodes := []testutil.Episode{f.episode}
	for _, id := range []string{"RSUEPISODE2", "RSUEPISODE3"} {
		episodes = append(episodes, env.PG.SeedEpisode(t, tenantID, f.series.ID, testutil.EpisodeSeed{
			PublicID: id, Title: id, Price: 300, Status: testutil.EpisodeStatusPublished,
		}))
	}
	plan := env.PG.SeedSubscriptionPlan(t, tenantID, testutil.SubscriptionPlanSeed{})
	subscription := env.PG.SeedSubscription(t, tenantID, f.reader.ID, plan.ID, testutil.SubscriptionSeed{})
	periodStart := inRoyaltyZone(2026, time.July, 1, 12, 0, 0)
	env.seedSubscriptionPayment(t, tenantID, subscription, plan.ID, subscriptionPaymentSeed{
		amount: 1000, periodStart: periodStart, periodEnd: inRoyaltyZone(2026, time.July, 31, 12, 0, 0),
	})
	for i, episode := range episodes {
		env.creditEpisode(t, tenantID, episode.ID, author.ID, "Original Author", "episode", 10000)
		env.finishEpisode(t, tenantID, f.reader.ID, episode, f.series.ID, periodStart.Add(time.Duration(i+1)*time.Hour))
	}

	preview := env.previewRoyalties(t, f.admin, "2026-07")
	var gross int64
	for _, line := range preview.Lines {
		if line.GrossAmount != 333 && line.GrossAmount != 334 {
			t.Fatalf("line %+v, want a third of 1000", line)
		}
		gross += line.GrossAmount
	}
	if len(preview.Lines) != 3 || gross != 1000 {
		t.Fatalf("preview lines %+v add up to %d, want three adding up to 1000", preview.Lines, gross)
	}
	assertRoyaltyTotals(t, "July's preview", preview.Totals, 1000, 0, 0, 1000)
}

// A subscription payment is counted on the day it was paid, apart from the
// purchases, and what went back on it is taken off that day.
func TestDBAdminGetRevenueStatsCountsSubscriptionPaymentsOnTheDayTheyWerePaid(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedRoyaltyFixture(t, "RVS")
	tenantID := f.admin.Tenant.ID
	plan := env.PG.SeedSubscriptionPlan(t, tenantID, testutil.SubscriptionPlanSeed{})
	subscription := env.PG.SeedSubscription(t, tenantID, f.reader.ID, plan.ID, testutil.SubscriptionSeed{})
	month := func(paidAt time.Time) subscriptionPaymentSeed {
		return subscriptionPaymentSeed{amount: 980, periodStart: paidAt, periodEnd: paidAt.AddDate(0, 1, 0), paidAt: paidAt}
	}
	// Half past midnight in the tenant's zone is the day before in UTC.
	env.seedSubscriptionPayment(t, tenantID, subscription, plan.ID, month(inRoyaltyZone(2026, time.January, 11, 0, 30, 0)))
	refunded := env.seedSubscriptionPayment(t, tenantID, subscription, plan.ID, month(inRoyaltyZone(2026, time.January, 12, 12, 0, 0)))
	env.refundSubscriptionPayment(t, refunded, 300)
	test := month(inRoyaltyZone(2026, time.January, 12, 13, 0, 0))
	test.test = true
	env.seedSubscriptionPayment(t, tenantID, subscription, plan.ID, test)
	foreign := month(inRoyaltyZone(2026, time.January, 12, 14, 0, 0))
	foreign.currency = "USD"
	if env.PG.TenantCurrency(t, tenantID) == "USD" {
		foreign.currency = "EUR"
	}
	env.seedSubscriptionPayment(t, tenantID, subscription, plan.ID, foreign)
	env.seedSale(t, f, f.episode.ID, royaltySale{price: 500, purchasedAt: inRoyaltyZone(2026, time.January, 12, 9, 0, 0)})

	res := env.getRevenueStats(t, f.admin, &publiraadminv1.GetRevenueStatsRequest{
		StartDate: "2026-01-10", EndDate: "2026-01-12", GroupBy: publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_DAY,
	})
	type day struct {
		date                 string
		gross                int64
		subscription         int64
		subscriptionRefunded int64
	}
	want := []day{{"2026-01-10", 0, 0, 0}, {"2026-01-11", 0, 980, 0}, {"2026-01-12", 500, 980, 300}}
	if len(res.Rows) != len(want) {
		t.Fatalf("rows = %+v, want %d days", res.Rows, len(want))
	}
	for i, row := range res.Rows {
		if got := (day{row.Date, row.GrossAmount, row.SubscriptionAmount, row.SubscriptionRefundedAmount}); got != want[i] {
			t.Fatalf("day %d = %+v, want %+v", i, got, want[i])
		}
	}
	if res.Totals.GrossAmount != 500 || res.Totals.NetAmount != 500 ||
		res.Totals.SubscriptionAmount != 1960 || res.Totals.SubscriptionRefundedAmount != 300 {
		t.Fatalf("totals = %+v, want 500 of purchases and 1960 of subscriptions with 300 refunded", res.Totals)
	}

	// A payment belongs to no series, so the series report counts none.
	bySeries := env.getRevenueStats(t, f.admin, &publiraadminv1.GetRevenueStatsRequest{
		StartDate: "2026-01-10", EndDate: "2026-01-12", GroupBy: publiraadminv1.RevenueGroupBy_REVENUE_GROUP_BY_SERIES,
	})
	for _, row := range bySeries.Rows {
		if row.SubscriptionAmount != 0 || row.SubscriptionRefundedAmount != 0 {
			t.Fatalf("series row %+v counts a subscription payment", row)
		}
	}
	if bySeries.Totals.SubscriptionAmount != 1960 {
		t.Fatalf("series report totals = %+v, want the period's subscription payments", bySeries.Totals)
	}

	currency := env.PG.TenantCurrency(t, tenantID)
	if got, want := env.exportStats(t, f.admin, &publiraadminv1.ExportStatsRequest{
		Kind: publiraadminv1.StatsExportKind_STATS_EXPORT_KIND_REVENUE_BY_DAY, StartDate: "2026-01-10", EndDate: "2026-01-12",
	}), csvFile(
		"date,purchase_count,gross_amount,refunded_amount,net_amount,subscription_amount,subscription_refunded_amount,currency",
		"2026-01-10,0,0,0,0,0,0,"+currency,
		"2026-01-11,0,0,0,0,980,0,"+currency,
		"2026-01-12,1,500,0,500,980,300,"+currency,
	); got != want {
		t.Fatalf("by day csv =\n%q\nwant\n%q", got, want)
	}
}
