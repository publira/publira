package publicapi

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/ageverification"
	"github.com/publira/publira/server/internal/contentranking"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The ranking list is the one catalogue read whose positions come from another
// tenant-scoped table rather than from the series themselves. The sqlmock tests
// hand the positions straight to the handler, so only these cases show that the
// SQL keeps the snapshot's own numbering, pages through it the way the RPC
// promises, and that RLS keeps one tenant's ranking out of another's chart.

// rankingPeriodDate is the calendar day a seeded snapshot covers, counted back
// from a fixed date. The date is fixed rather than derived from a clock so that
// the day a test seeds and the day it asserts are the same one: CURRENT_DATE is
// the database session's day and time.Now is the process's, and the two part
// company at a midnight boundary or under a different time zone.
func rankingPeriodDate(daysBack int) time.Time {
	return time.Date(2026, time.March, 14, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -daysBack)
}

// seedPeriodRankingSnapshot files one tenant-wide all-ages snapshot under a
// ranking key, over the single day given, in the order the ids are given, for
// each surface alike. computed_at follows the period, so snapshots of older
// periods are also the older computations.
func (e *publicDBEnv) seedPeriodRankingSnapshot(
	t *testing.T,
	tenantID uuid.UUID,
	rankingKey string,
	period time.Time,
	seriesIDs ...uuid.UUID,
) {
	t.Helper()
	e.seedLeaderboardSnapshot(t, tenantID, uuid.NullUUID{}, ageverification.RatingAll, rankingKey, period, seriesIDs...)
}

// seedRatedPeriodRankingSnapshot is seedPeriodRankingSnapshot for the
// tenant-wide ranking of one age rating.
func (e *publicDBEnv) seedRatedPeriodRankingSnapshot(
	t *testing.T,
	tenantID uuid.UUID,
	ageRating string,
	rankingKey string,
	period time.Time,
	seriesIDs ...uuid.UUID,
) {
	t.Helper()
	e.seedLeaderboardSnapshot(t, tenantID, uuid.NullUUID{}, ageRating, rankingKey, period, seriesIDs...)
}

// seedGenrePeriodRankingSnapshot is seedPeriodRankingSnapshot for one genre's
// ranking, which is only ever all-ages. A null genre is the tenant-wide
// ranking.
func (e *publicDBEnv) seedGenrePeriodRankingSnapshot(
	t *testing.T,
	tenantID uuid.UUID,
	genreID uuid.NullUUID,
	rankingKey string,
	period time.Time,
	seriesIDs ...uuid.UUID,
) {
	t.Helper()
	e.seedLeaderboardSnapshot(t, tenantID, genreID, ageverification.RatingAll, rankingKey, period, seriesIDs...)
}

func (e *publicDBEnv) seedLeaderboardSnapshot(
	t *testing.T,
	tenantID uuid.UUID,
	genreID uuid.NullUUID,
	ageRating string,
	rankingKey string,
	period time.Time,
	seriesIDs ...uuid.UUID,
) {
	t.Helper()

	items := "["
	for i, seriesID := range seriesIDs {
		if i > 0 {
			items += ","
		}
		items += fmt.Sprintf(`{"rank":%d,"entity_id":%q,"score":%d}`, i+1, seriesID, len(seriesIDs)-i)
	}
	items += "]"

	for _, surface := range []string{"web", "app"} {
		if _, err := e.PG.DB.ExecContext(context.Background(), `
			INSERT INTO content_ranking_snapshots (
				id, tenant_id, ranking_key, period_start, period_end,
				entity_type, items, algorithm_version, computed_at, genre_id, surface, age_rating
			) VALUES (
				uuidv7(), $1, $2, $3::date, $3::date,
				'series', $4::jsonb, $5, $3::date + interval '1 day', $6, $7, $8
			)
		`, tenantID, rankingKey, period.Format(time.DateOnly), items, contentranking.AlgorithmVersion, genreID, surface, ageRating); err != nil {
			t.Fatalf("insert content_ranking_snapshots: %v", err)
		}
	}
}

func (e *publicDBEnv) listRankedSeries(
	t *testing.T,
	req *publirav1.ListRankedSeriesRequest,
) *publirav1.ListRankedSeriesResponse {
	t.Helper()

	resp, err := e.catalogClient().ListRankedSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}
	return resp
}

