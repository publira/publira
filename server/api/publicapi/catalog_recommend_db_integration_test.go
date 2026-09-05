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

// The recommendation list is the one catalogue read whose order comes from
// another tenant-scoped table, and the only one whose sort key is derived from
// JSONB rather than from a column. The sqlmock tests hand the ordered ids
// straight to the handler, so only these cases show that the SQL orders and
// pages the way the RPC promises, and that RLS keeps one tenant's ranking out
// of another tenant's storefront.

// seedRankingSnapshot files one weekly series ranking for the tenant, in the
// order the ids are given. It writes through a tenant-scoped connection, so a
// snapshot that RLS would refuse never reaches the table in the first place.
func (e *publicDBEnv) seedRankingSnapshot(t *testing.T, tenantID uuid.UUID, seriesIDs ...uuid.UUID) {
	t.Helper()

	items := "["
	for i, seriesID := range seriesIDs {
		if i > 0 {
			items += ","
		}
		items += fmt.Sprintf(`{"rank":%d,"entity_id":%q,"score":%d}`, i+1, seriesID, len(seriesIDs)-i)
	}
	items += "]"
	e.seedRawRankingSnapshot(t, tenantID, items)
}

// seedRawRankingSnapshot files an items array verbatim, so a test can seed one
// the batch would never write.
func (e *publicDBEnv) seedRawRankingSnapshot(t *testing.T, tenantID uuid.UUID, items string) {
	t.Helper()

	e.withTenantConn(t, tenantID, func(ctx context.Context, conn *sql.Conn) {
		_, err := conn.ExecContext(ctx, `
			INSERT INTO content_ranking_snapshots (
				id, tenant_id, ranking_key, period_start, period_end,
				entity_type, items, algorithm_version, computed_at
			) VALUES (
				gen_random_uuid(), $1, $2, CURRENT_DATE - 6, CURRENT_DATE,
				'series', $3::jsonb, $4, now()
			)
		`, tenantID, contentranking.WeeklyRankingKey, items, contentranking.AlgorithmVersion)
		if err != nil {
			t.Fatalf("insert content_ranking_snapshots: %v", err)
		}
	})
}

func (e *publicDBEnv) listRecommendedSeries(
	t *testing.T,
	req *publirav1.ListRecommendedSeriesRequest,
) *publirav1.ListRecommendedSeriesResponse {
	t.Helper()

	resp, err := e.catalogClient().ListRecommendedSeries(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("ListRecommendedSeries: %v", err)
	}
	return resp.Msg
}

func TestDBListRecommendedSeriesOrdersBySignalsAndKeepsTenantsApart(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	// Newest last, so a ranking that puts the oldest series first cannot be
	// mistaken for the new-arrival order the list falls back on.
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
	newest := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
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

	env.seedRankingSnapshot(t, first.ID, oldest.ID, middle.ID)
	// The second tenant's ranking names a series it does not own. RLS keeps the
	// snapshot itself tenant-scoped; the scan behind the list is what has to
	// refuse the series the rank points at.
	env.seedRankingSnapshot(t, second.ID, newest.ID)

	ranked := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{
		Tenant: tenantContext(first),
	})
	assertSeriesPublicIDs(t, ranked.Series, "SERIESAOLD01", "SERIESAMID01", "SERIESANEW01")
	if ranked.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_RANKING {
		t.Fatalf("source = %v, want RANKING", ranked.Source)
	}

	crossTenant := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{
		Tenant: tenantContext(second),
	})
	// The rank the second tenant's snapshot carries points at a series the scan
	// will not return, so it changes nothing about the list — its own series is
	// all there is.
	assertSeriesPublicIDs(t, crossTenant.Series, other.PublicID)
}

