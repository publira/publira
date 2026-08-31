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

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	"github.com/publira/publira/server/internal/contentranking"
	"github.com/publira/publira/server/internal/testutil"
)

// The recommendation slot is the one read whose order comes from another
// tenant-scoped table. The sqlmock tests hand the snapshot straight to the
// handler, so only these cases show that RLS keeps one tenant's ranking out of
// another tenant's storefront.

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

func TestDBListRecommendedSeriesOrdersBySignalsAndKeepsTenantsApart(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	// Newest last, so a ranking that puts the oldest series first cannot be
	// mistaken for the new-arrival order the slot fell back on before.
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
	// snapshot itself tenant-scoped; the display query is what has to refuse the
	// series behind it.
	env.seedRankingSnapshot(t, second.ID, newest.ID)

	ranked, err := env.catalogClient().ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Tenant: tenantContext(first),
	}))
	if err != nil {
		t.Fatalf("ListRecommendedSeries: %v", err)
	}
	got := seriesPublicIDs(ranked.Msg.Series)
	want := []string{"SERIESAOLD01", "SERIESAMID01", "SERIESANEW01"}
	if !slices.Equal(got, want) {
		t.Fatalf("series = %v, want %v (ranked first, then the new arrival that tops the slot up)", got, want)
	}
	if ranked.Msg.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_RANKING {
		t.Fatalf("source = %v, want RANKING", ranked.Msg.Source)
	}

	crossTenant, err := env.catalogClient().ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Tenant: tenantContext(second),
	}))
	if err != nil {
		t.Fatalf("ListRecommendedSeries for the second tenant: %v", err)
	}
	got = seriesPublicIDs(crossTenant.Msg.Series)
	if !slices.Equal(got, []string{other.PublicID}) {
		t.Fatalf("series = %v, want only the second tenant's own series", got)
	}
	// Nothing in the first tenant's ranking survived the display query, so the
	// slot is what it would have been with no signals at all.
	if crossTenant.Msg.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_NEW_ARRIVALS {
		t.Fatalf("source = %v, want NEW_ARRIVALS", crossTenant.Msg.Source)
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

	resp, err := env.catalogClient().ListRecommendedSeries(context.Background(), connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{
		Tenant: tenantContext(tenant),
	}))
	if err != nil {
		t.Fatalf("ListRecommendedSeries: %v", err)
	}
	got := seriesPublicIDs(resp.Msg.Series)
	want := []string{"SERIESANEW01", "SERIESAOLD01"}
	if !slices.Equal(got, want) {
		t.Fatalf("series = %v, want %v (newest first, drafts excluded)", got, want)
	}
	if resp.Msg.Source != publirav1.RecommendationSource_RECOMMENDATION_SOURCE_NEW_ARRIVALS {
		t.Fatalf("source = %v, want NEW_ARRIVALS", resp.Msg.Source)
	}
}
