package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func mySeriesRatingRequest(tenant testutil.Tenant, seriesPublicID, token string) *connect.Request[publirav1.GetMySeriesRatingRequest] {
	return newBearerRequest(&publirav1.GetMySeriesRatingRequest{
		Tenant:         tenantContext(tenant),
		SeriesPublicId: seriesPublicID,
	}, token)
}

// seedSeriesDailyStats writes one day of a series' aggregates and the tenant
// totals that follow it, standing in for one run of the nightly rebuild the
// figure is derived from.
func (e *publicDBEnv) seedSeriesDailyStats(t *testing.T, tenantID, seriesID uuid.UUID, day string, points, completedReads int64) {
	t.Helper()
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO content_daily_stats (
			id, tenant_id, stat_date, entity_type, entity_id,
			complete_count, rating_count, rating_sum
		)
		VALUES ($1, $2, $3::date, 'series', $4, $5, $6, $7)
	`, uuid.Must(uuid.NewV7()), tenantID, day, seriesID, completedReads, points, points); err != nil {
		t.Fatalf("seed series daily stats: %v", err)
	}
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO tenant_rating_totals (tenant_id, points, completed_reads)
		SELECT $1, COALESCE(sum(cds.rating_sum), 0), COALESCE(sum(cds.complete_count), 0)
		FROM content_daily_stats cds
		WHERE cds.tenant_id = $1 AND cds.entity_type = 'series'
		ON CONFLICT (tenant_id) DO UPDATE
		SET points = EXCLUDED.points, completed_reads = EXCLUDED.completed_reads
	`, tenantID); err != nil {
		t.Fatalf("restate the tenant rating totals: %v", err)
	}
}

// The series page reads its figure from the same response the rest of the
// series comes in. Until the reactions reach the aggregates the page shows
// nothing at all, rather than a series rated zero by nobody.
func TestDBGetSeriesDetailCarriesTheDerivedRating(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTSRTA", "series-rating-a.example.com", "Series Rating A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERSRTA", "member-srt-a@example.com", "Member A", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESSRTA", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODESRTA",
		Title:    "Free episode",
		Status:   testutil.EpisodeStatusPublished,
	})

	detailRequest := func() *connect.Request[publirav1.GetSeriesDetailRequest] {
		return connect.NewRequest(&publirav1.GetSeriesDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: series.PublicID,
		})
	}

	before, err := env.catalogClient().GetSeriesDetail(context.Background(), detailRequest())
	if err != nil {
		t.Fatalf("GetSeriesDetail before any reaction: %v", err)
	}
	if got := before.Msg.GetSeries().GetRatingAverage(); got != 0 {
		t.Fatalf("rating_average before any reaction = %v, want none", got)
	}
	if got := before.Msg.GetSeries().GetRatingCount(); got != 0 {
		t.Fatalf("rating_count before any reaction = %d, want 0", got)
	}

	if _, err := env.ratingClient().RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, tokenFor(t, tenant, member), 1)); err != nil {
		t.Fatalf("RateEpisode: %v", err)
	}

	// The reaction is stored, but the aggregates it is derived from are rebuilt
	// nightly, so the page still has nothing to show.
	pending, err := env.catalogClient().GetSeriesDetail(context.Background(), detailRequest())
	if err != nil {
		t.Fatalf("GetSeriesDetail before the aggregation: %v", err)
	}
	if got := pending.Msg.GetSeries().GetRatingAverage(); got != 0 {
		t.Fatalf("rating_average before the aggregation = %v, want none", got)
	}
	if got := pending.Msg.GetSeries().GetRatingCount(); got != 0 {
		t.Fatalf("rating_count before the aggregation = %d, want none", got)
	}

	env.seedSeriesDailyStats(t, tenant.ID, series.ID, "2026-09-01", 500, 200)

	after, err := env.catalogClient().GetSeriesDetail(context.Background(), detailRequest())
	if err != nil {
		t.Fatalf("GetSeriesDetail after the aggregation: %v", err)
	}
	// 500 points over 200 completed reads, with the tenant's own mean of 2.5
	// standing in for twenty reads nobody has finished yet.
	if got := after.Msg.GetSeries().GetRatingAverage(); got != 2.5 {
		t.Fatalf("rating_average = %v, want 2.5", got)
	}
	if got := after.Msg.GetSeries().GetRatingCount(); got != 1 {
		t.Fatalf("rating_count = %d, want the one reader who reacted", got)
	}
}

