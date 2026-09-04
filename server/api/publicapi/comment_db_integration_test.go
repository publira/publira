package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
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

// hideComment removes a comment the way the admin console will, so these tests
// can assert the silence of a removal without waiting for AdminCommentService.
func (e *publicDBEnv) hideComment(t *testing.T, tenantID uuid.UUID, publicID string, staffID uuid.UUID) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := dbmodels.New(e.PG.DB).HideEpisodeCommentByPublicIDForTenant(ctx, dbmodels.HideEpisodeCommentByPublicIDForTenantParams{
		TenantID:     tenantID,
		PublicID:     publicID,
		HiddenBy:     uuid.NullUUID{UUID: staffID, Valid: true},
		HiddenReason: "staff",
	}); err != nil {
		t.Fatalf("hide comment %s: %v", publicID, err)
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

	env := newPublicDBEnv(t)
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
	env.hideComment(t, tenant.ID, removed.PublicId, staff.ID)

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
