package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/testutil"
)

func rateEpisodeRequest(tenant testutil.Tenant, episodePublicID, token string, presses int32) *connect.Request[publirav1.RateEpisodeRequest] {
	return newBearerRequest(&publirav1.RateEpisodeRequest{
		Tenant:          tenantContext(tenant),
		EpisodePublicId: episodePublicID,
		Presses:         presses,
	}, token)
}

func myEpisodeRatingRequest(tenant testutil.Tenant, episodePublicID, token string) *connect.Request[publirav1.GetMyEpisodeRatingRequest] {
	return newBearerRequest(&publirav1.GetMyEpisodeRatingRequest{
		Tenant:          tenantContext(tenant),
		EpisodePublicId: episodePublicID,
	}, token)
}

// setEpisodeRatingMode writes the tenant's press mode, the way the console will.
func (e *publicDBEnv) setEpisodeRatingMode(t *testing.T, tenantID uuid.UUID, mode string) {
	t.Helper()
	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO tenant_config (tenant_id, episode_rating_mode) VALUES ($1, $2)
		ON CONFLICT (tenant_id) DO UPDATE SET episode_rating_mode = EXCLUDED.episode_rating_mode
	`, tenantID, mode); err != nil {
		t.Fatalf("set the episode rating mode: %v", err)
	}
}

// In the mode a tenant gets by default, one press is the whole rating: it
// stores 5, and pressing again adds nothing.
func TestDBRateEpisodeStoresTheWholeRatingInSingleMode(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTRATEA", "rate-a.example.com", "Rate A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRATEA", "member-rate-a@example.com", "Member A", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRATEA", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEA", Title: "Free episode", Status: testutil.EpisodeStatusPublished})
	client := env.ratingClient()
	token := tokenFor(t, tenant, member)

	first, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, token, 1))
	if err != nil {
		t.Fatalf("first RateEpisode: %v", err)
	}
	if first.Msg.Score != 5 || first.Msg.RatingCount != 1 {
		t.Fatalf("first RateEpisode = %+v, want score 5 and one reader", first.Msg)
	}
	if first.Msg.Mode != publirav1.EpisodeRatingMode_EPISODE_RATING_MODE_SINGLE {
		t.Fatalf("mode = %s, want single", first.Msg.Mode)
	}

	// A second press has nothing left to add, and files no event.
	second, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, token, 1))
	if err != nil {
		t.Fatalf("second RateEpisode: %v", err)
	}
	if second.Msg.Score != 5 || second.Msg.RatingCount != 1 {
		t.Fatalf("second RateEpisode = %+v, want score 5 and one reader", second.Msg)
	}
	if got := env.countRows(t,
		"SELECT COUNT(*) FROM content_events WHERE tenant_id = $1 AND event_type = 'rating' AND episode_id = $2",
		tenant.ID, episode.ID); got != 1 {
		t.Fatalf("rating events = %d, want 1", got)
	}
	if got := env.countRows(t,
		"SELECT COALESCE(sum(rating_score), 0) FROM content_events WHERE tenant_id = $1 AND event_type = 'rating' AND episode_id = $2",
		tenant.ID, episode.ID); got != 5 {
		t.Fatalf("rating points = %d, want 5", got)
	}
	// The event names the series the episode belongs to, so the daily rollup
	// finds it without the handler being trusted for that.
	if got := env.countRows(t,
		"SELECT COUNT(*) FROM content_events WHERE tenant_id = $1 AND event_type = 'rating' AND series_id = $2",
		tenant.ID, series.ID); got != 1 {
		t.Fatalf("rating events carrying the series = %d, want 1", got)
	}
}

// Where a tenant lets readers press their way up, the score climbs by what each
// call reports and stops at five, and the tally still counts the reader once.
func TestDBRateEpisodeClimbsAndCapsInMultipleMode(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTRATEB", "rate-b.example.com", "Rate B")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRATEB", "member-rate-b@example.com", "Member B", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRATEB", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEB", Title: "Free episode", Status: testutil.EpisodeStatusPublished})
	env.setEpisodeRatingMode(t, tenant.ID, "multiple")
	client := env.ratingClient()
	token := tokenFor(t, tenant, member)

	first, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, token, 3))
	if err != nil {
		t.Fatalf("RateEpisode with three presses: %v", err)
	}
	if first.Msg.Score != 3 || first.Msg.RatingCount != 1 {
		t.Fatalf("three presses = %+v, want score 3 and one reader", first.Msg)
	}
	if first.Msg.Mode != publirav1.EpisodeRatingMode_EPISODE_RATING_MODE_MULTIPLE {
		t.Fatalf("mode = %s, want multiple", first.Msg.Mode)
	}

	// Three more would be six; five is the ceiling, and only the two points
	// that landed are filed.
	second, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, token, 3))
	if err != nil {
		t.Fatalf("RateEpisode past the ceiling: %v", err)
	}
	if second.Msg.Score != 5 || second.Msg.RatingCount != 1 {
		t.Fatalf("past the ceiling = %+v, want score 5 and one reader", second.Msg)
	}

	if got := env.countRows(t,
		"SELECT COALESCE(sum(rating_score), 0) FROM content_events WHERE tenant_id = $1 AND event_type = 'rating' AND episode_id = $2",
		tenant.ID, episode.ID); got != 5 {
		t.Fatalf("rating points = %d, want 5", got)
	}
	if got := env.countRows(t, "SELECT score FROM episode_ratings WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3",
		tenant.ID, member.ID, episode.ID); got != 5 {
		t.Fatalf("stored score = %d, want 5", got)
	}
}

// Changing the mode leaves stored scores exactly as they were, in either
// direction: that is what makes a single press worth the whole 5.
func TestDBChangingTheRatingModeLeavesStoredScoresAlone(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTRATEC", "rate-c.example.com", "Rate C")
	pressedUp := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRATEC", "member-rate-c@example.com", "Member C", "tenant_member")
	pressedOnce := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRATED", "member-rate-d@example.com", "Member D", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRATEC", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEC", Title: "Free episode", Status: testutil.EpisodeStatusPublished})
	client := env.ratingClient()

	env.setEpisodeRatingMode(t, tenant.ID, "multiple")
	if _, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, tokenFor(t, tenant, pressedUp), 3)); err != nil {
		t.Fatalf("RateEpisode in multiple mode: %v", err)
	}

	env.setEpisodeRatingMode(t, tenant.ID, "single")
	if _, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, tokenFor(t, tenant, pressedOnce), 1)); err != nil {
		t.Fatalf("RateEpisode in single mode: %v", err)
	}

	// The reader who stopped at three still has three, and the one press is a
	// whole rating rather than the weakest one on record.
	if got := env.countRows(t, "SELECT score FROM episode_ratings WHERE tenant_id = $1 AND user_id = $2", tenant.ID, pressedUp.ID); got != 3 {
		t.Fatalf("score after the mode changed = %d, want the 3 that was stored", got)
	}
	if got := env.countRows(t, "SELECT score FROM episode_ratings WHERE tenant_id = $1 AND user_id = $2", tenant.ID, pressedOnce.ID); got != 5 {
		t.Fatalf("single-mode score = %d, want 5", got)
	}
	if got := env.countRows(t,
		"SELECT COALESCE((SELECT count FROM episode_rating_counts WHERE tenant_id = $1 AND episode_id = $2), -1)",
		tenant.ID, episode.ID); got != 2 {
		t.Fatalf("readers who rated = %d, want 2", got)
	}
}

// Rating asks for the body access reading the episode asks for.
func TestDBRateEpisodeRequiresCurrentPublicationAndBodyAccess(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, otherTenant := env.seedTwoTenants(t)
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRATEE", "member-rate-e@example.com", "Member E", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRATED", Title: "Public series", Published: true})
	free := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATED", Title: "Free", Status: testutil.EpisodeStatusPublished})
	paid := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEE", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500})
	purchased := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEF", Title: "Purchased", Status: testutil.EpisodeStatusPublished, Price: 500})
	ticketed := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEG", Title: "Ticketed", Status: testutil.EpisodeStatusPublished, Price: 500})
	draft := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEH", Title: "Draft", Status: testutil.EpisodeStatusDraft})
	foreignSeries := env.PG.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "SERIESRATEE", Title: "Foreign", Published: true})
	foreign := env.PG.SeedEpisode(t, otherTenant.ID, foreignSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEI", Title: "Foreign", Status: testutil.EpisodeStatusPublished})
	env.PG.SeedPurchase(t, tenant.ID, member.ID, purchased.ID, purchased.Price)
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id)
		VALUES ($1, $2, $3, $4, $5)
	`, uuid.Must(uuid.NewV7()), tenant.ID, "TICKETRATE01", ticketed.ID, member.ID); err != nil {
		t.Fatalf("seed access ticket: %v", err)
	}

	client := env.ratingClient()
	token := tokenFor(t, tenant, member)
	for _, episode := range []testutil.Episode{free, purchased, ticketed} {
		response, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, token, 1))
		if err != nil {
			t.Fatalf("RateEpisode %s: %v", episode.PublicID, err)
		}
		if response.Msg.Score == 0 {
			t.Fatalf("RateEpisode %s left the reader at a score of 0", episode.PublicID)
		}
	}
	for _, publicID := range []string{paid.PublicID, draft.PublicID, foreign.PublicID, "MISSINGRATE"} {
		_, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, publicID, token, 1))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("RateEpisode %s code = %v, want not_found (err=%v)", publicID, connect.CodeOf(err), err)
		}
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_ratings WHERE tenant_id = $1 AND user_id = $2", tenant.ID, member.ID); got != 3 {
		t.Fatalf("stored ratings = %d, want the 3 readable episodes", got)
	}
}

