package publicapi

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/contentranking"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The ranking list is the one catalogue read whose positions come from another
// tenant-scoped table rather than from the series themselves. The sqlmock tests
// hand the positions straight to the handler, so only these cases show that the
// SQL keeps the snapshot's own numbering, pages through it the way the RPC
// promises, and that RLS keeps one tenant's ranking out of another's chart.

// seedPeriodRankingSnapshot files one snapshot under a ranking key, over the
// single day that many days back, in the order the ids are given. The period
// bounds and computed_at move together with daysAgo, so two calls file two
// snapshots the newest-first read can tell apart. It writes through a
// tenant-scoped connection, so a snapshot RLS would refuse never reaches the
// table in the first place.
func (e *publicDBEnv) seedPeriodRankingSnapshot(
	t *testing.T,
	tenantID uuid.UUID,
	rankingKey string,
	daysAgo int,
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

	e.withTenantConn(t, tenantID, func(ctx context.Context, conn *sql.Conn) {
		_, err := conn.ExecContext(ctx, `
			INSERT INTO content_ranking_snapshots (
				id, tenant_id, ranking_key, period_start, period_end,
				entity_type, items, algorithm_version, computed_at
			) VALUES (
				gen_random_uuid(), $1, $2,
				CURRENT_DATE - $3::int, CURRENT_DATE - $3::int,
				'series', $4::jsonb, $5, now() - make_interval(days => $3::int)
			)
		`, tenantID, rankingKey, daysAgo, items, contentranking.AlgorithmVersion)
		if err != nil {
			t.Fatalf("insert content_ranking_snapshots: %v", err)
		}
	})
}

func (e *publicDBEnv) listRankedSeries(
	t *testing.T,
	req *publirav1.ListRankedSeriesRequest,
) *publirav1.ListRankedSeriesResponse {
	t.Helper()

	resp, err := e.catalogClient().ListRankedSeries(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("ListRankedSeries: %v", err)
	}
	return resp.Msg
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

	env.seedPeriodRankingSnapshot(t, first.ID, contentranking.DailyRankingKey, 1, oldest.ID, middle.ID)
	// The second tenant's ranking names the first tenant's series alongside its
	// own. RLS keeps the snapshot itself tenant-scoped; the scan behind the
	// chart is what has to refuse the series the rank points at.
	env.seedPeriodRankingSnapshot(t, second.ID, contentranking.DailyRankingKey, 1, middle.ID, other.ID)

	ranked := env.listRankedSeries(t, &publirav1.ListRankedSeriesRequest{
		Tenant: tenantContext(first),
	})
	if got, want := rankedPositions(ranked.RankedSeries), []string{"SERIESAOLD01@1", "SERIESAMID01@2"}; !slices.Equal(got, want) {
		t.Fatalf("ranked series = %v, want %v", got, want)
	}
	period := time.Now().AddDate(0, 0, -1).Format(time.DateOnly)
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

	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, 1, top.ID, withdrawn.ID, tail.ID)

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
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, 1, ranked...)

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
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, 2, slipped.ID, climbed.ID)
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, 1, climbed.ID, slipped.ID, entered.ID)
	// The weekly chart of the same days must not be read as an earlier daily
	// snapshot: the two are separate histories.
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.WeeklyRankingKey, 1, entered.ID)

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
