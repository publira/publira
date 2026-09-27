package publicapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A client names a record by the ID a response gave it. These read the IDs off
// the catalog and send them back to every RPC that acts on the record.

func TestDBCatalogReadsCarryTheInternalIDs(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTIDSA", "ids-a.example.com", "IDs A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESIDSA", Title: "Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEIDSA", Title: "Episode", Status: testutil.EpisodeStatusPublished})
	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORIDSA", Name: "Creator"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")
	client := env.catalogClient()

	detail, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if got := detail.Msg.Series.GetId(); got != series.ID.String() {
		t.Fatalf("series id = %q, want %s", got, series.ID)
	}
	if len(detail.Msg.Episodes) != 1 || detail.Msg.Episodes[0].GetId() != episode.ID.String() {
		t.Fatalf("episodes = %+v, want %s carrying its id", detail.Msg.Episodes, episode.ID)
	}
	if credits := detail.Msg.Series.GetCreators(); len(credits) != 1 || credits[0].GetId() != creator.ID.String() {
		t.Fatalf("credits = %+v, want %s carrying its id", credits, creator.ID)
	}

	episodeDetail, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if got := episodeDetail.Msg.Episode.GetId(); got != episode.ID.String() {
		t.Fatalf("episode id = %q, want %s", got, episode.ID)
	}
	if got := episodeDetail.Msg.Series.GetId(); got != series.ID.String() {
		t.Fatalf("episode's series id = %q, want %s", got, series.ID)
	}

	access, err := client.GetSeriesEpisodeAccess(context.Background(), connect.NewRequest(&publirav1.GetSeriesEpisodeAccessRequest{
		Tenant:   tenantContext(tenant),
		SeriesId: series.ID.String(),
	}))
	if err != nil {
		t.Fatalf("GetSeriesEpisodeAccess: %v", err)
	}
	if len(access.Msg.Episodes) != 1 || access.Msg.Episodes[0].GetEpisodeId() != episode.ID.String() {
		t.Fatalf("episode access = %+v, want %s carrying its id", access.Msg.Episodes, episode.ID)
	}
}

