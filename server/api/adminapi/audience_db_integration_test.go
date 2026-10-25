package adminapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// audienceFixture is the royalty fixture, in Seoul, with two more series and
// three more readers, and the follows the tenant had in January 2026:
//
//   - the 10th, 23:30: the first reader follows the first series;
//   - the 11th, 00:30: the second reader follows it, which UTC still counts as
//     the 10th;
//   - the 11th: the fourth reader follows the second series;
//   - the 12th: the third reader follows the first series;
//   - the 14th: the first reader follows the second series, outside the period
//     the tests ask for.
//
// The third series nobody follows. The daily aggregates hold the first
// series' 10th and 11th, the second series' 12th, an episode row for the 10th
// a series report must not count twice, and a series row for the 13th outside
// the period.
type audienceFixture struct {
	royaltyFixture
	secondSeries testutil.Series
	thirdSeries  testutil.Series
	readers      [4]testutil.TenantUser
}

func (e *adminDBEnv) seedAudienceFixture(t *testing.T, prefix string) audienceFixture {
	t.Helper()

	f := audienceFixture{royaltyFixture: e.seedRoyaltyFixture(t, prefix)}
	tenantID := f.admin.Tenant.ID
	f.secondSeries = e.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: prefix + "SERIES02", Title: "Second Series"})
	f.thirdSeries = e.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: prefix + "SERIES03", Title: "Third Series"})
	f.readers[0] = f.reader
	for i := 1; i < len(f.readers); i++ {
		suffix := string(rune('1' + i))
		f.readers[i] = e.PG.SeedEndUser(t, tenantID, prefix+"READER0"+suffix, "reader"+suffix+"@"+prefix+".example.com", "Reader "+suffix)
	}

	for _, follow := range []struct {
		reader   testutil.TenantUser
		seriesID uuid.UUID
		at       time.Time
	}{
		{f.readers[0], f.series.ID, inRoyaltyZone(2026, time.January, 10, 23, 30, 0)},
		{f.readers[1], f.series.ID, inRoyaltyZone(2026, time.January, 11, 0, 30, 0)},
		{f.readers[3], f.secondSeries.ID, inRoyaltyZone(2026, time.January, 11, 12, 0, 0)},
		{f.readers[2], f.series.ID, inRoyaltyZone(2026, time.January, 12, 12, 0, 0)},
		{f.readers[0], f.secondSeries.ID, inRoyaltyZone(2026, time.January, 14, 12, 0, 0)},
	} {
		e.follow(t, tenantID, follow.reader.ID, follow.seriesID, follow.at)
	}

	for _, stats := range []struct {
		entityType string
		entityID   uuid.UUID
		day        string
		views      int64
		completes  int64
		reactions  int64
		points     int64
	}{
		{"series", f.series.ID, "2026-01-10", 40, 4, 3, 15},
		{"episode", f.episode.ID, "2026-01-10", 40, 4, 3, 15},
		{"series", f.series.ID, "2026-01-11", 60, 6, 2, 10},
		{"series", f.secondSeries.ID, "2026-01-12", 100, 10, 1, 5},
		{"series", f.series.ID, "2026-01-13", 7, 1, 1, 5},
	} {
		if _, err := e.PG.DB.ExecContext(context.Background(), `
			INSERT INTO content_daily_stats (id, tenant_id, stat_date, entity_type, entity_id, view_count, complete_count, rating_count, rating_sum)
			VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)
		`, uuid.Must(uuid.NewV7()), tenantID, stats.day, stats.entityType, stats.entityID,
			stats.views, stats.completes, stats.reactions, stats.points); err != nil {
			t.Fatalf("seed the daily stats of %s %s: %v", stats.entityType, stats.day, err)
		}
	}
	// What aggregate-content-stats leaves behind with those days: every series
	// row's points and completed reads.
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO tenant_rating_totals (tenant_id, points, completed_reads) VALUES ($1, 35, 21)
	`, tenantID); err != nil {
		t.Fatalf("seed the tenant rating totals: %v", err)
	}
	// The first series has a reader who reacted; the second has points and no
	// reader behind them, which is a series with no figure.
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO episode_ratings (tenant_id, user_id, episode_id, score) VALUES ($1, $2, $3, 5)
	`, tenantID, f.readers[0].ID, f.episode.ID); err != nil {
		t.Fatalf("seed a reaction: %v", err)
	}
	return f
}