func TestDBListRankedSeriesKeepsSnapshotOrderAndTenantsApart(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	// Ranked oldest-first and published oldest-last, so the ranking order
	// cannot be mistaken for publication order.
	oldest := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAOLD01",
		Title:       "Read By Everyone",
		Published:   true,
		PublishedAt: time.Now().Add(-72 * time.Hour),
	})
	middle := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAMID01",
		Title:       "Read By Some",
		Published:   true,
		PublishedAt: time.Now().Add(-48 * time.Hour),
	})
	// Published but never ranked: the chart shows the snapshot, not the
	// catalogue, so this one has no position and must not appear.
	env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID:    "SERIESANEW01",
		Title:       "Read By Nobody Yet",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})
	other := env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{
		PublicID:    "SERIESBNEW01",
		Title:       "Another Tenant's Series",
		Published:   true,
		PublishedAt: time.Now().Add(-1 * time.Hour),
	})

	env.seedPeriodRankingSnapshot(t, first.ID, contentranking.DailyRankingKey, rankingPeriodDate(0), oldest.ID, middle.ID)
	// The second tenant's ranking names the first tenant's series alongside its
	// own. RLS keeps the snapshot itself tenant-scoped; the scan behind the
	// chart is what has to refuse the series the rank points at.
	env.seedPeriodRankingSnapshot(t, second.ID, contentranking.DailyRankingKey, rankingPeriodDate(0), middle.ID, other.ID)

	ranked := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Tenant: tenantContext(first),
	})
	if got, want := rankedPositions(ranked.RankedSeries), []string{"SERIESAOLD01@1", "SERIESAMID01@2"}; !slices.Equal(got, want) {
		t.Fatalf("ranked series = %v, want %v", got, want)
	}
	period := rankingPeriodDate(0).Format(time.DateOnly)
	if ranked.PeriodStart != period || ranked.PeriodEnd != period {
		t.Fatalf("period = %q..%q, want %q on both sides", ranked.PeriodStart, ranked.PeriodEnd, period)
	}
	if ranked.ComputedAt == "" {
		t.Fatalf("computed_at is empty, want the time the snapshot was written")
	}

	crossTenant := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Tenant: tenantContext(second),
	})
	// Position 1 pointed at a series this tenant does not own, so it drops out
	// and leaves its position empty rather than promoting position 2.
	if got, want := rankedPositions(crossTenant.RankedSeries), []string{"SERIESBNEW01@2"}; !slices.Equal(got, want) {
		t.Fatalf("ranked series = %v, want %v", got, want)
	}
}

func TestDBListRankedSeriesLeavesTheGapWhereASeriesWasUnpublished(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	top := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESATOP01",
		Title:       "Still Published",
		Published:   true,
		PublishedAt: time.Now().Add(-72 * time.Hour),
	})
	// Ranked while it was published, taken down since. A snapshot describes a
	// past window, so the positions around it do not close up over the gap.
	withdrawn := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESAWDR01",
		Title:    "Taken Down Since",
	})
	tail := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESATAI01",
		Title:       "Still Published Too",
		Published:   true,
		PublishedAt: time.Now().Add(-48 * time.Hour),
	})

	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(0), top.ID, withdrawn.ID, tail.ID)

	resp := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Tenant: tenantContext(tenant),
	})
	if got, want := rankedPositions(resp.RankedSeries), []string{"SERIESATOP01@1", "SERIESATAI01@3"}; !slices.Equal(got, want) {
		t.Fatalf("ranked series = %v, want %v", got, want)
	}
}

func TestDBListRankedSeriesPagesThroughTheSnapshotBothWays(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	ranked := make([]uuid.UUID, 0, 3)
	for i, publicID := range []string{"SERIESAONE01", "SERIESATWO01", "SERIESATRI01"} {
		series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:    publicID,
			Title:       fmt.Sprintf("Ranked %d", i+1),
			Published:   true,
			PublishedAt: time.Now().Add(-time.Duration(i+1) * time.Hour),
		})
		ranked = append(ranked, series.ID)
	}
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(0), ranked...)

	first := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Limit:  2,
		Tenant: tenantContext(tenant),
	})
	if got, want := rankedPositions(first.RankedSeries), []string{"SERIESAONE01@1", "SERIESATWO01@2"}; !slices.Equal(got, want) {
		t.Fatalf("first page = %v, want %v", got, want)
	}
	if first.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", first.PreviousToken)
	}

	second := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Limit:  2,
		Tenant: tenantContext(tenant),
		Token:  first.NextToken,
	})
	if got, want := rankedPositions(second.RankedSeries), []string{"SERIESATRI01@3"}; !slices.Equal(got, want) {
		t.Fatalf("second page = %v, want %v", got, want)
	}
	if second.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", second.NextToken)
	}

	// Walking back over the same boundary has to land on the page just left.
	back := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Limit:  2,
		Tenant: tenantContext(tenant),
		Token:  second.PreviousToken,
	})
	if got, want := rankedPositions(back.RankedSeries), []string{"SERIESAONE01@1", "SERIESATWO01@2"}; !slices.Equal(got, want) {
		t.Fatalf("page walked back to = %v, want %v", got, want)
	}
}