func TestDBReaderStateRPCsAddressTheEpisodeAndTheSeriesByID(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTIDSB", "ids-b.example.com", "IDs B")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERIDSB", "member-ids-b@example.com", "Member B", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESIDSB", Title: "Series", Published: true})
	episode := seedEpisodeWithPages(t, env, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEIDSB", Title: "Episode", Status: testutil.EpisodeStatusPublished}, 10)
	token := tokenFor(t, tenant, member)
	reads := env.episodeReadClient()

	if _, err := reads.MarkEpisodeAsRead(context.Background(), newBearerRequest(&publirav1.MarkEpisodeAsReadRequest{
		Tenant:    tenantContext(tenant),
		EpisodeId: episode.ID.String(),
	}, token)); err != nil {
		t.Fatalf("MarkEpisodeAsRead: %v", err)
	}

	saved, err := reads.SaveReadingPosition(context.Background(), newBearerRequest(&publirav1.SaveReadingPositionRequest{
		Tenant:    tenantContext(tenant),
		EpisodeId: episode.ID.String(),
		PageIndex: 4,
	}, token))
	if err != nil {
		t.Fatalf("SaveReadingPosition: %v", err)
	}
	if got := saved.Msg.Position.GetEpisodePublicId(); got != episode.PublicID {
		t.Fatalf("saved position names %q, want %s", got, episode.PublicID)
	}

	position, err := reads.GetMyReadingPosition(context.Background(), newBearerRequest(&publirav1.GetMyReadingPositionRequest{
		Tenant:    tenantContext(tenant),
		EpisodeId: episode.ID.String(),
	}, token))
	if err != nil {
		t.Fatalf("GetMyReadingPosition: %v", err)
	}
	if position.Msg.Position.GetPageIndex() != 4 || position.Msg.Position.GetEpisodePublicId() != episode.PublicID {
		t.Fatalf("position = %+v, want page 4 of %s", position.Msg.Position, episode.PublicID)
	}

	progress, err := reads.GetMySeriesProgress(context.Background(), newBearerRequest(&publirav1.GetMySeriesProgressRequest{
		Tenant:   tenantContext(tenant),
		SeriesId: series.ID.String(),
	}, token))
	if err != nil {
		t.Fatalf("GetMySeriesProgress: %v", err)
	}
	if !slices.Equal(progress.Msg.FinishedEpisodePublicIds, []string{episode.PublicID}) {
		t.Fatalf("finished episodes = %v, want %s", progress.Msg.FinishedEpisodePublicIds, episode.PublicID)
	}
	if got := progress.Msg.Progress.GetEpisode().GetId(); got != episode.ID.String() {
		t.Fatalf("progress episode id = %q, want %s", got, episode.ID)
	}

	ratings := env.ratingClient()
	rated, err := ratings.RateEpisode(context.Background(), newBearerRequest(&publirav1.RateEpisodeRequest{
		Tenant:    tenantContext(tenant),
		EpisodeId: episode.ID.String(),
	}, token))
	if err != nil {
		t.Fatalf("RateEpisode: %v", err)
	}
	mine, err := ratings.GetMyEpisodeRating(context.Background(), newBearerRequest(&publirav1.GetMyEpisodeRatingRequest{
		Tenant:    tenantContext(tenant),
		EpisodeId: episode.ID.String(),
	}, token))
	if err != nil {
		t.Fatalf("GetMyEpisodeRating: %v", err)
	}
	if mine.Msg.Score != rated.Msg.Score {
		t.Fatalf("my rating = %d, want the %d just given", mine.Msg.Score, rated.Msg.Score)
	}
	if _, err := ratings.GetMySeriesRating(context.Background(), newBearerRequest(&publirav1.GetMySeriesRatingRequest{
		Tenant:   tenantContext(tenant),
		SeriesId: series.ID.String(),
	}, token)); err != nil {
		t.Fatalf("GetMySeriesRating: %v", err)
	}

	_, err = reads.MarkEpisodeAsRead(context.Background(), newBearerRequest(&publirav1.MarkEpisodeAsReadRequest{
		Tenant:    tenantContext(tenant),
		EpisodeId: episode.PublicID,
	}, token))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("MarkEpisodeAsRead with a public ID in episode_id error = %v, want invalid_argument", err)
	}
}

func TestDBCommentRPCsAddressTheEpisodeAndTheCommentByID(t *testing.T) {
	fixture := newCommentFixture(t, "CID")
	env, tenant, author, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")
	reporter := env.PG.SeedEndUser(t, tenant.ID, "CIDREADER", "cid-reader@example.com", "Reporting Reader")
	comments := env.commentClient()

	posted, err := comments.PostEpisodeComment(context.Background(), newBearerRequest(&publirav1.PostEpisodeCommentRequest{
		Tenant:    tenantContext(tenant),
		EpisodeId: episode.ID.String(),
		Body:      "Addressed by its episode's ID.",
	}, tokenFor(t, tenant, author)))
	if err != nil {
		t.Fatalf("PostEpisodeComment: %v", err)
	}
	commentID := posted.Msg.Comment.GetId()
	if commentID == "" {
		t.Fatal("posted comment carries no id")
	}

	listed, err := comments.ListEpisodeComments(context.Background(), connect.NewRequest(&publirav1.ListEpisodeCommentsRequest{
		Tenant:    tenantContext(tenant),
		EpisodeId: episode.ID.String(),
	}))
	if err != nil {
		t.Fatalf("ListEpisodeComments: %v", err)
	}
	if len(listed.Msg.Comments) != 1 || listed.Msg.Comments[0].GetId() != commentID {
		t.Fatalf("comments = %+v, want the one posted carrying %s", listed.Msg.Comments, commentID)
	}

	if _, err := comments.ReportEpisodeComment(context.Background(), newBearerRequest(&publirav1.ReportEpisodeCommentRequest{
		Tenant:    tenantContext(tenant),
		CommentId: commentID,
		Reason:    publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM,
	}, tokenFor(t, tenant, reporter))); err != nil {
		t.Fatalf("ReportEpisodeComment: %v", err)
	}
	if got := env.openReportCount(t, tenant, posted.Msg.Comment.GetPublicId()); got != 1 {
		t.Fatalf("open_report_count = %d, want 1", got)
	}

	if _, err := comments.WithdrawEpisodeComment(context.Background(), newBearerRequest(&publirav1.WithdrawEpisodeCommentRequest{
		Tenant:    tenantContext(tenant),
		CommentId: commentID,
	}, tokenFor(t, tenant, author))); err != nil {
		t.Fatalf("WithdrawEpisodeComment: %v", err)
	}
	mine, err := comments.ListMyEpisodeComments(context.Background(), newBearerRequest(&publirav1.ListMyEpisodeCommentsRequest{
		Tenant:    tenantContext(tenant),
		EpisodeId: episode.ID.String(),
	}, tokenFor(t, tenant, author)))
	if err != nil {
		t.Fatalf("ListMyEpisodeComments: %v", err)
	}
	if len(mine.Msg.Comments) != 0 {
		t.Fatalf("author's comments after withdrawal = %+v, want none", mine.Msg.Comments)
	}
}

