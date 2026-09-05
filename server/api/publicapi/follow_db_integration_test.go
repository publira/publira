package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func episodeFollowTarget(publicID string) *publirav1.FollowTarget {
	return &publirav1.FollowTarget{
		Type:     publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_EPISODE,
		PublicId: publicID,
	}
}

func authorFollowTarget(publicID string) *publirav1.FollowTarget {
	return &publirav1.FollowTarget{
		Type:     publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_AUTHOR,
		PublicId: publicID,
	}
}

func seriesFollowTarget(publicID string) *publirav1.FollowTarget {
	return &publirav1.FollowTarget{
		Type:     publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_SERIES,
		PublicId: publicID,
	}
}

func TestDBFollowServiceLifecycleIsIdempotentAndPrivate(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTFOLA", "follow-a.example.com", "Follow A")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERFOLA", "member-follow-a@example.com", "Member A", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESFOLA1", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEFOLA", Title: "Public episode", Status: testutil.EpisodeStatusPublished})
	author := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORFOLA1", Name: "Public author"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, author.ID, "writer")
	client := env.followClient()

	request := func(target *publirav1.FollowTarget) *connect.Request[publirav1.GetMyFollowStatusRequest] {
		return newBearerRequest(&publirav1.GetMyFollowStatusRequest{Tenant: tenantContext(tenant), Target: target}, tokenFor(t, tenant, member))
	}
	before, err := client.GetMyFollowStatus(context.Background(), request(episodeFollowTarget(episode.PublicID)))
	if err != nil {
		t.Fatalf("GetMyFollowStatus before follow: %v", err)
	}
	if before.Msg.IsFollowing {
		t.Fatal("is_following = true before follow")
	}

	follow := func(target *publirav1.FollowTarget) *connect.Response[publirav1.FollowResponse] {
		response, callErr := client.Follow(context.Background(), newBearerRequest(&publirav1.FollowRequest{Tenant: tenantContext(tenant), Target: target}, tokenFor(t, tenant, member)))
		if callErr != nil {
			t.Fatalf("Follow: %v", callErr)
		}
		if response.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("Cache-Control = %q, want private, no-store", response.Header().Get("Cache-Control"))
		}
		return response
	}
	if !follow(episodeFollowTarget(episode.PublicID)).Msg.IsFollowing {
		t.Fatal("episode Follow is_following = false")
	}
	// A duplicate is successful but still produces one durable relation.
	follow(episodeFollowTarget(episode.PublicID))
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_follows WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3", tenant.ID, member.ID, episode.ID); got != 1 {
		t.Fatalf("episode follow rows = %d, want 1", got)
	}
	otherMember := env.PG.SeedTenantUser(t, tenant.ID, "OTHERFOLA", "other-follow-a@example.com", "Other Member", "tenant_member")
	otherStatus, err := client.GetMyFollowStatus(context.Background(), newBearerRequest(&publirav1.GetMyFollowStatusRequest{Tenant: tenantContext(tenant), Target: episodeFollowTarget(episode.PublicID)}, tokenFor(t, tenant, otherMember)))
	if err != nil {
		t.Fatalf("other member GetMyFollowStatus: %v", err)
	}
	if otherStatus.Msg.IsFollowing {
		t.Fatal("other member can see the first member's follow")
	}
	if !follow(authorFollowTarget(author.PublicID)).Msg.IsFollowing {
		t.Fatal("author Follow is_following = false")
	}
	if !follow(seriesFollowTarget(series.PublicID)).Msg.IsFollowing {
		t.Fatal("series Follow is_following = false")
	}
	follow(seriesFollowTarget(series.PublicID))
	if got := env.countRows(t, "SELECT COUNT(*) FROM series_follows WHERE tenant_id = $1 AND user_id = $2 AND series_id = $3", tenant.ID, member.ID, series.ID); got != 1 {
		t.Fatalf("series follow rows = %d, want 1", got)
	}

	after, err := client.GetMyFollowStatus(context.Background(), request(episodeFollowTarget(episode.PublicID)))
	if err != nil {
		t.Fatalf("GetMyFollowStatus after follow: %v", err)
	}
	if !after.Msg.IsFollowing {
		t.Fatal("is_following = false after follow")
	}

	unfollow := func() {
		response, callErr := client.Unfollow(context.Background(), newBearerRequest(&publirav1.UnfollowRequest{Tenant: tenantContext(tenant), Target: episodeFollowTarget(episode.PublicID)}, tokenFor(t, tenant, member)))
		if callErr != nil {
			t.Fatalf("Unfollow: %v", callErr)
		}
		if response.Msg.IsFollowing {
			t.Fatal("Unfollow is_following = true")
		}
	}
	unfollow()
	unfollow()
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_follows WHERE tenant_id = $1 AND user_id = $2 AND episode_id = $3", tenant.ID, member.ID, episode.ID); got != 0 {
		t.Fatalf("episode follow rows after unfollow = %d, want 0", got)
	}
}

