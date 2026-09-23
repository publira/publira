package publicapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// surfaceShelf is the part of a reader's own state that belongs to one work: a
// series kept to one surface, the episode the reader followed, finished, saved
// a position in, and bought, and the creator credited on it.
type surfaceShelf struct {
	series  testutil.Series
	episode testutil.Episode
	creator testutil.Creator
	comment string
}

// memberSurfaceFixture is one reader who followed, read, bought, and saw a
// comment on a web-only work from the storefront and an app-only work from the
// app, so every member read has one work to show on each surface.
type memberSurfaceFixture struct {
	env     *publicDBEnv
	tenant  testutil.Tenant
	member  testutil.TenantUser
	webOnly surfaceShelf
	appOnly surfaceShelf
}

var (
	unnamedSurface = publirattypesv1.ClientSurface_CLIENT_SURFACE_UNSPECIFIED
	webSurface     = publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB
	appSurface     = publirattypesv1.ClientSurface_CLIENT_SURFACE_APP
)

func newMemberSurfaceFixture(t *testing.T) memberSurfaceFixture {
	t.Helper()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTMSURF", "member-surface.example.com", "Member Surface")
	env.setCommentMode(t, tenant.ID, "immediate")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERMSURF", "member-surface@example.com", "Reader", "tenant_member")
	commenter := env.PG.SeedTenantUser(t, tenant.ID, "COMMENTMSURF", "commenter-surface@example.com", "Commenter", "tenant_member")
	fixture := memberSurfaceFixture{env: env, tenant: tenant, member: member}

	seed := func(prefix, availability string, surface publirattypesv1.ClientSurface) surfaceShelf {
		series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:     prefix + "SERIES001",
			Title:        prefix + " series",
			Published:    true,
			Availability: availability,
		})
		creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: prefix + "CREATOR01", Name: prefix + " creator"})
		env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")
		episode := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{
			PublicID: prefix + "EPISODE01",
			Title:    prefix + " episode 1",
			Status:   testutil.EpisodeStatusPublished,
		}, 4)
		// A second episode the reader has not finished, so the series stays in
		// their "continue reading" row after the first one is marked as read.
		env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
			PublicID: prefix + "EPISODE02",
			Title:    prefix + " episode 2",
			Status:   testutil.EpisodeStatusPublished,
		})
		env.PG.SeedPurchase(t, tenant.ID, member.ID, episode.ID, 0)
		shelf := surfaceShelf{series: series, episode: episode, creator: creator}

		// Every write goes through the surface the work is kept to, which is also
		// what proves each of them is accepted there.
		ctx := context.Background()
		token := tokenFor(t, tenant, member)
		for _, target := range []*publirav1.FollowTarget{
			seriesFollowTarget(series.PublicID),
			episodeFollowTarget(episode.PublicID),
			creatorFollowTarget(creator.PublicID),
		} {
			if _, err := env.followClient().Follow(ctx, newBearerRequest(&publirav1.FollowRequest{Tenant: tenantContext(tenant), Target: target, Surface: surface}, token)); err != nil {
				t.Fatalf("Follow %s on its surface: %v", target.GetPublicId(), err)
			}
		}
		if _, err := env.episodeReadClient().MarkEpisodeAsRead(ctx, newBearerRequest(&publirav1.MarkEpisodeAsReadRequest{Tenant: tenantContext(tenant), EpisodePublicId: episode.PublicID, Surface: surface}, token)); err != nil {
			t.Fatalf("MarkEpisodeAsRead on its surface: %v", err)
		}
		if _, err := env.episodeReadClient().SaveReadingPosition(ctx, newBearerRequest(&publirav1.SaveReadingPositionRequest{Tenant: tenantContext(tenant), EpisodePublicId: episode.PublicID, PageIndex: 2, Surface: surface}, token)); err != nil {
			t.Fatalf("SaveReadingPosition on its surface: %v", err)
		}
		if _, err := env.ratingClient().RateEpisode(ctx, newBearerRequest(&publirav1.RateEpisodeRequest{Tenant: tenantContext(tenant), EpisodePublicId: episode.PublicID, Surface: surface}, token)); err != nil {
			t.Fatalf("RateEpisode on its surface: %v", err)
		}
		if _, err := env.contentViewClient().RecordContentView(ctx, connect.NewRequest(&publirav1.RecordContentViewRequest{
			Tenant:  tenantContext(tenant),
			Target:  &publirav1.ContentViewTarget{Type: publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_EPISODE, PublicId: episode.PublicID},
			Surface: surface,
		})); err != nil {
			t.Fatalf("RecordContentView on its surface: %v", err)
		}
		posted, err := env.commentClient().PostEpisodeComment(ctx, newBearerRequest(&publirav1.PostEpisodeCommentRequest{
			Tenant:          tenantContext(tenant),
			EpisodePublicId: episode.PublicID,
			Body:            prefix + " was worth the wait.",
			Surface:         surface,
		}, tokenFor(t, tenant, commenter)))
		if err != nil {
			t.Fatalf("PostEpisodeComment on its surface: %v", err)
		}
		shelf.comment = posted.Msg.Comment.GetPublicId()
		return shelf
	}
	fixture.webOnly = seed("WEB", "web", webSurface)
	fixture.appOnly = seed("APP", "app", appSurface)
	return fixture
}