func TestDBListRankedSeriesKeepsPagingInsideTheSnapshotItStartedIn(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	ranked := make([]uuid.UUID, 0, 3)
	for i, publicID := range []string{"SERIESAONE01", "SERIESATWO01", "SERIESATRI01"} {
		series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:    publicID,
			Title:       fmt.Sprintf("Ranked %d", i+1),
			Published:   true,
			PublishedAt: time.Now().Add(-time.Duration(i+1) * time.Hour),
		})
		ranked = append(ranked, series.ID)
	}
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(1), ranked...)

	first := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Limit:  2,
		Tenant: tenantContext(tenant),
	})
	if got, want := rankedPositions(first.RankedSeries), []string{"SERIESAONE01@1", "SERIESATWO01@2"}; !slices.Equal(got, want) {
		t.Fatalf("first page = %v, want %v", got, want)
	}

	// The batch lands between the two pages and reverses the chart. Page 2 was
	// asked for as a position in the ranking page 1 showed, so it has to come
	// from that ranking: read against the new one, position 2 is a different
	// series and the page would repeat what the reader has already seen.
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(0),
		ranked[2], ranked[1], ranked[0])

	second := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Limit:  2,
		Tenant: tenantContext(tenant),
		Token:  first.NextToken,
	})
	if got, want := rankedPositions(second.RankedSeries), []string{"SERIESATRI01@3"}; !slices.Equal(got, want) {
		t.Fatalf("second page = %v, want %v (the ranking page 1 came from)", got, want)
	}
	if second.PeriodStart != first.PeriodStart || second.ComputedAt != first.ComputedAt {
		t.Fatalf("second page reports %q/%q, want the first page's %q/%q",
			second.PeriodStart, second.ComputedAt, first.PeriodStart, first.ComputedAt)
	}

	// A request without a token is a fresh read, and gets the new chart.
	fresh := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Limit:  2,
		Tenant: tenantContext(tenant),
	})
	if got, want := rankedPositions(fresh.RankedSeries), []string{"SERIESATRI01@1", "SERIESATWO01@2"}; !slices.Equal(got, want) {
		t.Fatalf("fresh first page = %v, want %v", got, want)
	}
}

func TestDBListRankedSeriesReportsMovementAgainstTheEarlierSnapshot(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	climbed := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAUPP01",
		Title:       "Climbed",
		Published:   true,
		PublishedAt: time.Now().Add(-72 * time.Hour),
	})
	slipped := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESADWN01",
		Title:       "Slipped",
		Published:   true,
		PublishedAt: time.Now().Add(-48 * time.Hour),
	})
	entered := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESANEW01",
		Title:       "New Entry",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})

	// Two days back is the snapshot the movement is measured from; one day
	// back is the one the chart shows.
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(1), slipped.ID, climbed.ID)
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(0), climbed.ID, slipped.ID, entered.ID)
	// The weekly chart of the same days must not be read as an earlier daily
	// snapshot: the two are separate histories.
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.WeeklyRankingKey, rankingPeriodDate(0), entered.ID)

	resp := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Period: publirav1.RankingPeriod_RANKING_PERIOD_DAILY,
		Tenant: tenantContext(tenant),
	})
	if got, want := rankedPositions(resp.RankedSeries), []string{"SERIESAUPP01@1", "SERIESADWN01@2", "SERIESANEW01@3"}; !slices.Equal(got, want) {
		t.Fatalf("ranked series = %v, want %v", got, want)
	}
	if got := resp.RankedSeries[0].GetPreviousRank(); got != 2 {
		t.Fatalf("previous_rank of the climber = %d, want 2", got)
	}
	if got := resp.RankedSeries[1].GetPreviousRank(); got != 1 {
		t.Fatalf("previous_rank of the slipper = %d, want 1", got)
	}
	if resp.RankedSeries[2].PreviousRank != nil {
		t.Fatalf("previous_rank of the new entry = %d, want absent", resp.RankedSeries[2].GetPreviousRank())
	}

	weekly := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Period: publirav1.RankingPeriod_RANKING_PERIOD_WEEKLY,
		Tenant: tenantContext(tenant),
	})
	if got, want := rankedPositions(weekly.RankedSeries), []string{"SERIESANEW01@1"}; !slices.Equal(got, want) {
		t.Fatalf("weekly ranked series = %v, want %v", got, want)
	}
	// The weekly chart has one snapshot of its own, so nothing to compare with.
	if weekly.RankedSeries[0].PreviousRank != nil {
		t.Fatalf("weekly previous_rank = %d, want absent", weekly.RankedSeries[0].GetPreviousRank())
	}
}

