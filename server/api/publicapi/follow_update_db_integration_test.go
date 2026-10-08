package publicapi

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func followUpdateRequest(tenant testutil.Tenant, limit int32, pageToken string) *publirav1.ListMyFollowUpdatesRequest {
	return &publirav1.ListMyFollowUpdatesRequest{
		Tenant: tenantContext(tenant),
		Limit:  limit,
		Token:  pageToken,
	}
}

func followUpdateEpisodePublicIDs(updates []*publirav1.FollowUpdate) []string {
	ids := make([]string, 0, len(updates))
	for _, update := range updates {
		ids = append(ids, update.GetEpisode().GetPublicId())
	}
	return ids
}

func TestDBFollowServiceListsNewEpisodesOfFollowedSeriesAndCreators(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTFOLU", "follow-u.example.com", "Follow U")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERFOLU", "member-follow-u@example.com", "Member U", "tenant_member")
	now := time.Now()

	followedSeries := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESFOLU1", Title: "Followed series", Published: true})
	older := env.PG.SeedEpisode(t, tenant.ID, followedSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEFLU1", Title: "Older episode", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-3 * time.Hour)})
	newest := env.PG.SeedEpisode(t, tenant.ID, followedSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEFLU2", Title: "Newest episode", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-time.Hour)})
	env.PG.SeedEpisode(t, tenant.ID, followedSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEFLU3", Title: "Draft episode"})
	env.PG.SeedEpisode(t, tenant.ID, followedSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEFLU4", Title: "Not out yet", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(time.Hour)})

	// The creator is credited on an episode of a series the member does not
	// follow, and on the newest episode of the one they do: the first is what
	// the creator follow adds, the second is what the two follows must not
	// count twice.
	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORFLU1", Name: "Followed creator"})
	guestSeries := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESFOLU2", Title: "Guest series", Published: true})
	env.PG.SeedSeriesCreator(t, tenant.ID, guestSeries.ID, creator.ID, "")
	guest := env.PG.SeedEpisode(t, tenant.ID, guestSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEFLU5", Title: "Guest episode", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-2 * time.Hour)})
	env.PG.SeedEpisodeCreator(t, tenant.ID, guest.ID, creator.ID, "")
	env.PG.SeedEpisodeCreator(t, tenant.ID, newest.ID, creator.ID, "")

	// Followed, but taken down: neither the series nor its episodes are public.
	draftSeries := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESFOLU3", Title: "Draft series"})
	env.PG.SeedEpisode(t, tenant.ID, draftSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEFLU6", Title: "Episode of a draft series", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-30 * time.Minute)})

	// Published, and reached by neither of the two follows that feed the list.
	strangerSeries := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESFOLU4", Title: "Unfollowed series", Published: true})
	stranger := env.PG.SeedEpisode(t, tenant.ID, strangerSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEFLU7", Title: "Unfollowed episode", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-10 * time.Minute)})

	ctx := context.Background()
	for _, seriesID := range []uuid.UUID{followedSeries.ID, draftSeries.ID} {
		if _, err := env.PG.DB.ExecContext(ctx, "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", tenant.ID, member.ID, seriesID); err != nil {
			t.Fatalf("insert series follow: %v", err)
		}
	}
	if _, err := env.PG.DB.ExecContext(ctx, "INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", tenant.ID, member.ID, creator.ID); err != nil {
		t.Fatalf("insert creator follow: %v", err)
	}
	// A follow on one episode names an episode that is already there, so it
	// must not put that episode in the list.
	if _, err := env.PG.DB.ExecContext(ctx, "INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)", tenant.ID, member.ID, stranger.ID); err != nil {
		t.Fatalf("insert episode follow: %v", err)
	}

	client := env.followClient()
	responseCtx, responseCall := testutil.NewClientContext(testutil.WithBearer(ctx, tokenFor(t, tenant, member)))
	response, err := client.ListMyFollowUpdates(responseCtx, followUpdateRequest(tenant, 0, ""))
	if err != nil {
		t.Fatalf("ListMyFollowUpdates: %v", err)
	}
	if responseCall.ResponseHeader().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", responseCall.ResponseHeader().Get("Cache-Control"))
	}

	want := []string{newest.PublicID, guest.PublicID, older.PublicID}
	if got := followUpdateEpisodePublicIDs(response.Updates); !slices.Equal(got, want) {
		t.Fatalf("episodes = %v, want %v", got, want)
	}
	if got := response.Updates[0].GetSeries().GetPublicId(); got != followedSeries.PublicID {
		t.Fatalf("series of the newest update = %q, want %q", got, followedSeries.PublicID)
	}
	if got := response.Updates[1].GetSeries().GetTitle(); got != "Guest series" {
		t.Fatalf("series title of the guest update = %q, want %q", got, "Guest series")
	}
	if got := response.Updates[0].GetEpisode().GetPublishedAt(); got == "" {
		t.Fatal("the newest update carries no published_at")
	}

	if _, err := client.ListMyFollowUpdates(ctx, &publirav1.ListMyFollowUpdatesRequest{Tenant: tenantContext(tenant)}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("anonymous ListMyFollowUpdates code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}

	otherMember := env.PG.SeedTenantUser(t, tenant.ID, "OTHERFOLU", "other-follow-u@example.com", "Other Member", "tenant_member")
	empty, err := client.ListMyFollowUpdates(testutil.WithBearer(ctx, tokenFor(t, tenant, otherMember)), followUpdateRequest(tenant, 0, ""))
	if err != nil {
		t.Fatalf("ListMyFollowUpdates for a member who follows nothing: %v", err)
	}
	if len(empty.Updates) != 0 {
		t.Fatalf("a member who follows nothing got %d updates", len(empty.Updates))
	}
}

func TestDBFollowServicePagesThroughFollowUpdates(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTFOLV", "follow-v.example.com", "Follow V")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERFOLV", "member-follow-v@example.com", "Member V", "tenant_member")
	now := time.Now()

	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESFOLV1", Title: "Followed series", Published: true})
	first := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEFLV1", Title: "Episode 1", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-2 * time.Hour)})
	second := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEFLV2", Title: "Episode 2", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-time.Hour)})

	ctx := context.Background()
	if _, err := env.PG.DB.ExecContext(ctx, "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", tenant.ID, member.ID, series.ID); err != nil {
		t.Fatalf("insert series follow: %v", err)
	}

	client := env.followClient()
	token := tokenFor(t, tenant, member)

	page1, err := client.ListMyFollowUpdates(testutil.WithBearer(ctx, token), followUpdateRequest(tenant, 1, ""))
	if err != nil {
		t.Fatalf("ListMyFollowUpdates page 1: %v", err)
	}
	if got := followUpdateEpisodePublicIDs(page1.Updates); !slices.Equal(got, []string{second.PublicID}) {
		t.Fatalf("page 1 = %v, want the newest episode", got)
	}
	if page1.NextToken == "" || page1.PreviousToken != "" {
		t.Fatalf("page 1 tokens = (%q, %q), want empty previous and non-empty next", page1.PreviousToken, page1.NextToken)
	}

	page2, err := client.ListMyFollowUpdates(testutil.WithBearer(ctx, token), followUpdateRequest(tenant, 1, page1.NextToken))
	if err != nil {
		t.Fatalf("ListMyFollowUpdates page 2: %v", err)
	}
	if got := followUpdateEpisodePublicIDs(page2.Updates); !slices.Equal(got, []string{first.PublicID}) {
		t.Fatalf("page 2 = %v, want the older episode", got)
	}
	if page2.PreviousToken == "" || page2.NextToken != "" {
		t.Fatalf("page 2 tokens = (%q, %q), want non-empty previous and empty next", page2.PreviousToken, page2.NextToken)
	}

	back, err := client.ListMyFollowUpdates(testutil.WithBearer(ctx, token), followUpdateRequest(tenant, 1, page2.PreviousToken))
	if err != nil {
		t.Fatalf("ListMyFollowUpdates previous page: %v", err)
	}
	if got := followUpdateEpisodePublicIDs(back.Updates); !slices.Equal(got, []string{second.PublicID}) {
		t.Fatalf("previous page = %v, want the newest episode", got)
	}

	// The boundary row leaves the list after the token was issued: the page is
	// empty and hands back a recovery token to where the client came from.
	if _, err := env.PG.DB.ExecContext(ctx, "UPDATE episode_listings SET status = 'draft' WHERE episode_id = $1", first.ID); err != nil {
		t.Fatalf("unpublish the boundary episode: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, "DELETE FROM episode_listings WHERE episode_id = $1", second.ID); err != nil {
		t.Fatalf("remove the newest listing: %v", err)
	}
	recovered, err := client.ListMyFollowUpdates(testutil.WithBearer(ctx, token), followUpdateRequest(tenant, 1, page1.NextToken))
	if err != nil {
		t.Fatalf("ListMyFollowUpdates after the boundary moved: %v", err)
	}
	if len(recovered.Updates) != 0 {
		t.Fatalf("emptied page = %v, want no updates", followUpdateEpisodePublicIDs(recovered.Updates))
	}
	if recovered.PreviousToken == "" || recovered.NextToken != "" {
		t.Fatalf("emptied page tokens = (%q, %q), want a recovery token towards the previous page only", recovered.PreviousToken, recovered.NextToken)
	}

	if _, err := client.ListMyFollowUpdates(testutil.WithBearer(ctx, token), followUpdateRequest(tenant, 1, "not-a-token")); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("malformed token code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}