func (f memberSurfaceFixture) token(t *testing.T) string {
	t.Helper()
	return tokenFor(t, f.tenant, f.member)
}

// Every list of the reader's own holds the work their surface may show and
// leaves out the one it may not, and a client that names no surface is
// answered as the storefront.
func TestDBMemberListsShowAWorkOnlyOnItsSurfaces(t *testing.T) {
	fixture := newMemberSurfaceFixture(t)
	ctx := context.Background()
	tenant := tenantContext(fixture.tenant)

	tests := []struct {
		name    string
		surface publirattypesv1.ClientSurface
		shown   surfaceShelf
		hidden  surfaceShelf
	}{
		{name: "unnamed", surface: unnamedSurface, shown: fixture.webOnly, hidden: fixture.appOnly},
		{name: "web", surface: webSurface, shown: fixture.webOnly, hidden: fixture.appOnly},
		{name: "app", surface: appSurface, shown: fixture.appOnly, hidden: fixture.webOnly},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			token := fixture.token(t)

			follows, err := fixture.env.followClient().ListMyFollows(ctx, newBearerRequest(&publirav1.ListMyFollowsRequest{Tenant: tenant, Surface: tc.surface}, token))
			if err != nil {
				t.Fatalf("ListMyFollows: %v", err)
			}
			followed := make([]string, 0, len(follows.Msg.Follows))
			for _, follow := range follows.Msg.Follows {
				followed = append(followed, follow.GetTargetPublicId())
			}
			slices.Sort(followed)
			wantFollowed := []string{tc.shown.series.PublicID, tc.shown.episode.PublicID, tc.shown.creator.PublicID}
			slices.Sort(wantFollowed)
			if !slices.Equal(followed, wantFollowed) {
				t.Fatalf("ListMyFollows = %v, want %v", followed, wantFollowed)
			}

			updates, err := fixture.env.followClient().ListMyFollowUpdates(ctx, newBearerRequest(&publirav1.ListMyFollowUpdatesRequest{Tenant: tenant, Surface: tc.surface}, token))
			if err != nil {
				t.Fatalf("ListMyFollowUpdates: %v", err)
			}
			for _, update := range updates.Msg.Updates {
				if update.GetSeries().GetPublicId() != tc.shown.series.PublicID {
					t.Fatalf("ListMyFollowUpdates names series %s, want only %s", update.GetSeries().GetPublicId(), tc.shown.series.PublicID)
				}
			}
			if len(updates.Msg.Updates) != 2 {
				t.Fatalf("ListMyFollowUpdates = %d updates, want the 2 episodes of %s", len(updates.Msg.Updates), tc.shown.series.PublicID)
			}

			reads, err := fixture.env.episodeReadClient().ListMyEpisodeReads(ctx, newBearerRequest(&publirav1.ListMyEpisodeReadsRequest{Tenant: tenant, Surface: tc.surface}, token))
			if err != nil {
				t.Fatalf("ListMyEpisodeReads: %v", err)
			}
			if len(reads.Msg.Reads) != 1 || reads.Msg.Reads[0].GetEpisode().GetPublicId() != tc.shown.episode.PublicID {
				t.Fatalf("ListMyEpisodeReads = %v, want only %s", reads.Msg.Reads, tc.shown.episode.PublicID)
			}

			recent, err := fixture.env.episodeReadClient().ListMyRecentSeries(ctx, newBearerRequest(&publirav1.ListMyRecentSeriesRequest{Tenant: tenant, Surface: tc.surface}, token))
			if err != nil {
				t.Fatalf("ListMyRecentSeries: %v", err)
			}
			if len(recent.Msg.Series) != 1 || recent.Msg.Series[0].GetSeries().GetPublicId() != tc.shown.series.PublicID {
				t.Fatalf("ListMyRecentSeries = %v, want only %s", recentSeriesPublicIDs(recent.Msg.Series), tc.shown.series.PublicID)
			}

			purchases, err := fixture.env.purchaseClient().ListMyPurchases(ctx, newBearerRequest(&publirav1.ListMyPurchasesRequest{Tenant: tenant, Surface: tc.surface}, token))
			if err != nil {
				t.Fatalf("ListMyPurchases: %v", err)
			}
			if len(purchases.Msg.Purchases) != 1 || purchases.Msg.Purchases[0].GetEpisode().GetPublicId() != tc.shown.episode.PublicID {
				t.Fatalf("ListMyPurchases = %v, want only %s", purchases.Msg.Purchases, tc.shown.episode.PublicID)
			}

			shownProgress, err := fixture.env.episodeReadClient().GetMySeriesProgress(ctx, newBearerRequest(&publirav1.GetMySeriesProgressRequest{Tenant: tenant, SeriesPublicId: tc.shown.series.PublicID, Surface: tc.surface}, token))
			if err != nil {
				t.Fatalf("GetMySeriesProgress of the shown series: %v", err)
			}
			if shownProgress.Msg.Progress.GetEpisode().GetPublicId() != tc.shown.episode.PublicID {
				t.Fatalf("GetMySeriesProgress of the shown series = %v, want %s", shownProgress.Msg.Progress, tc.shown.episode.PublicID)
			}
			hiddenProgress, err := fixture.env.episodeReadClient().GetMySeriesProgress(ctx, newBearerRequest(&publirav1.GetMySeriesProgressRequest{Tenant: tenant, SeriesPublicId: tc.hidden.series.PublicID, Surface: tc.surface}, token))
			if err != nil {
				t.Fatalf("GetMySeriesProgress of the hidden series: %v", err)
			}
			if hiddenProgress.Msg.Progress != nil {
				t.Fatalf("GetMySeriesProgress of the hidden series = %v, want none", hiddenProgress.Msg.Progress)
			}

			hiddenPosition, err := fixture.env.episodeReadClient().GetMyReadingPosition(ctx, newBearerRequest(&publirav1.GetMyReadingPositionRequest{Tenant: tenant, EpisodePublicId: tc.hidden.episode.PublicID, Surface: tc.surface}, token))
			if err != nil {
				t.Fatalf("GetMyReadingPosition of the hidden episode: %v", err)
			}
			if hiddenPosition.Msg.Position != nil {
				t.Fatalf("GetMyReadingPosition of the hidden episode = %v, want none", hiddenPosition.Msg.Position)
			}
		})
	}
}

