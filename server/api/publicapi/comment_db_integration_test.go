package publicapi

import (
	"context"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Every rule CommentService enforces is decided by a stored row: the tenant's
// comment mode, the entitlement that makes an episode body readable, and the
// status that decides who may read a comment back. These run against a real
// database on the RLS-bound public role, the way a request does.

// setCommentMode writes the tenant's publishing policy for comments. A tenant
// seeded without a config row has none, which is the disabled default.
func (e *publicDBEnv) setCommentMode(t *testing.T, tenantID uuid.UUID, mode string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, comment_mode)
		VALUES ($1, $2)
		ON CONFLICT (tenant_id) DO UPDATE SET comment_mode = EXCLUDED.comment_mode
	`, tenantID, mode); err != nil {
		t.Fatalf("set comment_mode = %s: %v", mode, err)
	}
}

// adminCommentConsole is the moderation console as these tests drive it:
// AdminCommentService on its own RLS-bound role, reached with a staff token.
// Driving the real RPCs is what makes what staff can do a property of
// moderation rather than of a hand-written UPDATE a test invented.
type adminCommentConsole struct {
	client publiraadminv1connect.AdminCommentServiceClient
	token  string
}

func (e *publicDBEnv) openAdminCommentConsole(t *testing.T, tenant testutil.Tenant, staff testutil.TenantUser) adminCommentConsole {
	t.Helper()

	adminDB := e.PG.OpenAdminDB(t)
	adminHandler, err := adminapi.NewHandler(
		adminDB,
		dbmodels.New(adminDB),
		&testStorageProvider{},
		slog.Default(),
		nil,
		nil,
		testutil.TokenManager(),
	)
	if err != nil {
		t.Fatalf("new admin handler: %v", err)
	}
	adminServer := httptest.NewServer(adminHandler)
	t.Cleanup(adminServer.Close)

	token, _, err := testutil.TokenManager().Issue(
		staff.PublicID,
		auth.AudienceAdmin,
		tenant.ID.String(),
		staff.Role,
		staff.CredentialsVersion,
		time.Now(),
	)
	if err != nil {
		t.Fatalf("issue admin token: %v", err)
	}

	return adminCommentConsole{
		client: publiraadminv1connect.NewAdminCommentServiceClient(adminServer.Client(), adminServer.URL),
		token:  token,
	}
}

func (e *publicDBEnv) hideComment(t *testing.T, tenant testutil.Tenant, staff testutil.TenantUser, publicID string) {
	t.Helper()

	console := e.openAdminCommentConsole(t, tenant, staff)
	req := connect.NewRequest(&publiraadminv1.HideCommentRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		PublicId: publicID,
		Reason:   "Removed for this test.",
	})
	req.Header().Set("Authorization", "Bearer "+console.token)
	if _, err := console.client.HideComment(context.Background(), req); err != nil {
		t.Fatalf("HideComment %s: %v", publicID, err)
	}
}

func (e *publicDBEnv) postComment(
	t *testing.T,
	tenant testutil.Tenant,
	member testutil.TenantUser,
	episodePublicID, body string,
) (*publirav1.MyEpisodeComment, error) {
	t.Helper()

	res, err := e.commentClient().PostEpisodeComment(context.Background(), newBearerRequest(&publirav1.PostEpisodeCommentRequest{
		Tenant:          tenantContext(tenant),
		EpisodePublicId: episodePublicID,
		Body:            body,
	}, tokenFor(t, tenant, member)))
	if err != nil {
		return nil, err
	}
	return res.Msg.Comment, nil
}

func (e *publicDBEnv) mustPostComment(
	t *testing.T,
	tenant testutil.Tenant,
	member testutil.TenantUser,
	episodePublicID, body string,
) *publirav1.MyEpisodeComment {
	t.Helper()

	comment, err := e.postComment(t, tenant, member, episodePublicID, body)
	if err != nil {
		t.Fatalf("PostEpisodeComment %q: %v", body, err)
	}
	return comment
}

// listComments reads the public list, without a session, the way a visitor who
// never signed in does.
func (e *publicDBEnv) listComments(
	t *testing.T,
	tenant testutil.Tenant,
	episodePublicID string,
	limit int32,
	token string,
) *publirav1.ListEpisodeCommentsResponse {
	t.Helper()

	res, err := e.commentClient().ListEpisodeComments(context.Background(), connect.NewRequest(&publirav1.ListEpisodeCommentsRequest{
		Tenant:          tenantContext(tenant),
		EpisodePublicId: episodePublicID,
		Limit:           limit,
		Token:           token,
	}))
	if err != nil {
		t.Fatalf("ListEpisodeComments: %v", err)
	}
	return res.Msg
}

func (e *publicDBEnv) listMyComments(
	t *testing.T,
	tenant testutil.Tenant,
	member testutil.TenantUser,
	episodePublicID string,
) []*publirav1.MyEpisodeComment {
	t.Helper()

	res, err := e.commentClient().ListMyEpisodeComments(context.Background(), newBearerRequest(&publirav1.ListMyEpisodeCommentsRequest{
		Tenant:          tenantContext(tenant),
		EpisodePublicId: episodePublicID,
	}, tokenFor(t, tenant, member)))
	if err != nil {
		t.Fatalf("ListMyEpisodeComments: %v", err)
	}
	return res.Msg.Comments
}

func commentPublicIDs(comments []*publirav1.EpisodeComment) []string {
	publicIDs := make([]string, 0, len(comments))
	for _, comment := range comments {
		publicIDs = append(publicIDs, comment.PublicId)
	}
	return publicIDs
}

func myCommentPublicIDs(comments []*publirav1.MyEpisodeComment) []string {
	publicIDs := make([]string, 0, len(comments))
	for _, comment := range comments {
		publicIDs = append(publicIDs, comment.PublicId)
	}
	return publicIDs
}

func containsPublicID(publicIDs []string, want string) bool {
	for _, publicID := range publicIDs {
		if publicID == want {
			return true
		}
	}
	return false
}

// commentFixture is the tenant, member and free published episode every case
// below starts from.
type commentFixture struct {
	env     *publicDBEnv
	tenant  testutil.Tenant
	member  testutil.TenantUser
	episode testutil.Episode
}

func newCommentFixture(t *testing.T, prefix string) commentFixture {
	t.Helper()

	return newCommentFixtureWithGuards(t, prefix, openReaderGuards())
}

func newCommentFixtureWithGuards(t *testing.T, prefix string, guards readerGuards) commentFixture {
	t.Helper()

	env := newPublicDBEnvWithGuards(t, guards)
	tenant := env.seedTenant(t, prefix+"TENANT", prefix+"-comment.example.com", "Comment Tenant")
	member := env.PG.SeedEndUser(t, tenant.ID, prefix+"MEMBER", prefix+"-member@example.com", "Comment Member")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: prefix + "SERIES", Title: "Commented series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EPISODE",
		Title:    "Commented episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	return commentFixture{env: env, tenant: tenant, member: member, episode: episode}
}

func TestDBPostEpisodeCommentFollowsTheTenantCommentMode(t *testing.T) {
	fixture := newCommentFixture(t, "CMD")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode

	// A tenant that never opted in has no config row at all, which is the same
	// answer as the column's disabled default.
	_, err := env.postComment(t, tenant, member, episode.PublicID, "Comments are off here.")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("PostEpisodeComment with commenting off error = %v, want failed_precondition", err)
	}
	env.setCommentMode(t, tenant.ID, "disabled")
	if _, err := env.postComment(t, tenant, member, episode.PublicID, "Still off."); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("PostEpisodeComment under disabled error = %v, want failed_precondition", err)
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_comments WHERE tenant_id = $1", tenant.ID); got != 0 {
		t.Fatalf("episode_comments = %d rows, want a refused post to write nothing", got)
	}

	env.setCommentMode(t, tenant.ID, "immediate")
	immediate := env.mustPostComment(t, tenant, member, episode.PublicID, "Read this right away.")
	if immediate.AwaitingApproval {
		t.Fatalf("comment posted under immediate = awaiting approval, want published")
	}
	if got := commentPublicIDs(env.listComments(t, tenant, episode.PublicID, 0, "").Comments); !containsPublicID(got, immediate.PublicId) {
		t.Fatalf("public comments = %v, want the immediately published %s", got, immediate.PublicId)
	}
	// The public list already carries it, so the author's own list does not.
	if got := myCommentPublicIDs(env.listMyComments(t, tenant, member, episode.PublicID)); len(got) != 0 {
		t.Fatalf("own comments = %v, want none while every comment is public", got)
	}

	env.setCommentMode(t, tenant.ID, "approval_required")
	awaiting := env.mustPostComment(t, tenant, member, episode.PublicID, "Wait for a moderator.")
	if !awaiting.AwaitingApproval {
		t.Fatalf("comment posted under approval_required = published, want awaiting approval")
	}
	if got := commentPublicIDs(env.listComments(t, tenant, episode.PublicID, 0, "").Comments); containsPublicID(got, awaiting.PublicId) {
		t.Fatalf("public comments = %v, want the unapproved %s withheld", got, awaiting.PublicId)
	}
	if got := myCommentPublicIDs(env.listMyComments(t, tenant, member, episode.PublicID)); len(got) != 1 || got[0] != awaiting.PublicId {
		t.Fatalf("own comments = %v, want the unapproved %s rendered back to its author", got, awaiting.PublicId)
	}
}

func TestDBPostEpisodeCommentRequiresAReadableEpisodeBody(t *testing.T) {
	fixture := newCommentFixture(t, "ACC")
	env, tenant, member := fixture.env, fixture.tenant, fixture.member
	env.setCommentMode(t, tenant.ID, "immediate")

	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "ACCPAIDSER", Title: "Paid series", Published: true})
	paid := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "ACCPAIDEP",
		Title:    "Paid episode",
		Price:    500,
		Status:   testutil.EpisodeStatusPublished,
	})
	draft := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "ACCDRAFTEP", Title: "Draft episode"})

	// EPISODE_ACCESS_FREE.
	env.mustPostComment(t, tenant, member, fixture.episode.PublicID, "The free body is readable.")

	// EPISODE_ACCESS_LOCKED: the reader has not bought the body they would be
	// commenting on.
	_, err := env.postComment(t, tenant, member, paid.PublicID, "I have not read this.")
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("PostEpisodeComment on a locked episode error = %v, want permission_denied", err)
	}

	// EPISODE_ACCESS_ENTITLED.
	env.PG.SeedPurchase(t, tenant.ID, member.ID, paid.ID, 500)
	env.mustPostComment(t, tenant, member, paid.PublicID, "Now I have read it.")

	// An unpublished episode is not a target at all, and answers the same way a
	// missing one does.
	if _, err := env.postComment(t, tenant, member, draft.PublicID, "Not published yet."); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("PostEpisodeComment on a draft episode error = %v, want not_found", err)
	}
	if _, err := env.postComment(t, tenant, member, "NOSUCHEPISOD", "No such episode."); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("PostEpisodeComment on a missing episode error = %v, want not_found", err)
	}

	if _, err := env.postComment(t, tenant, member, fixture.episode.PublicID, "   "); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("PostEpisodeComment with a blank body error = %v, want invalid_argument", err)
	}
}

func TestDBPostEpisodeCommentRequiresAnActiveSession(t *testing.T) {
	fixture := newCommentFixture(t, "SES")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")

	_, err := env.commentClient().PostEpisodeComment(context.Background(), connect.NewRequest(&publirav1.PostEpisodeCommentRequest{
		Tenant:          tenantContext(tenant),
		EpisodePublicId: episode.PublicID,
		Body:            "Anonymous.",
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("PostEpisodeComment without a session error = %v, want unauthenticated", err)
	}

	// A suspended account keeps its token; the session check is what stops it.
	env.suspendUser(t, member.ID)
	if _, err := env.postComment(t, tenant, member, episode.PublicID, "Suspended."); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("PostEpisodeComment as a suspended member error = %v, want unauthenticated", err)
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_comments WHERE tenant_id = $1", tenant.ID); got != 0 {
		t.Fatalf("episode_comments = %d rows, want a refused post to write nothing", got)
	}

	// Reading stays public: no session, and the list still answers.
	env.listComments(t, tenant, episode.PublicID, 0, "")
}

func TestDBRemovedCommentStaysWithItsAuthorAndNobodyElse(t *testing.T) {
	fixture := newCommentFixture(t, "HID")
	env, tenant, author, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")

	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "HIDSTAFF", "hid-staff@example.com", "Moderator")
	other := env.PG.SeedEndUser(t, tenant.ID, "HIDOTHER", "hid-other@example.com", "Other Reader")

	kept := env.mustPostComment(t, tenant, author, episode.PublicID, "This one stays.")
	removed := env.mustPostComment(t, tenant, author, episode.PublicID, "This one is taken down.")
	env.hideComment(t, tenant, staff, removed.PublicId)

	// The author reads the removed comment exactly as it was: it comes back
	// through their own list, and nothing in it says it was removed.
	own := env.listMyComments(t, tenant, author, episode.PublicID)
	if got := myCommentPublicIDs(own); len(got) != 1 || got[0] != removed.PublicId {
		t.Fatalf("author's own comments = %v, want the removed %s", got, removed.PublicId)
	}
	if own[0].AwaitingApproval {
		t.Fatalf("removed comment = awaiting approval, want it rendered exactly as the published comment it was")
	}
	if own[0].Body != "This one is taken down." {
		t.Fatalf("removed comment body = %q, want it unchanged", own[0].Body)
	}

	// It is gone from the public list, including for the author, who reads that
	// list like every other visitor.
	if got := commentPublicIDs(env.listComments(t, tenant, episode.PublicID, 0, "").Comments); len(got) != 1 || got[0] != kept.PublicId {
		t.Fatalf("public comments = %v, want only %s", got, kept.PublicId)
	}
	// Another reader sees neither the comment nor any trace of it.
	if got := myCommentPublicIDs(env.listMyComments(t, tenant, other, episode.PublicID)); len(got) != 0 {
		t.Fatalf("another reader's own comments = %v, want none", got)
	}
}

func TestDBWithdrawEpisodeCommentIsTheAuthorsOwn(t *testing.T) {
	fixture := newCommentFixture(t, "WDR")
	env, tenant, author, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")

	other := env.PG.SeedEndUser(t, tenant.ID, "WDROTHER", "wdr-other@example.com", "Other Reader")
	comment := env.mustPostComment(t, tenant, author, episode.PublicID, "I will take this down.")

	withdraw := func(member testutil.TenantUser, publicID string) error {
		_, err := env.commentClient().WithdrawEpisodeComment(context.Background(), newBearerRequest(&publirav1.WithdrawEpisodeCommentRequest{
			Tenant:          tenantContext(tenant),
			CommentPublicId: publicID,
		}, tokenFor(t, tenant, member)))
		return err
	}

	if err := withdraw(other, comment.PublicId); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("withdrawing another reader's comment error = %v, want not_found", err)
	}
	if got := commentPublicIDs(env.listComments(t, tenant, episode.PublicID, 0, "").Comments); len(got) != 1 {
		t.Fatalf("public comments = %v, want the comment untouched by the other reader", got)
	}

	if err := withdraw(author, comment.PublicId); err != nil {
		t.Fatalf("withdraw own comment: %v", err)
	}
	if got := commentPublicIDs(env.listComments(t, tenant, episode.PublicID, 0, "").Comments); len(got) != 0 {
		t.Fatalf("public comments after withdrawal = %v, want none", got)
	}
	if got := myCommentPublicIDs(env.listMyComments(t, tenant, author, episode.PublicID)); len(got) != 0 {
		t.Fatalf("author's own comments after withdrawal = %v, want none", got)
	}

	// The row is kept for staff until the retention purge takes it.
	if got := env.countRows(t,
		"SELECT COUNT(*) FROM episode_comments WHERE tenant_id = $1 AND status = 'withdrawn' AND withdrawn_at IS NOT NULL",
		tenant.ID); got != 1 {
		t.Fatalf("withdrawn rows = %d, want the comment kept for staff", got)
	}
	if err := withdraw(author, comment.PublicId); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("withdrawing twice error = %v, want not_found", err)
	}
}

func TestDBEpisodeCommentsAreTenantIsolated(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	env.setCommentMode(t, first.ID, "immediate")
	env.setCommentMode(t, second.ID, "immediate")

	firstMember := env.PG.SeedEndUser(t, first.ID, "ISOMEMBERA", "iso-a@example.com", "Member A")
	secondMember := env.PG.SeedEndUser(t, second.ID, "ISOMEMBERB", "iso-b@example.com", "Member B")
	firstSeries := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "ISOSERIESA", Title: "Series A", Published: true})
	secondSeries := env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "ISOSERIESB", Title: "Series B", Published: true})
	firstEpisode := env.PG.SeedEpisode(t, first.ID, firstSeries.ID, testutil.EpisodeSeed{PublicID: "ISOEPA", Title: "Episode A", Status: testutil.EpisodeStatusPublished})
	secondEpisode := env.PG.SeedEpisode(t, second.ID, secondSeries.ID, testutil.EpisodeSeed{PublicID: "ISOEPB", Title: "Episode B", Status: testutil.EpisodeStatusPublished})

	comment := env.mustPostComment(t, first, firstMember, firstEpisode.PublicID, "Posted on tenant A.")

	if got := commentPublicIDs(env.listComments(t, second, secondEpisode.PublicID, 0, "").Comments); len(got) != 0 {
		t.Fatalf("tenant B public comments = %v, want none of tenant A's", got)
	}
	if got := myCommentPublicIDs(env.listMyComments(t, second, secondMember, secondEpisode.PublicID)); len(got) != 0 {
		t.Fatalf("tenant B member's own comments = %v, want none", got)
	}

	// The other tenant cannot reach the episode the comment is on either.
	_, err := env.commentClient().ListEpisodeComments(context.Background(), connect.NewRequest(&publirav1.ListEpisodeCommentsRequest{
		Tenant:          tenantContext(second),
		EpisodePublicId: firstEpisode.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ListEpisodeComments across tenants error = %v, want not_found", err)
	}
	if _, err := env.postComment(t, second, secondMember, firstEpisode.PublicID, "Posting across tenants."); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("PostEpisodeComment across tenants error = %v, want not_found", err)
	}

	_, err = env.commentClient().WithdrawEpisodeComment(context.Background(), newBearerRequest(&publirav1.WithdrawEpisodeCommentRequest{
		Tenant:          tenantContext(second),
		CommentPublicId: comment.PublicId,
	}, tokenFor(t, second, secondMember)))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("WithdrawEpisodeComment across tenants error = %v, want not_found", err)
	}
	if got := commentPublicIDs(env.listComments(t, first, firstEpisode.PublicID, 0, "").Comments); len(got) != 1 || got[0] != comment.PublicId {
		t.Fatalf("tenant A public comments = %v, want %s untouched", got, comment.PublicId)
	}
}

func TestDBEpisodeCommentsPaginateNewestFirst(t *testing.T) {
	fixture := newCommentFixture(t, "PAG")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")

	posted := make([]string, 0, 5)
	for index := range 5 {
		comment := env.mustPostComment(t, tenant, member, episode.PublicID, "Comment "+string(rune('A'+index)))
		posted = append(posted, comment.PublicId)
	}
	// Newest first, so the pages walk the postings backwards.
	newestFirst := make([]string, 0, len(posted))
	for index := len(posted) - 1; index >= 0; index-- {
		newestFirst = append(newestFirst, posted[index])
	}

	page := env.listComments(t, tenant, episode.PublicID, 2, "")
	walked := commentPublicIDs(page.Comments)
	if page.PreviousToken != "" {
		t.Fatalf("first page previous_token = %q, want empty", page.PreviousToken)
	}
	for page.NextToken != "" {
		page = env.listComments(t, tenant, episode.PublicID, 2, page.NextToken)
		if page.PreviousToken == "" {
			t.Fatal("a later page has no previous_token to go back with")
		}
		walked = append(walked, commentPublicIDs(page.Comments)...)
	}
	if len(walked) != len(newestFirst) {
		t.Fatalf("walked %d comments, want %d", len(walked), len(newestFirst))
	}
	for index, publicID := range newestFirst {
		if walked[index] != publicID {
			t.Fatalf("comment %d = %s, want %s (newest first)", index, walked[index], publicID)
		}
	}

	// The last page walks back to the first through previous_token alone.
	back := env.listComments(t, tenant, episode.PublicID, 2, page.PreviousToken)
	if got := commentPublicIDs(back.Comments); len(got) != 2 || got[0] != newestFirst[2] {
		t.Fatalf("previous page = %v, want the page before the last", got)
	}
}

func (e *publicDBEnv) reportComment(
	t *testing.T,
	tenant testutil.Tenant,
	reporter testutil.TenantUser,
	commentPublicID string,
	reason publirav1.CommentReportReason,
) error {
	t.Helper()

	_, err := e.commentClient().ReportEpisodeComment(context.Background(), newBearerRequest(&publirav1.ReportEpisodeCommentRequest{
		Tenant:          tenantContext(tenant),
		CommentPublicId: commentPublicID,
		Reason:          reason,
		Note:            "It has nothing to do with the episode.",
	}, tokenFor(t, tenant, reporter)))
	return err
}

func (e *publicDBEnv) openReportCount(t *testing.T, tenant testutil.Tenant, commentPublicID string) int {
	t.Helper()

	return e.countRows(t,
		"SELECT open_report_count FROM episode_comments WHERE tenant_id = $1 AND public_id = $2",
		tenant.ID, commentPublicID,
	)
}

// A report is one row per reader, and the counter follows it in the same write.
// Sending the same report again is answered as success and changes nothing:
// telling a reader that they had already reported this comment would, on a
// comment since removed, tell them what the removal is meant not to.
func TestDBReportEpisodeCommentIsOneRowPerReader(t *testing.T) {
	fixture := newCommentFixture(t, "RPT")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")
	reporter := env.PG.SeedEndUser(t, tenant.ID, "RPTREADER", "rpt-reader@example.com", "Reporting Reader")

	comment := env.mustPostComment(t, tenant, member, episode.PublicID, "Buy cheap watches at example.com")
	if got := env.openReportCount(t, tenant, comment.PublicId); got != 0 {
		t.Fatalf("open_report_count before any report = %d, want 0", got)
	}

	if err := env.reportComment(t, tenant, reporter, comment.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); err != nil {
		t.Fatalf("ReportEpisodeComment: %v", err)
	}
	if got := env.openReportCount(t, tenant, comment.PublicId); got != 1 {
		t.Fatalf("open_report_count after one report = %d, want 1", got)
	}

	if err := env.reportComment(t, tenant, reporter, comment.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_ABUSE); err != nil {
		t.Fatalf("repeated ReportEpisodeComment: %v", err)
	}
	if got := env.openReportCount(t, tenant, comment.PublicId); got != 1 {
		t.Fatalf("open_report_count after the repeat = %d, want 1", got)
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_comment_reports WHERE tenant_id = $1", tenant.ID); got != 1 {
		t.Fatalf("episode_comment_reports = %d rows, want the repeat to write nothing", got)
	}

	// A second reader is a second report, which is what the removal threshold
	// counts: one account cannot drive it on its own.
	second := env.PG.SeedEndUser(t, tenant.ID, "RPTREADER2", "rpt-reader-2@example.com", "Another Reader")
	if err := env.reportComment(t, tenant, second, comment.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); err != nil {
		t.Fatalf("second reader's ReportEpisodeComment: %v", err)
	}
	if got := env.openReportCount(t, tenant, comment.PublicId); got != 2 {
		t.Fatalf("open_report_count after a second reader = %d, want 2", got)
	}

	// Nothing about the comment changed for anyone reading it.
	if got := commentPublicIDs(env.listComments(t, tenant, episode.PublicID, 0, "").Comments); !containsPublicID(got, comment.PublicId) {
		t.Fatalf("public comments = %v, want the reported %s still listed", got, comment.PublicId)
	}
}

// A reader may only report a comment they can see, and never their own. The
// author has a deletion for that, and letting them report it would put a report
// in the queue that no moderator can act on.
func TestDBReportEpisodeCommentRefusesWhatTheReaderCannotReport(t *testing.T) {
	fixture := newCommentFixture(t, "RPR")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "RPRSTAFF", "rpr-staff@example.com", "Moderator")
	reporter := env.PG.SeedEndUser(t, tenant.ID, "RPRREADER", "rpr-reader@example.com", "Reporting Reader")
	other := env.seedTenant(t, "RPROTHER", "rpr-other.example.com", "Other Tenant")
	outsider := env.PG.SeedEndUser(t, other.ID, "RPROUTSID", "rpr-outsider@example.com", "Outside Reader")

	env.setCommentMode(t, tenant.ID, "immediate")
	own := env.mustPostComment(t, tenant, member, episode.PublicID, "My own comment.")
	if err := env.reportComment(t, tenant, member, own.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("reporting your own comment error = %v, want failed_precondition", err)
	}

	env.setCommentMode(t, tenant.ID, "approval_required")
	awaiting := env.mustPostComment(t, tenant, member, episode.PublicID, "Not approved yet.")
	if err := env.reportComment(t, tenant, reporter, awaiting.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("reporting a comment awaiting approval error = %v, want not_found", err)
	}

	env.setCommentMode(t, tenant.ID, "immediate")
	removed := env.mustPostComment(t, tenant, member, episode.PublicID, "Removed by staff.")
	env.hideComment(t, tenant, staff, removed.PublicId)
	if err := env.reportComment(t, tenant, reporter, removed.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("reporting a removed comment error = %v, want not_found", err)
	}

	if err := env.reportComment(t, tenant, reporter, "NOSUCHCMNT01", publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("reporting a comment that never existed error = %v, want not_found", err)
	}

	// A public id is only unique within its tenant, so the lookup is scoped to
	// the one the request names. A reader of another tenant is told what a
	// reader of this one is told about a comment that is not there.
	if err := env.reportComment(t, other, outsider, own.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("reporting another tenant's comment error = %v, want not_found", err)
	}

	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_comment_reports WHERE tenant_id = $1", tenant.ID); got != 0 {
		t.Fatalf("episode_comment_reports = %d rows, want every refusal to write nothing", got)
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM episode_comment_reports WHERE tenant_id = $1", other.ID); got != 0 {
		t.Fatalf("the other tenant's episode_comment_reports = %d rows, want 0", got)
	}
}

// The reason is what the report queue is worked from, so a report that names
// none is rejected rather than filed under "other".
func TestDBReportEpisodeCommentRequiresAReasonAndASession(t *testing.T) {
	fixture := newCommentFixture(t, "RPN")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")
	reporter := env.PG.SeedEndUser(t, tenant.ID, "RPNREADER", "rpn-reader@example.com", "Reporting Reader")
	comment := env.mustPostComment(t, tenant, member, episode.PublicID, "A comment to report.")

	if err := env.reportComment(t, tenant, reporter, comment.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_UNSPECIFIED); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("report with no reason error = %v, want invalid_argument", err)
	}

	_, err := env.commentClient().ReportEpisodeComment(context.Background(), connect.NewRequest(&publirav1.ReportEpisodeCommentRequest{
		Tenant:          tenantContext(tenant),
		CommentPublicId: comment.PublicId,
		Reason:          publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM,
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("report without a session error = %v, want unauthenticated", err)
	}

	if got := env.openReportCount(t, tenant, comment.PublicId); got != 0 {
		t.Fatalf("open_report_count after two rejected reports = %d, want 0", got)
	}
}

// countCommentEvents counts the engagement events filed for one tenant's
// comments, matched against the comment rows they were projected from: an event
// only counts here when its actor, its target and its instant are the ones the
// comment carries.
func (e *publicDBEnv) countCommentEvents(t *testing.T, tenantID uuid.UUID) int {
	t.Helper()

	return e.countRows(t, `
		SELECT COUNT(*)
		FROM content_events ce
		JOIN episode_comments c
			ON c.tenant_id = ce.tenant_id AND c.id = ce.source_id
		JOIN episodes ep
			ON ep.tenant_id = c.tenant_id AND ep.id = c.episode_id
		WHERE ce.tenant_id = $1
			AND ce.event_type = 'comment'
			AND ce.source_table = 'episode_comments'
			AND ce.user_id = c.user_id
			AND ce.episode_id = c.episode_id
			AND ce.series_id = ep.series_id
			AND ce.occurred_at = c.published_at
	`, tenantID)
}

func TestDBPostEpisodeCommentFilesAnEngagementEventOnlyOnceItIsPublic(t *testing.T) {
	fixture := newCommentFixture(t, "EVT")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode

	// A comment that lands in the approval queue was never public, so nothing
	// about it belongs in the engagement log yet.
	env.setCommentMode(t, tenant.ID, "approval_required")
	env.mustPostComment(t, tenant, member, episode.PublicID, "Wait for a moderator.")
	if got := env.countCommentEvents(t, tenant.ID); got != 0 {
		t.Fatalf("comment events after a post awaiting approval = %d, want 0", got)
	}

	env.setCommentMode(t, tenant.ID, "immediate")
	published := env.mustPostComment(t, tenant, member, episode.PublicID, "Read this right away.")
	if got := env.countCommentEvents(t, tenant.ID); got != 1 {
		t.Fatalf("comment events after an immediately published post = %d, want 1", got)
	}

	// Removal takes the comment out of every count that is rebuilt from the
	// comment rows, and leaves the event that records it was once written.
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "EVTSTAFF", "evt-staff@example.com", "Moderator")
	env.hideComment(t, tenant, staff, published.PublicId)
	if got := env.countCommentEvents(t, tenant.ID); got != 1 {
		t.Fatalf("comment events after the removal = %d, want the event to stand at 1", got)
	}
}