func TestDBListRankedSeriesReadsOnlyTheTenantWideRanking(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	genre := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{Name: "Action"})
	genreID := uuid.NullUUID{UUID: genre.ID, Valid: true}

	first := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAONE01",
		Title:       "First Overall",
		Published:   true,
		PublishedAt: time.Now().Add(-72 * time.Hour),
	})
	second := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESATWO01",
		Title:       "Second Overall",
		Published:   true,
		PublishedAt: time.Now().Add(-48 * time.Hour),
	})

	// The genre's ranking holds the newest period and the one before the
	// tenant-wide chart's, so either would be read if the chart did not keep
	// to the tenant-wide ranking.
	env.seedGenrePeriodRankingSnapshot(t, tenant.ID, genreID, contentranking.DailyRankingKey, rankingPeriodDate(2), first.ID, second.ID)
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(1), first.ID, second.ID)
	env.seedGenrePeriodRankingSnapshot(t, tenant.ID, genreID, contentranking.DailyRankingKey, rankingPeriodDate(0), second.ID)

	resp := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Tenant: tenantContext(tenant),
	})
	if got, want := rankedPositions(resp.RankedSeries), []string{"SERIESAONE01@1", "SERIESATWO01@2"}; !slices.Equal(got, want) {
		t.Fatalf("ranked series = %v, want %v", got, want)
	}
	if period := rankingPeriodDate(1).Format(time.DateOnly); resp.PeriodStart != period {
		t.Fatalf("period_start = %q, want %q", resp.PeriodStart, period)
	}
	for _, series := range resp.RankedSeries {
		if series.PreviousRank != nil {
			t.Fatalf("previous_rank = %d, want absent: the tenant-wide ranking has no earlier period", series.GetPreviousRank())
		}
	}
}

func TestDBListRankedSeriesReturnsAnEmptyListWithoutASnapshot(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	// A published catalogue the batch has not ranked yet. Nothing computed is
	// an empty chart, not a failure, and not the catalogue in some other order.
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESANEW01",
		Title:       "Published, Never Ranked",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})

	resp := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Tenant: tenantContext(tenant),
	})
	if len(resp.RankedSeries) != 0 {
		t.Fatalf("ranked_series = %v, want an empty list", rankedPositions(resp.RankedSeries))
	}
	if resp.ComputedAt != "" || resp.PeriodStart != "" || resp.PeriodEnd != "" {
		t.Fatalf("computed_at = %q, period = %q..%q, want all empty without a snapshot",
			resp.ComputedAt, resp.PeriodStart, resp.PeriodEnd)
	}
}