func (e *adminDBEnv) follow(t *testing.T, tenantID, userID, seriesID uuid.UUID, at time.Time) {
	t.Helper()
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO series_follows (tenant_id, user_id, series_id, created_at) VALUES ($1, $2, $3, $4)
	`, tenantID, userID, seriesID, at); err != nil {
		t.Fatalf("follow series %s: %v", seriesID, err)
	}
}

func (e *adminDBEnv) getAudienceStats(t *testing.T, tenant adminDBTenant, req *publiraadminv1.GetAudienceStatsRequest) *publiraadminv1.GetAudienceStatsResponse {
	t.Helper()

	req.Tenant = tenant.tenantContext()
	res, err := e.engagementClient().GetAudienceStats(testutil.WithBearer(context.Background(), tenant.token()), req)
	if err != nil {
		t.Fatalf("GetAudienceStats %s: %v", req.GroupBy, err)
	}
	return res
}

// audienceFigures is a row or the totals as followers, follows made, follows
// ended, views, completed reads, reactions, and reaction points.
type audienceFigures [7]int64

func audienceFiguresOf(row *publiraadminv1.AudienceStatsRow) audienceFigures {
	return audienceFigures{
		row.FollowerCount, row.FollowedCount, row.UnfollowedCount,
		row.ViewCount, row.CompleteCount, row.ReactionCount, row.ReactionPoints,
	}
}

func audienceTotalsOf(totals *publiraadminv1.AudienceStatsTotals) audienceFigures {
	return audienceFigures{
		totals.FollowerCount, totals.FollowedCount, totals.UnfollowedCount,
		totals.ViewCount, totals.CompleteCount, totals.ReactionCount, totals.ReactionPoints,
	}
}

type expectedAudienceRow struct {
	key     string
	figures audienceFigures
}

// assertAudienceRows compares rows keyed by their date or their series,
// whichever the grouping fills in.
func assertAudienceRows(t *testing.T, label string, rows []*publiraadminv1.AudienceStatsRow, want []expectedAudienceRow) {
	t.Helper()

	if len(rows) != len(want) {
		t.Fatalf("%s: %d rows, want %d: %v", label, len(rows), len(want), rows)
	}
	for i, row := range rows {
		key := row.Date
		if row.SeriesPublicId != "" {
			key = row.SeriesPublicId
		}
		if key != want[i].key || audienceFiguresOf(row) != want[i].figures {
			t.Fatalf("%s: row %d = %s %v, want %s %v", label, i, key, audienceFiguresOf(row), want[i].key, want[i].figures)
		}
	}
}

// A day is the tenant's own, so a follow at half past midnight in Seoul is the
// 11th's however UTC dates it, and a day's followers are the ones following at
// its end. A follow that ended after the period was still standing in it, so
// the count it reports does not move when one ends today.
func TestDBAdminAudienceByDayCutsTheTenantsDays(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedAudienceFixture(t, "AUD")
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		DELETE FROM series_follows WHERE tenant_id = $1 AND user_id = $2 AND series_id = $3
	`, f.admin.Tenant.ID, f.readers[2].ID, f.series.ID); err != nil {
		t.Fatalf("unfollow: %v", err)
	}

	res := env.getAudienceStats(t, f.admin, &publiraadminv1.GetAudienceStatsRequest{
		StartDate: "2026-01-10",
		EndDate:   "2026-01-12",
		GroupBy:   publiraadminv1.AudienceGroupBy_AUDIENCE_GROUP_BY_DAY,
	})
	if res.TimeZone != royaltyZoneName {
		t.Fatalf("time zone = %q, want %q", res.TimeZone, royaltyZoneName)
	}
	assertAudienceRows(t, "days", res.Rows, []expectedAudienceRow{
		{"2026-01-10", audienceFigures{1, 1, 0, 40, 4, 3, 15}},
		{"2026-01-11", audienceFigures{3, 2, 0, 60, 6, 2, 10}},
		{"2026-01-12", audienceFigures{4, 1, 0, 100, 10, 1, 5}},
	})
	if got, want := audienceTotalsOf(res.Totals), (audienceFigures{4, 4, 0, 200, 20, 6, 30}); got != want {
		t.Fatalf("totals = %v, want %v", got, want)
	}
	if res.PreviousToken != "" || res.NextToken != "" {
		t.Fatalf("a day report carried tokens %q / %q, want none", res.PreviousToken, res.NextToken)
	}

	narrowed := env.getAudienceStats(t, f.admin, &publiraadminv1.GetAudienceStatsRequest{
		StartDate:      "2026-01-10",
		EndDate:        "2026-01-12",
		GroupBy:        publiraadminv1.AudienceGroupBy_AUDIENCE_GROUP_BY_DAY,
		SeriesPublicId: f.secondSeries.PublicID,
	})
	assertAudienceRows(t, "days of the second series", narrowed.Rows, []expectedAudienceRow{
		{"2026-01-10", audienceFigures{0, 0, 0, 0, 0, 0, 0}},
		{"2026-01-11", audienceFigures{1, 1, 0, 0, 0, 0, 0}},
		{"2026-01-12", audienceFigures{1, 0, 0, 100, 10, 1, 5}},
	})
}