// A read or write of a work by public ID from a surface that may not show it
// answers not_found, exactly as it does for an unpublished work.
func TestDBMemberCallsRefuseAWorkTheSurfaceMayNotShow(t *testing.T) {
	fixture := newMemberSurfaceFixture(t)
	ctx := context.Background()
	tenant := tenantContext(fixture.tenant)

	tests := []struct {
		name    string
		surface publirattypesv1.ClientSurface
		hidden  surfaceShelf
	}{
		{name: "unnamed", surface: unnamedSurface, hidden: fixture.appOnly},
		{name: "web", surface: webSurface, hidden: fixture.appOnly},
		{name: "app", surface: appSurface, hidden: fixture.webOnly},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			token := fixture.token(t)
			episodeID := tc.hidden.episode.PublicID
			seriesID := tc.hidden.series.PublicID

			calls := map[string]func() error{
				"GetMyFollowStatus": func() error {
					_, err := fixture.env.followClient().GetMyFollowStatus(ctx, newBearerRequest(&publirav1.GetMyFollowStatusRequest{Tenant: tenant, Target: seriesFollowTarget(seriesID), Surface: tc.surface}, token))
					return err
				},
				"Follow creator": func() error {
					_, err := fixture.env.followClient().Follow(ctx, newBearerRequest(&publirav1.FollowRequest{Tenant: tenant, Target: creatorFollowTarget(tc.hidden.creator.PublicID), Surface: tc.surface}, token))
					return err
				},
				"Unfollow": func() error {
					_, err := fixture.env.followClient().Unfollow(ctx, newBearerRequest(&publirav1.UnfollowRequest{Tenant: tenant, Target: episodeFollowTarget(episodeID), Surface: tc.surface}, token))
					return err
				},
				"MarkEpisodeAsRead": func() error {
					_, err := fixture.env.episodeReadClient().MarkEpisodeAsRead(ctx, newBearerRequest(&publirav1.MarkEpisodeAsReadRequest{Tenant: tenant, EpisodePublicId: episodeID, Surface: tc.surface}, token))
					return err
				},
				"SaveReadingPosition": func() error {
					_, err := fixture.env.episodeReadClient().SaveReadingPosition(ctx, newBearerRequest(&publirav1.SaveReadingPositionRequest{Tenant: tenant, EpisodePublicId: episodeID, PageIndex: 1, Surface: tc.surface}, token))
					return err
				},
				"RateEpisode": func() error {
					_, err := fixture.env.ratingClient().RateEpisode(ctx, newBearerRequest(&publirav1.RateEpisodeRequest{Tenant: tenant, EpisodePublicId: episodeID, Surface: tc.surface}, token))
					return err
				},
				"GetMyEpisodeRating": func() error {
					_, err := fixture.env.ratingClient().GetMyEpisodeRating(ctx, newBearerRequest(&publirav1.GetMyEpisodeRatingRequest{Tenant: tenant, EpisodePublicId: episodeID, Surface: tc.surface}, token))
					return err
				},
				"GetMySeriesRating": func() error {
					_, err := fixture.env.ratingClient().GetMySeriesRating(ctx, newBearerRequest(&publirav1.GetMySeriesRatingRequest{Tenant: tenant, SeriesPublicId: seriesID, Surface: tc.surface}, token))
					return err
				},
				"RecordContentView series": func() error {
					_, err := fixture.env.contentViewClient().RecordContentView(ctx, connect.NewRequest(&publirav1.RecordContentViewRequest{
						Tenant:  tenant,
						Target:  &publirav1.ContentViewTarget{Type: publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_SERIES, PublicId: seriesID},
						Surface: tc.surface,
					}))
					return err
				},
				"RecordContentView episode": func() error {
					_, err := fixture.env.contentViewClient().RecordContentView(ctx, connect.NewRequest(&publirav1.RecordContentViewRequest{
						Tenant:  tenant,
						Target:  &publirav1.ContentViewTarget{Type: publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_EPISODE, PublicId: episodeID},
						Surface: tc.surface,
					}))
					return err
				},
				"ListEpisodeComments": func() error {
					_, err := fixture.env.commentClient().ListEpisodeComments(ctx, connect.NewRequest(&publirav1.ListEpisodeCommentsRequest{Tenant: tenant, EpisodePublicId: episodeID, Surface: tc.surface}))
					return err
				},
				"ListMyEpisodeComments": func() error {
					_, err := fixture.env.commentClient().ListMyEpisodeComments(ctx, newBearerRequest(&publirav1.ListMyEpisodeCommentsRequest{Tenant: tenant, EpisodePublicId: episodeID, Surface: tc.surface}, token))
					return err
				},
				"PostEpisodeComment": func() error {
					_, err := fixture.env.commentClient().PostEpisodeComment(ctx, newBearerRequest(&publirav1.PostEpisodeCommentRequest{Tenant: tenant, EpisodePublicId: episodeID, Body: "Posted from the wrong place.", Surface: tc.surface}, token))
					return err
				},
				"ReportEpisodeComment": func() error {
					_, err := fixture.env.commentClient().ReportEpisodeComment(ctx, newBearerRequest(&publirav1.ReportEpisodeCommentRequest{
						Tenant:          tenant,
						CommentPublicId: tc.hidden.comment,
						Reason:          publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM,
						Surface:         tc.surface,
					}, token))
					return err
				},
			}
			for name, call := range calls {
				if err := call(); connect.CodeOf(err) != connect.CodeNotFound {
					t.Errorf("%s of a hidden work = %v, want not_found", name, err)
				}
			}
		})
	}

	// Nothing the refused calls were asked to write was written.
	if got := fixture.env.countRows(t, "SELECT COUNT(*) FROM episode_comments WHERE tenant_id = $1", fixture.tenant.ID); got != 2 {
		t.Fatalf("comments = %d, want the 2 posted on their own surfaces", got)
	}
	if got := fixture.env.countRows(t, "SELECT COUNT(*) FROM episode_follows WHERE tenant_id = $1", fixture.tenant.ID); got != 2 {
		t.Fatalf("episode follows = %d, want the 2 followed on their own surfaces", got)
	}
	if got := fixture.env.countRows(t, "SELECT COUNT(*) FROM episode_comment_reports WHERE tenant_id = $1", fixture.tenant.ID); got != 0 {
		t.Fatalf("comment reports = %d, want none", got)
	}
}