func TestDBFollowServiceListsOnlyPublicTargetsWithCursor(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTFOLB", "follow-b.example.com", "Follow B")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERFOLB", "member-follow-b@example.com", "Member B", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESFOLB1", Title: "Public series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEFOLB", Title: "Public episode", Status: testutil.EpisodeStatusPublished})
	author := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORFOLB1", Name: "Public author"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, author.ID, "writer")
	draftSeries := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT", Title: "Draft series"})
	draftEpisode := env.PG.SeedEpisode(t, tenant.ID, draftSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEDRFT", Title: "Draft episode", Status: testutil.EpisodeStatusPublished})

	// Seed the durable relations directly so a no-longer-public target exercises
	// the list filter without letting the public Follow RPC create it.
	ctx := context.Background()
	if _, err := env.PG.DB.ExecContext(ctx, "INSERT INTO episode_follows (tenant_id, user_id, episode_id, created_at) VALUES ($1, $2, $3, $4)", tenant.ID, member.ID, episode.ID, time.Now().Add(-2*time.Minute)); err != nil {
		t.Fatalf("insert public episode follow: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, "INSERT INTO creator_follows (tenant_id, user_id, creator_id, created_at) VALUES ($1, $2, $3, $4)", tenant.ID, member.ID, author.ID, time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("insert public author follow: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, "INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)", tenant.ID, member.ID, draftEpisode.ID); err != nil {
		t.Fatalf("insert draft episode follow: %v", err)
	}

	client := env.followClient()
	first, err := client.ListMyFollows(context.Background(), newBearerRequest(&publirav1.ListMyFollowsRequest{Tenant: tenantContext(tenant), Limit: 1}, tokenFor(t, tenant, member)))
	if err != nil {
		t.Fatalf("ListMyFollows page 1: %v", err)
	}
	if len(first.Msg.Follows) != 1 || first.Msg.Follows[0].TargetType != publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_AUTHOR || first.Msg.Follows[0].TargetPublicId != author.PublicID {
		t.Fatalf("page 1 = %#v, want author follow only", first.Msg.Follows)
	}
	if first.Msg.NextToken == "" || first.Msg.PreviousToken != "" {
		t.Fatalf("page 1 tokens = (%q, %q), want empty previous and non-empty next", first.Msg.PreviousToken, first.Msg.NextToken)
	}

	second, err := client.ListMyFollows(context.Background(), newBearerRequest(&publirav1.ListMyFollowsRequest{Tenant: tenantContext(tenant), Limit: 1, Token: first.Msg.NextToken}, tokenFor(t, tenant, member)))
	if err != nil {
		t.Fatalf("ListMyFollows page 2: %v", err)
	}
	if len(second.Msg.Follows) != 1 || second.Msg.Follows[0].TargetType != publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_EPISODE || second.Msg.Follows[0].TargetPublicId != episode.PublicID {
		t.Fatalf("page 2 = %#v, want episode follow only", second.Msg.Follows)
	}
	if second.Msg.PreviousToken == "" || second.Msg.NextToken != "" {
		t.Fatalf("page 2 tokens = (%q, %q), want non-empty previous and empty next", second.Msg.PreviousToken, second.Msg.NextToken)
	}

	back, err := client.ListMyFollows(context.Background(), newBearerRequest(&publirav1.ListMyFollowsRequest{Tenant: tenantContext(tenant), Limit: 1, Token: second.Msg.PreviousToken}, tokenFor(t, tenant, member)))
	if err != nil {
		t.Fatalf("ListMyFollows previous page: %v", err)
	}
	if len(back.Msg.Follows) != 1 || back.Msg.Follows[0].TargetPublicId != author.PublicID {
		t.Fatalf("previous page = %#v, want author follow", back.Msg.Follows)
	}
}

func TestDBFollowServiceDoesNotRevealUnavailableTargets(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant, otherTenant := env.seedTwoTenants(t)
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERFOLC", "member-follow-c@example.com", "Member C", "tenant_member")
	draftSeries := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESFOLC1", Title: "Draft series"})
	draftEpisode := env.PG.SeedEpisode(t, tenant.ID, draftSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEFOLC", Title: "Draft episode", Status: testutil.EpisodeStatusPublished})
	foreignSeries := env.PG.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "SERIESFOLC2", Title: "Foreign series", Published: true})
	foreignEpisode := env.PG.SeedEpisode(t, otherTenant.ID, foreignSeries.ID, testutil.EpisodeSeed{PublicID: "EPISODEFOLD", Title: "Foreign episode", Status: testutil.EpisodeStatusPublished})
	client := env.followClient()

	for _, target := range []*publirav1.FollowTarget{episodeFollowTarget(draftEpisode.PublicID), episodeFollowTarget(foreignEpisode.PublicID), episodeFollowTarget("MISSINGFOLLO"), seriesFollowTarget(draftSeries.PublicID), seriesFollowTarget(foreignSeries.PublicID), seriesFollowTarget("MISSINGFOLLS")} {
		_, err := client.Follow(context.Background(), newBearerRequest(&publirav1.FollowRequest{Tenant: tenantContext(tenant), Target: target}, tokenFor(t, tenant, member)))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("Follow %q code = %v, want not_found (err=%v)", target.PublicId, connect.CodeOf(err), err)
		}
	}

	_, err := client.ListMyFollows(context.Background(), connect.NewRequest(&publirav1.ListMyFollowsRequest{Tenant: tenantContext(tenant)}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("anonymous ListMyFollows code = %v, want unauthenticated (err=%v)", connect.CodeOf(err), err)
	}
}