// The batch cuts each surface a leaderboard of its own, so a tenant whose
// leading series only the app may show still gives the web a chart in
// consecutive positions, and each surface's genre tiles and recommendations
// their own order.
func TestDBRankingReadsTheLeaderboardOfTheCallingSurface(t *testing.T) {
	env := newPublicDBEnv(t)
	ctx := context.Background()
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	drama := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREDRAMA01", Name: "Drama", DisplayOrder: 1})

	// Ranked oldest-first, so an order other than newest-first can only come
	// from a leaderboard.
	now := time.Now()
	seed := func(publicID string, daysAgo int, availability string, views int64) {
		series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:     publicID,
			Title:        publicID,
			Published:    true,
			PublishedAt:  now.Add(-time.Duration(daysAgo) * 24 * time.Hour),
			Availability: availability,
		})
		env.PG.SeedSeriesGenre(t, tenant.ID, series.ID, drama.ID)
		if views == 0 {
			return
		}
		if _, err := env.PG.DB.ExecContext(ctx, `
			INSERT INTO content_daily_stats (id, tenant_id, stat_date, entity_type, entity_id, view_count)
			VALUES (uuidv7(), $1, $2::date, 'series', $3, $4)
		`, tenant.ID, rankingPeriodDate(0).Format(time.DateOnly), series.ID, views); err != nil {
			t.Fatalf("insert content_daily_stats: %v", err)
		}
	}
	seed("APPFIRST0001", 9, "app", 100)
	seed("APPSECOND001", 8, "app", 90)
	seed("WEBONLY00001", 7, "web", 20)
	seed("BOTHSURFACE1", 6, "", 10)
	seed("UNRANKED0001", 1, "", 0)

	// Two places: a leaderboard shared by both surfaces would hold only the
	// app-only series and leave the web nothing to show.
	options := contentranking.Options{ReferenceDate: rankingPeriodDate(0), ItemLimit: 2}
	if _, err := contentranking.New(env.PG.OpenPlatformDB(t)).Run(ctx, options); err != nil {
		t.Fatalf("rank: %v", err)
	}

	for _, tc := range []struct {
		name    string
		surface publirattypesv1.ClientSurface
		ranked  []string
		ordered []string
	}{
		{
			name:    "web",
			surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB,
			ranked:  []string{"WEBONLY00001@1", "BOTHSURFACE1@2"},
			ordered: []string{"WEBONLY00001", "BOTHSURFACE1", "UNRANKED0001"},
		},
		{
			name:    "app",
			surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_APP,
			ranked:  []string{"APPFIRST0001@1", "APPSECOND001@2"},
			ordered: []string{"APPFIRST0001", "APPSECOND001", "UNRANKED0001", "BOTHSURFACE1"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// One position per page, so the second page is read from the
			// snapshot the first one pinned.
			first := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
				Tenant:  tenantContext(tenant),
				Surface: tc.surface,
				Limit:   1,
			})
			second := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
				Tenant:  tenantContext(tenant),
				Surface: tc.surface,
				Limit:   1,
				Token:   first.NextToken,
			})
			ranked := append(rankedPositions(first.RankedSeries), rankedPositions(second.RankedSeries)...)
			if !slices.Equal(ranked, tc.ranked) {
				t.Fatalf("ranked series = %v, want %v", ranked, tc.ranked)
			}
			if second.NextToken != "" {
				t.Fatalf("next_token after the last position = %q, want empty", second.NextToken)
			}

			genres, err := env.catalogClient().ListPublishedGenres(ctx, &publirav1.ListPublishedGenresRequest{
				Tenant:  tenantContext(tenant),
				Surface: tc.surface,
			})
			if err != nil {
				t.Fatalf("ListPublishedGenres: %v", err)
			}
			if got := featuredSeriesPublicIDs(genres.Genres[0]); !slices.Equal(got, tc.ordered) {
				t.Fatalf("Drama featured_series = %v, want %v", got, tc.ordered)
			}

			recommended := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{
				Tenant:  tenantContext(tenant),
				Surface: tc.surface,
			})
			got := make([]string, 0, len(recommended.Series))
			for _, series := range recommended.Series {
				got = append(got, series.PublicId)
			}
			if !slices.Equal(got, tc.ordered) {
				t.Fatalf("recommended series = %v, want %v", got, tc.ordered)
			}
		})
	}
}

// The batch ranks each age rating on its own, so a rating's chart runs in
// consecutive positions however the ratings are mixed in the catalogue, the
// default chart names no rated work, and the recommendation order still ranks
// the whole catalogue together.
func TestDBRankingCutsALeaderboardPerAgeRating(t *testing.T) {
	env := newPublicDBEnv(t)
	ctx := context.Background()
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	now := time.Now()
	seed := func(publicID, ageRating string, views int64) {
		series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:    publicID,
			Title:       publicID,
			Published:   true,
			PublishedAt: now.Add(-24 * time.Hour),
			AgeRating:   ageRating,
		})
		if _, err := env.PG.DB.ExecContext(ctx, `
			INSERT INTO content_daily_stats (id, tenant_id, stat_date, entity_type, entity_id, view_count)
			VALUES (uuidv7(), $1, $2::date, 'series', $3, $4)
		`, tenant.ID, rankingPeriodDate(0).Format(time.DateOnly), series.ID, views); err != nil {
			t.Fatalf("insert content_daily_stats: %v", err)
		}
	}
	seed("R18FIRST0001", ageverification.RatingR18, 100)
	seed("R15FIRST0001", ageverification.RatingR15, 90)
	seed("ALLFIRST0001", ageverification.RatingAll, 80)
	seed("R18SECOND001", ageverification.RatingR18, 70)
	seed("ALLSECOND001", ageverification.RatingAll, 60)

	options := contentranking.Options{ReferenceDate: rankingPeriodDate(0)}
	if _, err := contentranking.New(env.PG.OpenPlatformDB(t)).Run(ctx, options); err != nil {
		t.Fatalf("rank: %v", err)
	}

	for _, tc := range []struct {
		name      string
		ageRating publirattypesv1.SeriesAgeRating
		want      []string
	}{
		{
			name: "unspecified is all-ages",
			want: []string{"ALLFIRST0001@1", "ALLSECOND001@2"},
		},
		{
			name:      "r15",
			ageRating: publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R15,
			want:      []string{"R15FIRST0001@1"},
		},
		{
			name:      "r18",
			ageRating: publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R18,
			want:      []string{"R18FIRST0001@1", "R18SECOND001@2"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
				Tenant:    tenantContext(tenant),
				AgeRating: tc.ageRating,
			})
			if got := rankedPositions(resp.RankedSeries); !slices.Equal(got, tc.want) {
				t.Fatalf("ranked series = %v, want %v", got, tc.want)
			}
		})
	}

	recommended := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{
		Tenant: tenantContext(tenant),
	})
	got := make([]string, 0, len(recommended.Series))
	for _, series := range recommended.Series {
		got = append(got, series.PublicId)
	}
	if want := []string{"R18FIRST0001", "R15FIRST0001", "ALLFIRST0001", "R18SECOND001", "ALLSECOND001"}; !slices.Equal(got, want) {
		t.Fatalf("recommended series = %v, want %v", got, want)
	}
}