// A reader's own figure covers the episodes they reacted to and no others, and
// a reader who has reacted to none of them gets nothing rather than the bottom
// of the scale.
func TestDBGetMySeriesRatingAnswersTheReadersOwnReactions(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTSRTB", "series-rating-b.example.com", "Series Rating B")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERSRTB", "member-srt-b@example.com", "Member B", "tenant_member")
	other := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERSRTC", "member-srt-c@example.com", "Member C", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESSRTB", Title: "Public series", Published: true})
	first := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODESRTB", Title: "One", Status: testutil.EpisodeStatusPublished})
	second := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODESRTC", Title: "Two", Status: testutil.EpisodeStatusPublished})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODESRTD", Title: "Three", Status: testutil.EpisodeStatusPublished})
	env.setEpisodeRatingMode(t, tenant.ID, "multiple")

	client := env.ratingClient()
	token := tokenFor(t, tenant, member)
	otherToken := tokenFor(t, tenant, other)

	none, err := client.GetMySeriesRating(context.Background(), mySeriesRatingRequest(tenant, series.PublicID, token))
	if err != nil {
		t.Fatalf("GetMySeriesRating before any reaction: %v", err)
	}
	if none.Msg.RatingAverage != 0 || none.Msg.RatedEpisodeCount != 0 {
		t.Fatalf("GetMySeriesRating before any reaction = %+v, want nothing", none.Msg)
	}

	if _, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, first.PublicID, token, 5)); err != nil {
		t.Fatalf("RateEpisode on the first episode: %v", err)
	}
	if _, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, second.PublicID, token, 2)); err != nil {
		t.Fatalf("RateEpisode on the second episode: %v", err)
	}
	// Another reader's reaction to the same series, which is none of this
	// reader's business.
	if _, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, first.PublicID, otherToken, 1)); err != nil {
		t.Fatalf("RateEpisode as the other member: %v", err)
	}

	mine, err := client.GetMySeriesRating(context.Background(), mySeriesRatingRequest(tenant, series.PublicID, token))
	if err != nil {
		t.Fatalf("GetMySeriesRating: %v", err)
	}
	// The third episode was never reacted to and is not in the mean.
	if mine.Msg.RatingAverage != 3.5 {
		t.Fatalf("rating_average = %v, want 3.5", mine.Msg.RatingAverage)
	}
	if mine.Msg.RatedEpisodeCount != 2 {
		t.Fatalf("rated_episode_count = %d, want 2", mine.Msg.RatedEpisodeCount)
	}

	theirs, err := client.GetMySeriesRating(context.Background(), mySeriesRatingRequest(tenant, series.PublicID, otherToken))
	if err != nil {
		t.Fatalf("GetMySeriesRating as the other member: %v", err)
	}
	if theirs.Msg.RatingAverage != 1 || theirs.Msg.RatedEpisodeCount != 1 {
		t.Fatalf("the other member's rating = %+v, want 1 over one episode", theirs.Msg)
	}
}

// A foreign, unpublished, or missing series is the same not found, so the RPC
// cannot be used to probe for a series the reader is not meant to see. Without
// a session it is unauthenticated, like every RPC that answers about a reader.
func TestDBGetMySeriesRatingHidesSeriesTheReaderCannotSee(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTSRTC", "series-rating-c.example.com", "Series Rating C")
	otherTenant := env.seedTenant(t, "TENANTSRTD", "series-rating-d.example.com", "Series Rating D")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERSRTD", "member-srt-d@example.com", "Member D", "tenant_member")
	unpublished := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESSRTC", Title: "Draft series"})
	foreign := env.PG.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "SERIESSRTD", Title: "Foreign series", Published: true})
	published := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESSRTE", Title: "Public series", Published: true})

	client := env.ratingClient()
	token := tokenFor(t, tenant, member)
	for _, publicID := range []string{unpublished.PublicID, foreign.PublicID, "MISSINGSRT"} {
		_, err := client.GetMySeriesRating(context.Background(), mySeriesRatingRequest(tenant, publicID, token))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("GetMySeriesRating %s code = %v, want not_found (err=%v)", publicID, connect.CodeOf(err), err)
		}
	}

	_, err := client.GetMySeriesRating(context.Background(), connect.NewRequest(&publirav1.GetMySeriesRatingRequest{
		Tenant:         tenantContext(tenant),
		SeriesPublicId: published.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetMySeriesRating without a session code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}