// GetMyEpisodeRating asks only that the episode be published: a rating already
// given stays readable after the rental that allowed it has run out.
func TestDBGetMyEpisodeRatingAnswersTheReadersOwnScoreAndThePublicTally(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTRATEF", "rate-f.example.com", "Rate F")
	first := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRATEJ", "member-rate-j@example.com", "Member J", "tenant_member")
	second := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRATEK", "member-rate-k@example.com", "Member K", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRATEF", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEJ", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500})
	ticket := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id)
		VALUES ($1, $2, $3, $4, $5)
	`, ticket, tenant.ID, "TICKETRATE02", episode.ID, first.ID); err != nil {
		t.Fatalf("seed access ticket: %v", err)
	}
	client := env.ratingClient()
	firstToken := tokenFor(t, tenant, first)
	secondToken := tokenFor(t, tenant, second)

	before, err := client.GetMyEpisodeRating(context.Background(), myEpisodeRatingRequest(tenant, episode.PublicID, secondToken))
	if err != nil {
		t.Fatalf("GetMyEpisodeRating before any rating: %v", err)
	}
	if before.Msg.Score != 0 || before.Msg.RatingCount != 0 {
		t.Fatalf("GetMyEpisodeRating before any rating = %+v, want score 0 and no readers", before.Msg)
	}

	if _, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, firstToken, 1)); err != nil {
		t.Fatalf("RateEpisode: %v", err)
	}

	// The second reader gave nothing and still sees the first one in the tally.
	other, err := client.GetMyEpisodeRating(context.Background(), myEpisodeRatingRequest(tenant, episode.PublicID, secondToken))
	if err != nil {
		t.Fatalf("GetMyEpisodeRating as the other member: %v", err)
	}
	if other.Msg.Score != 0 {
		t.Fatalf("GetMyEpisodeRating as the other member reported a score of %d", other.Msg.Score)
	}
	if other.Msg.RatingCount != 1 {
		t.Fatalf("GetMyEpisodeRating as the other member count = %d, want 1", other.Msg.RatingCount)
	}

	// The rental runs out. The rating is still theirs to read back.
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE access_tickets SET expires_at = $1 WHERE id = $2", time.Now().Add(-time.Minute), ticket); err != nil {
		t.Fatalf("expire the access ticket: %v", err)
	}
	mine, err := client.GetMyEpisodeRating(context.Background(), myEpisodeRatingRequest(tenant, episode.PublicID, firstToken))
	if err != nil {
		t.Fatalf("GetMyEpisodeRating after the rental ran out: %v", err)
	}
	if mine.Msg.Score != 5 {
		t.Fatalf("own score after the rental ran out = %d, want 5", mine.Msg.Score)
	}
}

// The episode detail carries the same tally, so the page renders it before the
// reader's own state has been asked for.
func TestDBEpisodeDetailCarriesTheStoredRatingCount(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTRATEG", "rate-g.example.com", "Rate G")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRATEL", "member-rate-l@example.com", "Member L", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRATEG", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEL", Title: "Free episode", Status: testutil.EpisodeStatusPublished})
	detailRequest := func() *connect.Request[publirav1.GetEpisodeDetailRequest] {
		return connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: episode.PublicID,
		})
	}

	detail, err := env.catalogClient().GetEpisodeDetail(context.Background(), detailRequest())
	if err != nil {
		t.Fatalf("GetEpisodeDetail before any rating: %v", err)
	}
	if got := detail.Msg.GetEpisode().GetRatingCount(); got != 0 {
		t.Fatalf("rating_count before any rating = %d, want 0", got)
	}

	if _, err := env.ratingClient().RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, tokenFor(t, tenant, member), 1)); err != nil {
		t.Fatalf("RateEpisode: %v", err)
	}

	detail, err = env.catalogClient().GetEpisodeDetail(context.Background(), detailRequest())
	if err != nil {
		t.Fatalf("GetEpisodeDetail after the rating: %v", err)
	}
	if got := detail.Msg.GetEpisode().GetRatingCount(); got != 1 {
		t.Fatalf("rating_count after the rating = %d, want 1", got)
	}
}

// The flood control the reader-writable RPCs share covers this one.
func TestDBRateEpisodeChargesTheSharedFloodControl(t *testing.T) {
	env := newPublicDBEnvWithGuards(t, guardsWith(map[readerAction][]ratelimit.Rule{
		actionRateEpisode: {{Limit: 2, Window: time.Hour}},
	}))
	tenant := env.seedTenant(t, "TENANTRATEH", "rate-h.example.com", "Rate H")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERRATEM", "member-rate-m@example.com", "Member M", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRATEH", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODERATEM", Title: "Free episode", Status: testutil.EpisodeStatusPublished})
	env.setEpisodeRatingMode(t, tenant.ID, "multiple")
	client := env.ratingClient()
	token := tokenFor(t, tenant, member)

	for range 2 {
		if _, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, token, 1)); err != nil {
			t.Fatalf("RateEpisode within the allowance: %v", err)
		}
	}
	_, err := client.RateEpisode(context.Background(), rateEpisodeRequest(tenant, episode.PublicID, token, 1))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("RateEpisode past the allowance code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}