func TestDBListRankedSeriesAppliesTheTenantAgeRule(t *testing.T) {
	tests := []struct {
		name      string
		rule      string
		ageRating publirattypesv1.SeriesAgeRating
		// signedIn sends the request as a reader, aged age when hasBirthDate is
		// set; a guest sends no bearer at all.
		signedIn     bool
		hasBirthDate bool
		age          int
		wantCode     connect.Code
		wantPrivate  bool
	}{
		{
			name:      "a tenant verifying nothing shows a rated chart to a guest",
			rule:      ageverification.None,
			ageRating: publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R18,
		},
		{
			name:      "a guest is refused a chart the rule covers",
			rule:      ageverification.R18,
			ageRating: publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R18,
			wantCode:  connect.CodePermissionDenied,
		},
		{
			name:      "so is a reader who has given no birth date",
			rule:      ageverification.R18,
			ageRating: publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R18,
			signedIn:  true,
			wantCode:  connect.CodePermissionDenied,
		},
		{
			name:         "and a reader who is seventeen",
			rule:         ageverification.R18,
			ageRating:    publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R18,
			signedIn:     true,
			hasBirthDate: true,
			age:          17,
			wantCode:     connect.CodePermissionDenied,
		},
		{
			name:         "a reader who is eighteen gets the chart, privately",
			rule:         ageverification.R18,
			ageRating:    publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R18,
			signedIn:     true,
			hasBirthDate: true,
			age:          18,
			wantPrivate:  true,
		},
		{
			name:      "the r18 rule leaves the r15 chart public",
			rule:      ageverification.R18,
			ageRating: publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R15,
		},
		{
			name:      "the wider rule covers the r15 chart as well",
			rule:      ageverification.R15AndR18,
			ageRating: publirattypesv1.SeriesAgeRating_SERIES_AGE_RATING_R15,
			wantCode:  connect.CodePermissionDenied,
		},
		{
			name: "the all-ages chart asks nothing of anyone",
			rule: ageverification.R15AndR18,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newPublicDBEnv(t)
			tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
			setTenantAgeVerification(t, env, tenant.ID, tt.rule)

			stored, err := protomapper.SeriesAgeRatingToStored(tt.ageRating)
			if err != nil {
				t.Fatalf("SeriesAgeRatingToStored(%v): %v", tt.ageRating, err)
			}
			series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
				PublicID:    "SERIESA00001",
				Title:       "Ranked Series",
				Published:   true,
				PublishedAt: time.Now().Add(-24 * time.Hour),
				AgeRating:   stored,
			})
			env.seedRatedPeriodRankingSnapshot(t, tenant.ID, stored, contentranking.DailyRankingKey, rankingPeriodDate(0), series.ID)

			request := &publirav1.ListRankedSeriesRequest{
				Tenant:    tenantContext(tenant),
				AgeRating: tt.ageRating,
			}
			ctx := context.Background()
			if tt.signedIn {
				reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
				if tt.hasBirthDate {
					setBirthDate(t, env, reader.ID, birthDateForAge(t, tenant, tt.age, false))
				}
				ctx = testutil.WithBearer(ctx, tokenFor(t, tenant, reader))
			}

			respCtx, respCall := testutil.NewClientContext(ctx)
			resp, err := env.catalogClient().ListRankedSeries(respCtx, request)
			if tt.wantCode != 0 {
				if connect.CodeOf(err) != tt.wantCode {
					t.Fatalf("error code = %v (%v), want %v", connect.CodeOf(err), err, tt.wantCode)
				}
				return
			}
			if err != nil {
				t.Fatalf("ListRankedSeries: %v", err)
			}
			if got, want := rankedPositions(resp.RankedSeries), []string{"SERIESA00001@1"}; !slices.Equal(got, want) {
				t.Fatalf("ranked series = %v, want %v", got, want)
			}
			if got := respCall.ResponseHeader().Get("Cache-Control"); (got == "private, no-store") != tt.wantPrivate {
				t.Fatalf("Cache-Control = %q, want private: %v", got, tt.wantPrivate)
			}
		})
	}
}

