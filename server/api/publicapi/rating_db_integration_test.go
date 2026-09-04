package publicapi

import (
	"context"
	"database/sql"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// A rating is append-only, its score range is a CHECK constraint, and its
// tenant boundary is an RLS policy. None of that is visible to the sqlmock
// tests in rating_handlers_test.go, so the acceptance criteria are carried
// here, against a real database.

// latestRatings runs the query the daily aggregation will use to turn the
// append-only log into "what each actor currently says", on a tenant-scoped
// connection so RLS applies exactly as it does for a request.
func (e *publicDBEnv) latestRatings(
	t *testing.T,
	tenantID, seriesID uuid.UUID,
	episodeID uuid.NullUUID,
) []dbmodels.ListLatestContentRatingsByEntityRow {
	t.Helper()

	var rows []dbmodels.ListLatestContentRatingsByEntityRow
	e.withTenantConn(t, tenantID, func(ctx context.Context, conn *sql.Conn) {
		var err error
		rows, err = dbmodels.New(conn).ListLatestContentRatingsByEntity(ctx, dbmodels.ListLatestContentRatingsByEntityParams{
			TenantID:  tenantID,
			SeriesID:  seriesID,
			EpisodeID: episodeID,
		})
		if err != nil {
			t.Fatalf("ListLatestContentRatingsByEntity: %v", err)
		}
	})
	return rows
}

func (e *publicDBEnv) rate(
	t *testing.T,
	tenant testutil.Tenant,
	member testutil.TenantUser,
	target *publirav1.RatingTarget,
	score int32,
) (*connect.Response[publirav1.RateContentResponse], error) {
	t.Helper()

	return e.ratingClient().RateContent(context.Background(), newBearerRequest(&publirav1.RateContentRequest{
		Tenant: tenantContext(tenant),
		Target: target,
		Score:  score,
	}, tokenFor(t, tenant, member)))
}

func TestDBRatingKeepsEveryScoreAndAggregationTakesTheLatest(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTRAT", "rating.example.com", "Rating Tenant")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRAT1", "member-rating@example.com", "Rating Member", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRAT01", Title: "Rated series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERAT1", Title: "Rated episode", Status: testutil.EpisodeStatusPublished})

	first, err := env.rate(t, tenant, member, seriesRatingTarget(series.PublicID), 2)
	if err != nil {
		t.Fatalf("first RateContent: %v", err)
	}
	if first.Msg.Score != 2 {
		t.Fatalf("first score = %d, want 2", first.Msg.Score)
	}
	// The member changes their mind. Nothing is updated or deleted; the earlier
	// score stays readable as history.
	if _, err := env.rate(t, tenant, member, seriesRatingTarget(series.PublicID), 5); err != nil {
		t.Fatalf("second RateContent: %v", err)
	}

	if got := env.countRows(t,
		"SELECT COUNT(*) FROM content_events WHERE tenant_id = $1 AND event_type = 'rating' AND series_id = $2 AND episode_id IS NULL",
		tenant.ID, series.ID); got != 2 {
		t.Fatalf("series rating rows = %d, want both scores kept", got)
	}
	latest := env.latestRatings(t, tenant.ID, series.ID, uuid.NullUUID{})
	if len(latest) != 1 {
		t.Fatalf("latest series ratings = %d rows, want 1 per actor", len(latest))
	}
	if latest[0].RatingScore.Int16 != 5 {
		t.Fatalf("latest series score = %d, want the newer 5", latest[0].RatingScore.Int16)
	}
	if latest[0].ActorKey.UUID != member.ID {
		t.Fatalf("actor_key = %v, want the member %v", latest[0].ActorKey, member.ID)
	}

	// An episode rating is a different entity, filed under the same series.
	if _, err := env.rate(t, tenant, member, episodeRatingTarget(episode.PublicID), 3); err != nil {
		t.Fatalf("episode RateContent: %v", err)
	}
	if got := env.countRows(t,
		"SELECT COUNT(*) FROM content_events WHERE tenant_id = $1 AND event_type = 'rating' AND episode_id = $2 AND series_id = $3",
		tenant.ID, episode.ID, series.ID); got != 1 {
		t.Fatalf("episode rating rows = %d, want 1 filed under the episode's own series", got)
	}
	episodeLatest := env.latestRatings(t, tenant.ID, series.ID, uuid.NullUUID{UUID: episode.ID, Valid: true})
	if len(episodeLatest) != 1 || episodeLatest[0].RatingScore.Int16 != 3 {
		t.Fatalf("latest episode ratings = %+v, want a single score of 3", episodeLatest)
	}
	// The series rating is unchanged by the episode one.
	if seriesLatest := env.latestRatings(t, tenant.ID, series.ID, uuid.NullUUID{}); len(seriesLatest) != 1 || seriesLatest[0].RatingScore.Int16 != 5 {
		t.Fatalf("latest series ratings after the episode rating = %+v, want a single score of 5", seriesLatest)
	}
}

func TestDBRatingRejectsScoreOutsideOneToFive(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTRATB", "rating-b.example.com", "Rating Range")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRATB", "member-rating-b@example.com", "Range Member", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRATB1", Title: "Range series", Published: true})

	for _, score := range []int32{0, -1, 6} {
		if _, err := env.rate(t, tenant, member, seriesRatingTarget(series.PublicID), score); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("RateContent(%d) error = %v, want invalid_argument", score, err)
		}
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM content_events WHERE tenant_id = $1", tenant.ID); got != 0 {
		t.Fatalf("content_events = %d rows, want a rejected score to write nothing", got)
	}
	if _, err := env.rate(t, tenant, member, seriesRatingTarget(series.PublicID), 1); err != nil {
		t.Fatalf("RateContent(1): %v", err)
	}
	if _, err := env.rate(t, tenant, member, seriesRatingTarget(series.PublicID), 5); err != nil {
		t.Fatalf("RateContent(5): %v", err)
	}
}

func TestDBRatingIsTenantIsolated(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	firstMember := env.PG.SeedTenantUser(t, first.ID, "MEMBERRATA", "member-rating-a@example.com", "Member A", "tenant_member")
	secondMember := env.PG.SeedTenantUser(t, second.ID, "MEMBERRATC", "member-rating-c@example.com", "Member B", "tenant_member")
	firstSeries := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESRATA1", Title: "Tenant A series", Published: true})

	if _, err := env.rate(t, first, firstMember, seriesRatingTarget(firstSeries.PublicID), 4); err != nil {
		t.Fatalf("RateContent in tenant A: %v", err)
	}

	// The other tenant's member cannot rate a series that is not theirs, and the
	// failure is indistinguishable from a series that does not exist.
	if _, err := env.rate(t, second, secondMember, seriesRatingTarget(firstSeries.PublicID), 4); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-tenant RateContent error = %v, want not_found", err)
	}

	// Nor can the other tenant read the rating that was written: RLS filters it
	// out even though the query names the row's own series ID.
	if rows := env.latestRatings(t, second.ID, firstSeries.ID, uuid.NullUUID{}); len(rows) != 0 {
		t.Fatalf("tenant B sees %d of tenant A's ratings, want 0", len(rows))
	}
	if rows := env.latestRatings(t, first.ID, firstSeries.ID, uuid.NullUUID{}); len(rows) != 1 {
		t.Fatalf("tenant A sees %d of its own ratings, want 1", len(rows))
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM content_events WHERE tenant_id = $1", second.ID); got != 0 {
		t.Fatalf("tenant B content_events = %d rows, want 0", got)
	}
}