// A follow ended now, by an unfollow or by the account going, is a follow
// ended within a period that reaches today, and the count at its end is the
// readers who still follow.
func TestDBAdminAudienceCountsTheFollowsThatEnded(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedAudienceFixture(t, "AUE")
	tenantID := f.admin.Tenant.ID
	now := time.Now()
	env.follow(t, tenantID, f.readers[3].ID, f.series.ID, now)
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		DELETE FROM series_follows WHERE tenant_id = $1 AND user_id = $2 AND series_id = $3
	`, tenantID, f.readers[2].ID, f.series.ID); err != nil {
		t.Fatalf("unfollow: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), "DELETE FROM users WHERE id = $1", f.readers[1].ID); err != nil {
		t.Fatalf("delete a following reader: %v", err)
	}

	// A day either side of today, so the follow and the two that ended land in
	// the period whichever side of the tenant's midnight the test runs on.
	today := now.In(royaltyZone)
	res := env.getAudienceStats(t, f.admin, &publiraadminv1.GetAudienceStatsRequest{
		StartDate:      today.AddDate(0, 0, -1).Format(time.DateOnly),
		EndDate:        today.AddDate(0, 0, 1).Format(time.DateOnly),
		GroupBy:        publiraadminv1.AudienceGroupBy_AUDIENCE_GROUP_BY_DAY,
		SeriesPublicId: f.series.PublicID,
	})
	if got, want := audienceTotalsOf(res.Totals), (audienceFigures{2, 1, 2, 0, 0, 0, 0}); got != want {
		t.Fatalf("totals = %v, want %v", got, want)
	}
	if first := res.Rows[0]; first.FollowerCount != 3 {
		t.Fatalf("followers at the end of yesterday = %d, want the 3 of January", first.FollowerCount)
	}
}

// A series report holds every series of the tenant, the most followed at the
// end of the period first, with the rating each stands at now; its pages
// follow one another and their tokens belong to the period they were issued
// for.
func TestDBAdminAudienceBySeriesRanksAndPages(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedAudienceFixture(t, "AUF")
	req := func(token string) *publiraadminv1.GetAudienceStatsRequest {
		return &publiraadminv1.GetAudienceStatsRequest{
			StartDate: "2026-01-10",
			EndDate:   "2026-01-12",
			GroupBy:   publiraadminv1.AudienceGroupBy_AUDIENCE_GROUP_BY_SERIES,
			Limit:     2,
			Token:     token,
		}
	}

	first := env.getAudienceStats(t, f.admin, req(""))
	assertAudienceRows(t, "first page", first.Rows, []expectedAudienceRow{
		{f.series.PublicID, audienceFigures{3, 3, 0, 100, 10, 5, 25}},
		{f.secondSeries.PublicID, audienceFigures{1, 1, 0, 100, 10, 1, 5}},
	})
	// Formed over every day the series has, the 13th outside the period
	// included: (20 imagined reads at the tenant's 35/21 + 30 points) /
	// (20 + 11 reads).
	if got := first.Rows[0]; got.SeriesTitle != "Royalty Series" || got.RatingAverage != 2.0 || got.RatingCount != 1 {
		t.Fatalf("first series = %q rated %v by %d, want Royalty Series rated 2.0 by 1", got.SeriesTitle, got.RatingAverage, got.RatingCount)
	}
	if got := first.Rows[1]; got.RatingAverage != 0 || got.RatingCount != 0 {
		t.Fatalf("second series rated %v by %d, want no figure without a reader who reacted", got.RatingAverage, got.RatingCount)
	}
	if got, want := audienceTotalsOf(first.Totals), (audienceFigures{4, 4, 0, 200, 20, 6, 30}); got != want {
		t.Fatalf("totals = %v, want %v", got, want)
	}
	if first.PreviousToken != "" || first.NextToken == "" {
		t.Fatalf("first page tokens = %q / %q, want only a next token", first.PreviousToken, first.NextToken)
	}

	second := env.getAudienceStats(t, f.admin, req(first.NextToken))
	assertAudienceRows(t, "second page", second.Rows, []expectedAudienceRow{
		{f.thirdSeries.PublicID, audienceFigures{0, 0, 0, 0, 0, 0, 0}},
	})
	if second.NextToken != "" || second.PreviousToken == "" {
		t.Fatalf("second page tokens = %q / %q, want only a previous token", second.PreviousToken, second.NextToken)
	}
	back := env.getAudienceStats(t, f.admin, req(second.PreviousToken))
	assertAudienceRows(t, "back to the first page", back.Rows, []expectedAudienceRow{
		{f.series.PublicID, audienceFigures{3, 3, 0, 100, 10, 5, 25}},
		{f.secondSeries.PublicID, audienceFigures{1, 1, 0, 100, 10, 1, 5}},
	})

	moved := req(first.NextToken)
	moved.EndDate = "2026-01-13"
	moved.Tenant = f.admin.tenantContext()
	if _, err := env.engagementClient().GetAudienceStats(testutil.WithBearer(context.Background(), f.admin.token()), moved); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a token used for another period: error = %v, want invalid_argument", err)
	}
}

// A report narrowed to a series the tenant does not have is refused rather than
// answered with zeros a chart would draw as a series nobody follows.
func TestDBAdminAudienceRefusesASeriesTheTenantDoesNotHave(t *testing.T) {
	env := newAdminDBEnv(t)
	f := env.seedAudienceFixture(t, "AUG")
	other := env.seedTenantWithAdmin(t, "AUHTENANT01", "auh.example.com", "Other Tenant", "AUHADMIN001", "admin@auh.example.com")
	theirs := env.PG.SeedSeries(t, other.Tenant.ID, testutil.SeriesSeed{PublicID: "AUHSERIES01", Title: "Their Series"})

	for name, publicID := range map[string]string{"unknown": "NOSUCHSERIES", "another tenant's": theirs.PublicID} {
		_, err := env.engagementClient().GetAudienceStats(testutil.WithBearer(context.Background(), f.admin.token()), &publiraadminv1.GetAudienceStatsRequest{
			Tenant:         f.admin.tenantContext(),
			StartDate:      "2026-01-10",
			EndDate:        "2026-01-12",
			GroupBy:        publiraadminv1.AudienceGroupBy_AUDIENCE_GROUP_BY_DAY,
			SeriesPublicId: publicID,
		})
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s series: error = %v, want not_found", name, err)
		}
	}
}