// A series re-rated since the batch ran still sits in the snapshot of the
// rating it had, and the read leaves its place empty rather than show it under
// a rating it no longer carries.
func TestDBListRankedSeriesLeavesTheGapWhereASeriesWasReRated(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	seed := func(publicID string) testutil.Series {
		return env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:    publicID,
			Title:       publicID,
			Published:   true,
			PublishedAt: time.Now().Add(-24 * time.Hour),
		})
	}
	top, reRated, tail := seed("SERIESATOP01"), seed("SERIESARATE1"), seed("SERIESATAIL1")
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(0), top.ID, reRated.ID, tail.ID)

	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE series_listings SET age_rating = 'r18' WHERE series_id = $1", reRated.ID,
	); err != nil {
		t.Fatalf("re-rate series: %v", err)
	}

	resp := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{Tenant: tenantContext(tenant)})
	if got, want := rankedPositions(resp.RankedSeries), []string{"SERIESATOP01@1", "SERIESATAIL1@3"}; !slices.Equal(got, want) {
		t.Fatalf("ranked series = %v, want %v", got, want)
	}
}

// A genre's chart is a leaderboard of its own: its first page, a page pinned to
// the snapshot that page came from, and the movement markers all stay inside
// the genre, so a series that climbed among its genre's works shows the climb
// even where the tenant-wide chart did not move it.
func TestDBListRankedSeriesPagesAGenresOwnRanking(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	action := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREACTION1", Name: "Action"})
	drama := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREDRAMA01", Name: "Drama"})
	actionID := uuid.NullUUID{UUID: action.ID, Valid: true}

	seed := func(publicID string) testutil.Series {
		return env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:    publicID,
			Title:       publicID,
			Published:   true,
			PublishedAt: time.Now().Add(-24 * time.Hour),
		})
	}
	outsider := seed("SERIESAOUT01")
	climber, slipper, steady := seed("SERIESAUPP01"), seed("SERIESADWN01"), seed("SERIESASTD01")
	for _, series := range []testutil.Series{climber, slipper, steady} {
		env.PG.SeedSeriesGenre(t, tenant.ID, series.ID, action.ID)
	}

	// Tenant-wide, nothing moved between the two periods. Within Action, the
	// climber overtook the slipper.
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(2),
		outsider.ID, climber.ID, slipper.ID, steady.ID)
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(1),
		outsider.ID, climber.ID, slipper.ID, steady.ID)
	env.seedGenrePeriodRankingSnapshot(t, tenant.ID, actionID, contentranking.DailyRankingKey, rankingPeriodDate(2),
		slipper.ID, climber.ID, steady.ID)
	env.seedGenrePeriodRankingSnapshot(t, tenant.ID, actionID, contentranking.DailyRankingKey, rankingPeriodDate(1),
		climber.ID, slipper.ID, steady.ID)

	first := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		GenrePublicId: action.PublicID,
		Limit:         2,
		Tenant:        tenantContext(tenant),
	})
	if got, want := rankedPositions(first.RankedSeries), []string{"SERIESAUPP01@1", "SERIESADWN01@2"}; !slices.Equal(got, want) {
		t.Fatalf("first page = %v, want %v", got, want)
	}
	if got := first.RankedSeries[0].GetPreviousRank(); got != 2 {
		t.Fatalf("previous_rank of the climber = %d, want 2 (its place in the genre)", got)
	}
	if got := first.RankedSeries[1].GetPreviousRank(); got != 1 {
		t.Fatalf("previous_rank of the slipper = %d, want 1 (its place in the genre)", got)
	}
	if period := rankingPeriodDate(1).Format(time.DateOnly); first.PeriodStart != period || first.PeriodEnd != period {
		t.Fatalf("period = %q..%q, want %q on both sides", first.PeriodStart, first.PeriodEnd, period)
	}
	if want := rankingPeriodDate(0).Format(time.RFC3339); first.ComputedAt != want {
		t.Fatalf("computed_at = %q, want %q", first.ComputedAt, want)
	}

	// The batch lands between the two pages and reverses the genre's chart.
	// Page 2 continues in the snapshot page 1 came from.
	env.seedGenrePeriodRankingSnapshot(t, tenant.ID, actionID, contentranking.DailyRankingKey, rankingPeriodDate(0),
		steady.ID, slipper.ID, climber.ID)

	second := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		GenrePublicId: action.PublicID,
		Limit:         2,
		Tenant:        tenantContext(tenant),
		Token:         first.NextToken,
	})
	if got, want := rankedPositions(second.RankedSeries), []string{"SERIESASTD01@3"}; !slices.Equal(got, want) {
		t.Fatalf("second page = %v, want %v (the ranking page 1 came from)", got, want)
	}
	if got := second.RankedSeries[0].GetPreviousRank(); got != 3 {
		t.Fatalf("previous_rank on the pinned page = %d, want 3", got)
	}
	if second.PeriodStart != first.PeriodStart || second.ComputedAt != first.ComputedAt {
		t.Fatalf("second page reports %q/%q, want the first page's %q/%q",
			second.PeriodStart, second.ComputedAt, first.PeriodStart, first.ComputedAt)
	}

	// The tenant-wide chart is untouched by the genre's: same positions, and
	// the climber has not moved there.
	overall := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{Tenant: tenantContext(tenant)})
	if got, want := rankedPositions(overall.RankedSeries),
		[]string{"SERIESAOUT01@1", "SERIESAUPP01@2", "SERIESADWN01@3", "SERIESASTD01@4"}; !slices.Equal(got, want) {
		t.Fatalf("tenant-wide ranked series = %v, want %v", got, want)
	}
	if got := overall.RankedSeries[1].GetPreviousRank(); got != 2 {
		t.Fatalf("tenant-wide previous_rank of the climber = %d, want 2", got)
	}

	// A genre's token continues that genre's chart and nothing else.
	for _, genre := range []string{"", drama.PublicID} {
		_, err := env.catalogClient().ListRankedSeries(context.Background(), &publirav1.ListRankedSeriesRequest{
			GenrePublicId: genre,
			Limit:         2,
			Tenant:        tenantContext(tenant),
			Token:         first.NextToken,
		})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("Action's token under genre %q: error code = %v, want InvalidArgument", genre, connect.CodeOf(err))
		}
	}
}