// A member list token names the surface it was built on, as a catalog token
// does, so a read from another surface refuses it rather than paging a list
// that holds other rows.
func TestDBMemberListsRefuseATokenFromAnotherSurface(t *testing.T) {
	fixture := newMemberSurfaceFixture(t)
	ctx := context.Background()
	tenant := tenantContext(fixture.tenant)
	token := fixture.token(t)

	first, err := fixture.env.followClient().ListMyFollows(ctx, newBearerRequest(&publirav1.ListMyFollowsRequest{Tenant: tenant, Limit: 1, Surface: webSurface}, token))
	if err != nil {
		t.Fatalf("ListMyFollows: %v", err)
	}
	if first.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a second page")
	}
	_, err = fixture.env.followClient().ListMyFollows(ctx, newBearerRequest(&publirav1.ListMyFollowsRequest{Tenant: tenant, Limit: 1, Token: first.Msg.NextToken, Surface: appSurface}, token))
	assertConnectCode(t, err, connect.CodeInvalidArgument)
	if _, err := fixture.env.followClient().ListMyFollows(ctx, newBearerRequest(&publirav1.ListMyFollowsRequest{Tenant: tenant, Limit: 1, Token: first.Msg.NextToken, Surface: webSurface}, token)); err != nil {
		t.Fatalf("ListMyFollows with its own surface's token: %v", err)
	}

	_, err = fixture.env.purchaseClient().ListMyPurchases(ctx, newBearerRequest(&publirav1.ListMyPurchasesRequest{Tenant: tenant, Surface: publirattypesv1.ClientSurface(99)}, token))
	assertConnectCode(t, err, connect.CodeInvalidArgument)
}