func TestDBFollowAndViewTargetsAreAddressedByID(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTIDSD", "ids-d.example.com", "IDs D")
	member := env.PG.SeedTenantUser(t, tenant.ID, "MEMBERIDSD", "member-ids-d@example.com", "Member D", "tenant_member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESIDSD", Title: "Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEIDSD", Title: "Episode", Status: testutil.EpisodeStatusPublished})
	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORIDSD", Name: "Creator"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")
	token := tokenFor(t, tenant, member)

	detail, err := env.catalogClient().GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: creator.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail: %v", err)
	}
	if got := detail.Msg.Creator.GetId(); got != creator.ID.String() {
		t.Fatalf("creator id = %q, want %s", got, creator.ID)
	}

	follows := env.followClient()
	for _, target := range []*publirav1.FollowTarget{
		{Type: publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_CREATOR, Id: creator.ID.String()},
		{Type: publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_SERIES, Id: series.ID.String()},
	} {
		if _, err := follows.Follow(context.Background(), newBearerRequest(&publirav1.FollowRequest{
			Tenant: tenantContext(tenant),
			Target: target,
		}, token)); err != nil {
			t.Fatalf("Follow %s: %v", target.Type, err)
		}
	}
	listed, err := follows.ListMyFollows(context.Background(), newBearerRequest(&publirav1.ListMyFollowsRequest{
		Tenant: tenantContext(tenant),
	}, token))
	if err != nil {
		t.Fatalf("ListMyFollows: %v", err)
	}
	targetIDs := make([]string, 0, len(listed.Msg.Follows))
	for _, follow := range listed.Msg.Follows {
		targetIDs = append(targetIDs, follow.GetTargetId())
	}
	slices.Sort(targetIDs)
	want := []string{creator.ID.String(), series.ID.String()}
	slices.Sort(want)
	if !slices.Equal(targetIDs, want) {
		t.Fatalf("followed target ids = %v, want %v", targetIDs, want)
	}
	status, err := follows.Unfollow(context.Background(), newBearerRequest(&publirav1.UnfollowRequest{
		Tenant: tenantContext(tenant),
		Target: &publirav1.FollowTarget{Type: publirav1.FollowTargetType_FOLLOW_TARGET_TYPE_SERIES, Id: series.ID.String()},
	}, token))
	if err != nil || status.Msg.IsFollowing {
		t.Fatalf("Unfollow = %v, %v, want no longer following", status, err)
	}

	for _, target := range []*publirav1.ContentViewTarget{
		{Type: publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_SERIES, Id: series.ID.String()},
		{Type: publirav1.ContentViewTargetType_CONTENT_VIEW_TARGET_TYPE_EPISODE, Id: episode.ID.String()},
	} {
		if _, err := env.contentViewClient().RecordContentView(context.Background(), connect.NewRequest(&publirav1.RecordContentViewRequest{
			Tenant: tenantContext(tenant),
			Target: target,
		})); err != nil {
			t.Fatalf("RecordContentView %s: %v", target.Type, err)
		}
	}
	if got := len(env.contentEvents(t, tenant.ID)); got != 2 {
		t.Fatalf("content_events = %d rows, want one per view", got)
	}
}