// A genre the batch has not ranked yet — Drama here, created after the last
// run — answers an empty chart, as a tenant with no snapshot does, and never
// the tenant-wide ranking in its place.
func TestDBListRankedSeriesReturnsAnEmptyListForAGenreWithoutASnapshot(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	drama := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREDRAMA01", Name: "Drama"})

	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESADRM01",
		Title:       "Drama",
		Published:   true,
		PublishedAt: time.Now().Add(-24 * time.Hour),
	})
	env.PG.SeedSeriesGenre(t, tenant.ID, series.ID, drama.ID)
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(0), series.ID)

	resp := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		GenrePublicId: drama.PublicID,
		Tenant:        tenantContext(tenant),
	})
	if len(resp.RankedSeries) != 0 || resp.ComputedAt != "" || resp.NextToken != "" {
		t.Fatalf("ranked_series = %v, computed_at = %q, next_token = %q, want an empty chart",
			rankedPositions(resp.RankedSeries), resp.ComputedAt, resp.NextToken)
	}
}

// A series taken out of the genre since the batch ran still sits in the
// genre's snapshot, and the read leaves its place empty rather than rank it
// under a genre it no longer carries.
func TestDBListRankedSeriesLeavesTheGapWhereASeriesLeftTheGenre(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	action := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREACTION1", Name: "Action"})

	seed := func(publicID string) testutil.Series {
		series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:    publicID,
			Title:       publicID,
			Published:   true,
			PublishedAt: time.Now().Add(-24 * time.Hour),
		})
		env.PG.SeedSeriesGenre(t, tenant.ID, series.ID, action.ID)
		return series
	}
	top, moved, tail := seed("SERIESATOP01"), seed("SERIESAMOVE1"), seed("SERIESATAIL1")
	env.seedGenrePeriodRankingSnapshot(t, tenant.ID, uuid.NullUUID{UUID: action.ID, Valid: true},
		contentranking.DailyRankingKey, rankingPeriodDate(0), top.ID, moved.ID, tail.ID)

	if _, err := env.PG.DB.ExecContext(context.Background(),
		"DELETE FROM series_genres WHERE series_id = $1 AND genre_id = $2", moved.ID, action.ID,
	); err != nil {
		t.Fatalf("remove series from genre: %v", err)
	}

	resp := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		GenrePublicId: action.PublicID,
		Tenant:        tenantContext(tenant),
	})
	if got, want := rankedPositions(resp.RankedSeries), []string{"SERIESATOP01@1", "SERIESATAIL1@3"}; !slices.Equal(got, want) {
		t.Fatalf("ranked series = %v, want %v", got, want)
	}
}

// A genre is read through the tenant, so another tenant's genre is as absent
// as one that was never created.
func TestDBListRankedSeriesRejectsAnotherTenantsGenre(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	foreign := env.PG.SeedGenre(t, second.ID, testutil.GenreSeed{PublicID: "GENREFOREIGN", Name: "Foreign"})

	for _, genre := range []string{foreign.PublicID, "GENRENOWHERE"} {
		_, err := env.catalogClient().ListRankedSeries(context.Background(), &publirav1.ListRankedSeriesRequest{
			GenrePublicId: genre,
			Tenant:        tenantContext(first),
		})
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("genre %q: error code = %v, want NotFound", genre, connect.CodeOf(err))
		}
	}
}