func TestDBListRecommendedSeriesPagesFromRankedIntoNewArrivals(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	// Ranked oldest-first and published oldest-last, so every page boundary
	// tells the two orders apart.
	rankedSecond := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAOLD01",
		Title:       "Ranked Second",
		Published:   true,
		PublishedAt: time.Now().Add(-96 * time.Hour),
	})
	rankedFirst := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAMID01",
		Title:       "Ranked First",
		Published:   true,
		PublishedAt: time.Now().Add(-72 * time.Hour),
	})
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAUNR01",
		Title:       "Unranked, Older",
		Published:   true,
		PublishedAt: time.Now().Add(-48 * time.Hour),
	})
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAUNR02",
		Title:       "Unranked, Newer",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})

	env.seedRankingSnapshot(t, tenant.ID, rankedFirst.ID, rankedSecond.ID)

	// Page 1 stops inside the ranked run, page 2 crosses out of it, and page 3
	// is entirely new arrivals — the "see more" path.
	first := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{
		Limit:  1,
		Tenant: tenantContext(tenant),
	})
	assertSeriesPublicIDs(t, first.Series, "SERIESAMID01")
	if first.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", first.PreviousToken)
	}

	second := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{
		Limit:  2,
		Tenant: tenantContext(tenant),
		Token:  first.NextToken,
	})
	assertSeriesPublicIDs(t, second.Series, "SERIESAOLD01", "SERIESAUNR02")

	third := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{
		Limit:  2,
		Tenant: tenantContext(tenant),
		Token:  second.NextToken,
	})
	assertSeriesPublicIDs(t, third.Series, "SERIESAUNR01")
	if third.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", third.NextToken)
	}

	// Walking back over the same boundary has to land on the page that was
	// just left, ranked run included.
	back := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{
		Limit:  2,
		Tenant: tenantContext(tenant),
		Token:  third.PreviousToken,
	})
	assertSeriesPublicIDs(t, back.Series, "SERIESAOLD01", "SERIESAUNR02")
}

// The query decides a rank by folding the snapshot with min() per entity_id and
// coalescing a missing one to the unranked sentinel. The cursor has to agree
// with that exactly, which is why the rank travels back with each row instead of
// being recomputed from the same JSON. A snapshot that folds ambiguously is what
// tells the two apart.
func TestDBListRecommendedSeriesPagesConsistentlyOverAnAmbiguousSnapshot(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	duplicated := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESADUP01",
		Title:       "Named Twice",
		Published:   true,
		PublishedAt: time.Now().Add(-72 * time.Hour),
	})
	rankless := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESANOR01",
		Title:       "Named Without A Rank",
		Published:   true,
		PublishedAt: time.Now().Add(-48 * time.Hour),
	})
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESANEW01",
		Title:       "Not Named At All",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})

	// One series named twice, with the lower rank second, and one named with no
	// rank at all. min() takes the 1, and the rankless one joins the unranked.
	env.seedRawRankingSnapshot(t, tenant.ID, fmt.Sprintf(
		`[{"rank":3,"entity_id":%q},{"rank":1,"entity_id":%q},{"entity_id":%q}]`,
		duplicated.ID, duplicated.ID, rankless.ID,
	))

	// Walking one page at a time is what exposes a token built on a rank the
	// scan never used: the second page would start in the wrong place.
	var got []string
	token := ""
	for range 3 {
		page := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{
			Limit:  1,
			Tenant: tenantContext(tenant),
			Token:  token,
		})
		got = append(got, seriesPublicIDs(page.Series)...)
		token = page.NextToken
	}
	if token != "" {
		t.Fatalf("next_token = %q, want empty after the whole list", token)
	}

	want := []string{"SERIESADUP01", "SERIESANEW01", "SERIESANOR01"}
	if !slices.Equal(got, want) {
		t.Fatalf("series = %v, want %v (min rank first, then the unranked newest first)", got, want)
	}
}

func TestDBListRecommendedSeriesFallsBackToNewArrivalsWithoutSignals(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAOLD01",
		Title:       "Published Long Ago",
		Published:   true,
		PublishedAt: time.Now().Add(-48 * time.Hour),
	})
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESANEW01",
		Title:       "Published Recently",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})
	// A draft must stay out of the fallback too: cold start means new arrivals,
	// not everything in the catalogue.
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESADRF01",
		Title:    "Still A Draft",
	})

	resp := env.listRecommendedSeries(t, &publirav1.ListRecommendedSeriesRequest{
		Tenant: tenantContext(tenant),
	})
	assertSeriesPublicIDs(t, resp.Series, "SERIESANEW01", "SERIESAOLD01")
	if resp.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_NEW_ARRIVALS {
		t.Fatalf("source = %v, want NEW_ARRIVALS", resp.Source)
	}
}
