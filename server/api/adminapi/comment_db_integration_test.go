package adminapi

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/commentretention"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Every rule AdminCommentService enforces is decided by a stored row: the status
// a transition is allowed to move from, and the tenant the comment belongs to.
// These run against a real database on the RLS-bound admin role, the way a
// request does, so a comment of another tenant is out of reach here for the same
// reason it is in production.

// commentModerationFixture is one tenant with a moderator, an episode to comment
// on, and the reader who writes the comments.
type commentModerationFixture struct {
	env            *adminDBEnv
	admin          adminDBTenant
	series         testutil.Series
	episode        testutil.Episode
	reader         uuid.UUID
	readerPublicID string
}

// newCommentModerationFixture seeds that tenant. Public IDs are unique
// database-wide and at most twelve characters, so each one is the fixture's
// three-character prefix followed by nine of its own.
func newCommentModerationFixture(t *testing.T, env *adminDBEnv, prefix, domain string) commentModerationFixture {
	t.Helper()

	admin := env.seedTenantWithAdmin(t, prefix+"TENANT", domain, "Tenant "+prefix, prefix+"ADMIN0001", "admin@"+domain)
	series := env.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{
		PublicID:  prefix + "SERIES001",
		Title:     "Series " + prefix,
		Published: true,
	})
	episode := env.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EPISODE01",
		Title:    "Episode " + prefix,
		Status:   testutil.EpisodeStatusPublished,
	})
	reader := env.PG.SeedEndUser(t, admin.Tenant.ID, prefix+"READER001", "reader@"+domain, "Reader "+prefix)

	return commentModerationFixture{
		env:            env,
		admin:          admin,
		series:         series,
		episode:        episode,
		reader:         reader.ID,
		readerPublicID: reader.PublicID,
	}
}

// seedComment inserts one comment on the given episode in the state the test
// needs to act on. The superuser connection writes it, because no admin RPC
// creates a comment: only a reader does, through the public API.
func (f commentModerationFixture) seedCommentOn(t *testing.T, episodeID uuid.UUID, publicID, status string) dbmodels.EpisodeComment {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	publishedAt := sql.NullTime{}
	if status == "published" {
		publishedAt = sql.NullTime{Time: time.Now().UTC().Add(-time.Hour), Valid: true}
	}
	comment, err := dbmodels.New(f.env.PG.DB).CreateEpisodeComment(ctx, dbmodels.CreateEpisodeCommentParams{
		ID:          uuid.Must(uuid.NewV7()),
		TenantID:    f.admin.Tenant.ID,
		PublicID:    publicID,
		EpisodeID:   episodeID,
		UserID:      f.reader,
		Body:        "A comment stored as " + status + ".",
		Status:      status,
		PublishedAt: publishedAt,
	})
	if err != nil {
		t.Fatalf("create %s comment %s: %v", status, publicID, err)
	}
	return comment
}

func (f commentModerationFixture) seedComment(t *testing.T, publicID, status string) dbmodels.EpisodeComment {
	t.Helper()
	return f.seedCommentOn(t, f.episode.ID, publicID, status)
}

// withdrawComment takes a comment down as its own author does, which is the one
// transition no moderator can make and the one no moderator can undo.
func (f commentModerationFixture) withdrawComment(t *testing.T, publicID string) dbmodels.EpisodeComment {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	comment, err := dbmodels.New(f.env.PG.DB).WithdrawEpisodeCommentByPublicIDForUser(ctx, dbmodels.WithdrawEpisodeCommentByPublicIDForUserParams{
		TenantID: f.admin.Tenant.ID,
		UserID:   f.reader,
		PublicID: publicID,
	})
	if err != nil {
		t.Fatalf("withdraw comment %s: %v", publicID, err)
	}
	return comment
}

func (f commentModerationFixture) list(t *testing.T, req *publiraadminv1.ListCommentsRequest) *publiraadminv1.ListCommentsResponse {
	t.Helper()

	req.Tenant = f.admin.tenantContext()
	res, err := f.env.commentClient().ListComments(context.Background(), newAdminDBRequest(f.admin, req))
	if err != nil {
		t.Fatalf("ListComments %+v: %v", req, err)
	}
	return res.Msg
}

func (f commentModerationFixture) countPending(t *testing.T) int32 {
	t.Helper()

	res, err := f.env.commentClient().CountPendingComments(context.Background(), newAdminDBRequest(f.admin, &publiraadminv1.CountPendingCommentsRequest{
		Tenant: f.admin.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("CountPendingComments: %v", err)
	}
	return res.Msg.PendingCount
}

func adminCommentPublicIDs(comments []*publiraadminv1.AdminComment) []string {
	ids := make([]string, 0, len(comments))
	for _, comment := range comments {
		ids = append(ids, comment.PublicId)
	}
	return ids
}

// auditRowCount counts the audit entries one action left about one comment. The
// handler tests run the synchronous recorder on the request's own connection, so
// the row is there by the time the RPC has returned.
func (e *adminDBEnv) auditRowCount(t *testing.T, tenantID uuid.UUID, action, targetID, reason string) int {
	t.Helper()

	return e.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND target_type = 'comment' AND target_id = $3 AND outcome = 'success' AND coalesce(reason, '') = $4",
		tenantID, action, targetID, reason,
	)
}

func TestDBAdminCommentMovesThroughItsStatesAndRecordsEachOne(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "MOD", "moderation.example.com")
	client := env.commentClient()
	comment := fixture.seedComment(t, "MODPENDING01", "pending")

	// The approval queue carries what a moderator needs to judge the comment:
	// who wrote it and what it is about, not only its text.
	queue := fixture.list(t, &publiraadminv1.ListCommentsRequest{Status: "pending"})
	if got := adminCommentPublicIDs(queue.Comments); !slices.Equal(got, []string{comment.PublicID}) {
		t.Fatalf("pending queue = %v, want %s", got, comment.PublicID)
	}
	queued := queue.Comments[0]
	if queued.AuthorPublicId != fixture.readerPublicID {
		t.Fatalf("author public id = %q, want %q", queued.AuthorPublicId, fixture.readerPublicID)
	}
	if queued.EpisodePublicId != fixture.episode.PublicID || queued.SeriesPublicId != fixture.series.PublicID {
		t.Fatalf("comment episode/series = %q/%q, want %q/%q",
			queued.EpisodePublicId, queued.SeriesPublicId, fixture.episode.PublicID, fixture.series.PublicID)
	}
	if queued.PublishedAt != "" || queued.PurgeDueAt != "" {
		t.Fatalf("pending comment published_at/purge_due_at = %q/%q, want both empty", queued.PublishedAt, queued.PurgeDueAt)
	}

	approved, err := client.ApproveComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.ApproveCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
		Reason:   "Reads fine.",
	}))
	if err != nil {
		t.Fatalf("ApproveComment: %v", err)
	}
	if approved.Msg.Comment.Status != "published" || approved.Msg.Comment.PublishedAt == "" {
		t.Fatalf("approved comment = (%s, %q), want published with a published_at", approved.Msg.Comment.Status, approved.Msg.Comment.PublishedAt)
	}
	if got := env.auditRowCount(t, fixture.admin.Tenant.ID, "comment_approved", comment.PublicID, "Reads fine."); got != 1 {
		t.Fatalf("comment_approved audit rows = %d, want 1", got)
	}

	// Approval is what first publishes a comment, so nothing else is waiting for
	// it and a second approval is refused rather than repeated.
	if _, err := client.ApproveComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.ApproveCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
	})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ApproveComment on a published comment error = %v, want failed_precondition", err)
	}

	hidden, err := client.HideComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.HideCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
		Reason:   "Names a private address.",
	}))
	if err != nil {
		t.Fatalf("HideComment: %v", err)
	}
	if hidden.Msg.Comment.Status != "hidden" || hidden.Msg.Comment.HiddenReason != "staff" || hidden.Msg.Comment.HiddenAt == "" {
		t.Fatalf("hidden comment = (%s, %s, %q), want hidden by staff with a hidden_at",
			hidden.Msg.Comment.Status, hidden.Msg.Comment.HiddenReason, hidden.Msg.Comment.HiddenAt)
	}
	if hidden.Msg.Comment.PublishedAt == "" {
		t.Fatalf("hidden comment published_at = %q, want the removal to keep it", hidden.Msg.Comment.PublishedAt)
	}
	if got := env.auditRowCount(t, fixture.admin.Tenant.ID, "comment_hidden", comment.PublicID, "Names a private address."); got != 1 {
		t.Fatalf("comment_hidden audit rows = %d, want 1", got)
	}

	if _, err := client.HideComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.HideCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
	})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("HideComment on a hidden comment error = %v, want failed_precondition", err)
	}

	restored, err := client.RestoreComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.RestoreCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
		Reason:   "Reported in error.",
	}))
	if err != nil {
		t.Fatalf("RestoreComment: %v", err)
	}
	// It had been published before the removal, so that is the state it returns
	// to, with nothing left of the removal on the row.
	if restored.Msg.Comment.Status != "published" {
		t.Fatalf("restored comment status = %s, want published", restored.Msg.Comment.Status)
	}
	if restored.Msg.Comment.HiddenAt != "" || restored.Msg.Comment.HiddenReason != "" {
		t.Fatalf("restored comment removal stamps = (%q, %q), want both cleared",
			restored.Msg.Comment.HiddenAt, restored.Msg.Comment.HiddenReason)
	}
	if got := env.auditRowCount(t, fixture.admin.Tenant.ID, "comment_restored", comment.PublicID, "Reported in error."); got != 1 {
		t.Fatalf("comment_restored audit rows = %d, want 1", got)
	}

	if _, err := client.RestoreComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.RestoreCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
	})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("RestoreComment on a published comment error = %v, want failed_precondition", err)
	}
}

func TestDBAdminRestoreCommentReturnsAPendingCommentToTheQueue(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RPQ", "restore-pending.example.com")
	client := env.commentClient()
	comment := fixture.seedComment(t, "RPQPENDING01", "pending")

	if _, err := client.HideComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.HideCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
	})); err != nil {
		t.Fatalf("HideComment: %v", err)
	}

	restored, err := client.RestoreComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.RestoreCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
	}))
	if err != nil {
		t.Fatalf("RestoreComment: %v", err)
	}
	// A restore returns the comment to the state the removal interrupted. This
	// one had never been public, so putting it back must not publish it.
	if restored.Msg.Comment.Status != "pending" || restored.Msg.Comment.PublishedAt != "" {
		t.Fatalf("restored comment = (%s, %q), want it back in the approval queue",
			restored.Msg.Comment.Status, restored.Msg.Comment.PublishedAt)
	}
}

func TestDBAdminWithdrawnCommentIsReadableButNotMovable(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "WDN", "withdrawn.example.com")
	client := env.commentClient()
	comment := fixture.seedComment(t, "WDNGONE00001", "published")
	withdrawn := fixture.withdrawComment(t, comment.PublicID)

	// Staff keep reading a comment its author deleted, which is what makes a
	// report raised before the deletion still answerable, and the response says
	// how long that lasts.
	listed := fixture.list(t, &publiraadminv1.ListCommentsRequest{Status: "withdrawn"})
	if got := adminCommentPublicIDs(listed.Comments); !slices.Equal(got, []string{comment.PublicID}) {
		t.Fatalf("withdrawn list = %v, want %s", got, comment.PublicID)
	}
	wantPurgeDueAt := withdrawn.WithdrawnAt.Time.UTC().AddDate(0, 0, commentretention.DefaultWithdrawnDays).Format(time.RFC3339)
	if listed.Comments[0].PurgeDueAt != wantPurgeDueAt {
		t.Fatalf("purge_due_at = %q, want %q", listed.Comments[0].PurgeDueAt, wantPurgeDueAt)
	}

	// Only its author put it there, so no moderator takes it out again: a
	// restore would republish text its author deleted.
	if _, err := client.RestoreComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.RestoreCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
	})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("RestoreComment on a withdrawn comment error = %v, want failed_precondition", err)
	}
	if _, err := client.ApproveComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.ApproveCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
	})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ApproveComment on a withdrawn comment error = %v, want failed_precondition", err)
	}
	if _, err := client.HideComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.HideCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
	})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("HideComment on a withdrawn comment error = %v, want failed_precondition", err)
	}

	if got := env.countRows(t,
		"SELECT count(*) FROM episode_comments WHERE tenant_id = $1 AND status = 'withdrawn'", fixture.admin.Tenant.ID,
	); got != 1 {
		t.Fatalf("withdrawn rows = %d, want the refused actions to have changed nothing", got)
	}
}

func TestDBAdminPurgeCommentDeletesTheRowAndKeepsTheReason(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "PRG", "purge.example.com")
	client := env.commentClient()
	comment := fixture.seedComment(t, "PRGTAKEDOWN1", "published")

	// The audit row is the only record that survives the deletion, so a purge
	// with nothing to say for itself is refused.
	if _, err := client.PurgeComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.PurgeCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
	})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("PurgeComment with no reason error = %v, want invalid_argument", err)
	}

	if _, err := client.PurgeComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.PurgeCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
		Reason:   "Court order 2026-0031.",
	})); err != nil {
		t.Fatalf("PurgeComment: %v", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM episode_comments WHERE public_id = $1", comment.PublicID); got != 0 {
		t.Fatalf("purged comment rows = %d, want the row gone", got)
	}
	if got := env.auditRowCount(t, fixture.admin.Tenant.ID, "comment_purged", comment.PublicID, "Court order 2026-0031."); got != 1 {
		t.Fatalf("comment_purged audit rows = %d, want the reason kept after the row is gone", got)
	}

	if _, err := client.PurgeComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.PurgeCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
		Reason:   "Court order 2026-0031.",
	})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("PurgeComment on a purged comment error = %v, want not_found", err)
	}
}

func TestDBAdminCommentModerationStopsAtTheTenantBoundary(t *testing.T) {
	env := newAdminDBEnv(t)
	mine := newCommentModerationFixture(t, env, "OWN", "own.example.com")
	theirs := newCommentModerationFixture(t, env, "OTH", "other.example.com")
	client := env.commentClient()

	mine.seedComment(t, "OWNPENDING01", "pending")
	foreign := theirs.seedComment(t, "OTHPENDING01", "pending")

	if got := adminCommentPublicIDs(mine.list(t, &publiraadminv1.ListCommentsRequest{}).Comments); !slices.Equal(got, []string{"OWNPENDING01"}) {
		t.Fatalf("list = %v, want only this tenant's comment", got)
	}

	// Naming another tenant's comment is not found rather than forbidden: a
	// moderator learns nothing about what exists elsewhere.
	actions := map[string]func() error{
		"ApproveComment": func() error {
			_, err := client.ApproveComment(context.Background(), newAdminDBRequest(mine.admin, &publiraadminv1.ApproveCommentRequest{
				Tenant:   mine.admin.tenantContext(),
				PublicId: foreign.PublicID,
			}))
			return err
		},
		"HideComment": func() error {
			_, err := client.HideComment(context.Background(), newAdminDBRequest(mine.admin, &publiraadminv1.HideCommentRequest{
				Tenant:   mine.admin.tenantContext(),
				PublicId: foreign.PublicID,
			}))
			return err
		},
		"RestoreComment": func() error {
			_, err := client.RestoreComment(context.Background(), newAdminDBRequest(mine.admin, &publiraadminv1.RestoreCommentRequest{
				Tenant:   mine.admin.tenantContext(),
				PublicId: foreign.PublicID,
			}))
			return err
		},
		"PurgeComment": func() error {
			_, err := client.PurgeComment(context.Background(), newAdminDBRequest(mine.admin, &publiraadminv1.PurgeCommentRequest{
				Tenant:   mine.admin.tenantContext(),
				PublicId: foreign.PublicID,
				Reason:   "Not mine to purge.",
			}))
			return err
		},
	}
	for name, act := range actions {
		if err := act(); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s on another tenant's comment error = %v, want not_found", name, err)
		}
	}

	if got := env.countRows(t,
		"SELECT count(*) FROM episode_comments WHERE tenant_id = $1 AND public_id = $2 AND status = 'pending'",
		theirs.admin.Tenant.ID, foreign.PublicID,
	); got != 1 {
		t.Fatalf("the other tenant's comment = %d pending rows, want it untouched", got)
	}
}

func TestDBAdminListCommentsFiltersAndPages(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "FLT", "filter.example.com")

	otherSeries := env.PG.SeedSeries(t, fixture.admin.Tenant.ID, testutil.SeriesSeed{
		PublicID:  "FLTSERIES02",
		Title:     "Second Series",
		Published: true,
	})
	otherEpisode := env.PG.SeedEpisode(t, fixture.admin.Tenant.ID, otherSeries.ID, testutil.EpisodeSeed{
		PublicID: "FLTEPISODE2",
		Title:    "Second Episode",
		Status:   testutil.EpisodeStatusPublished,
	})

	first := fixture.seedComment(t, "FLTFIRST0001", "published")
	second := fixture.seedComment(t, "FLTSECOND001", "pending")
	elsewhere := fixture.seedCommentOn(t, otherEpisode.ID, "FLTOTHER0001", "published")

	// No filter at all is the whole history, newest first, which is the only way
	// to read a comment beside its neighbours across states.
	all := fixture.list(t, &publiraadminv1.ListCommentsRequest{})
	if got := adminCommentPublicIDs(all.Comments); !slices.Equal(got, []string{elsewhere.PublicID, second.PublicID, first.PublicID}) {
		t.Fatalf("unfiltered list = %v, want all three newest first", got)
	}

	byStatus := fixture.list(t, &publiraadminv1.ListCommentsRequest{Status: "pending"})
	if got := adminCommentPublicIDs(byStatus.Comments); !slices.Equal(got, []string{second.PublicID}) {
		t.Fatalf("pending list = %v, want %s", got, second.PublicID)
	}

	byEpisode := fixture.list(t, &publiraadminv1.ListCommentsRequest{EpisodePublicId: fixture.episode.PublicID})
	if got := adminCommentPublicIDs(byEpisode.Comments); !slices.Equal(got, []string{second.PublicID, first.PublicID}) {
		t.Fatalf("episode list = %v, want the two comments on that episode", got)
	}

	bySeries := fixture.list(t, &publiraadminv1.ListCommentsRequest{SeriesPublicId: otherSeries.PublicID})
	if got := adminCommentPublicIDs(bySeries.Comments); !slices.Equal(got, []string{elsewhere.PublicID}) {
		t.Fatalf("series list = %v, want %s", got, elsewhere.PublicID)
	}

	// Filters compose, so a status inside one series narrows to the intersection
	// rather than to whichever filter was applied last.
	composed := fixture.list(t, &publiraadminv1.ListCommentsRequest{SeriesPublicId: otherSeries.PublicID, Status: "pending"})
	if got := adminCommentPublicIDs(composed.Comments); len(got) != 0 {
		t.Fatalf("composed list = %v, want no pending comment in that series", got)
	}

	// A filter naming nothing this tenant has is an empty page, not an error:
	// the console reaches this RPC with identifiers read from its own screens.
	if got := adminCommentPublicIDs(fixture.list(t, &publiraadminv1.ListCommentsRequest{SeriesPublicId: "NOSUCHSERIE"}).Comments); len(got) != 0 {
		t.Fatalf("unknown series list = %v, want an empty page", got)
	}

	page := fixture.list(t, &publiraadminv1.ListCommentsRequest{Limit: 1})
	if got := adminCommentPublicIDs(page.Comments); !slices.Equal(got, []string{elsewhere.PublicID}) {
		t.Fatalf("first page = %v, want %s", got, elsewhere.PublicID)
	}
	if page.NextToken == "" || page.PreviousToken != "" {
		t.Fatalf("first page tokens = (%q, %q), want a next token only", page.PreviousToken, page.NextToken)
	}
	next := fixture.list(t, &publiraadminv1.ListCommentsRequest{Limit: 1, Token: page.NextToken})
	if got := adminCommentPublicIDs(next.Comments); !slices.Equal(got, []string{second.PublicID}) {
		t.Fatalf("second page = %v, want %s", got, second.PublicID)
	}
	back := fixture.list(t, &publiraadminv1.ListCommentsRequest{Limit: 1, Token: next.PreviousToken})
	if got := adminCommentPublicIDs(back.Comments); !slices.Equal(got, []string{elsewhere.PublicID}) {
		t.Fatalf("page back = %v, want %s", got, elsewhere.PublicID)
	}
}

func TestDBAdminCountPendingCommentsCountsOneTenantsQueue(t *testing.T) {
	env := newAdminDBEnv(t)
	mine := newCommentModerationFixture(t, env, "CNT", "count.example.com")
	theirs := newCommentModerationFixture(t, env, "CNO", "count-other.example.com")

	if got := mine.countPending(t); got != 0 {
		t.Fatalf("pending count on an empty tenant = %d, want 0", got)
	}

	mine.seedComment(t, "CNTPENDING01", "pending")
	mine.seedComment(t, "CNTPENDING02", "pending")
	// Every other state is work already done, so none of them is in the badge.
	mine.seedComment(t, "CNTPUBLISH01", "published")
	mine.seedComment(t, "CNTHIDDEN001", "published")
	if _, err := env.commentClient().HideComment(context.Background(), newAdminDBRequest(mine.admin, &publiraadminv1.HideCommentRequest{
		Tenant:   mine.admin.tenantContext(),
		PublicId: "CNTHIDDEN001",
	})); err != nil {
		t.Fatalf("HideComment: %v", err)
	}
	theirs.seedComment(t, "CNOPENDING01", "pending")

	if got := mine.countPending(t); got != 2 {
		t.Fatalf("pending count = %d, want the two pending comments of this tenant", got)
	}
	if got := theirs.countPending(t); got != 1 {
		t.Fatalf("the other tenant's pending count = %d, want 1", got)
	}

	// Approving is what empties the queue, so the count is what a moderator
	// watches shrink as they work through it.
	if _, err := env.commentClient().ApproveComment(context.Background(), newAdminDBRequest(mine.admin, &publiraadminv1.ApproveCommentRequest{
		Tenant:   mine.admin.tenantContext(),
		PublicId: "CNTPENDING01",
	})); err != nil {
		t.Fatalf("ApproveComment: %v", err)
	}
	if got := mine.countPending(t); got != 1 {
		t.Fatalf("pending count after an approval = %d, want 1", got)
	}
}

func TestDBAdminCommentModerationRequiresTheAdminRole(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "ROL", "role.example.com")
	editor := env.PG.SeedTenantUser(t, fixture.admin.Tenant.ID, "ROLEDITOR001", "editor@role.example.com", "Editor", auth.RoleTenantEditor)
	comment := fixture.seedComment(t, "ROLPENDING01", "pending")
	client := env.commentClient()

	asEditor := fixture.admin.as(editor)
	if _, err := client.ListComments(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.ListCommentsRequest{
		Tenant: asEditor.tenantContext(),
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListComments as an editor error = %v, want permission_denied", err)
	}
	if _, err := client.ApproveComment(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.ApproveCommentRequest{
		Tenant:   asEditor.tenantContext(),
		PublicId: comment.PublicID,
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ApproveComment as an editor error = %v, want permission_denied", err)
	}
	if _, err := client.CountPendingComments(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.CountPendingCommentsRequest{
		Tenant: asEditor.tenantContext(),
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CountPendingComments as an editor error = %v, want permission_denied", err)
	}
}

func TestDBAdminListCommentsRejectsAnUnknownStatus(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "STA", "status.example.com")

	_, err := env.commentClient().ListComments(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.ListCommentsRequest{
		Tenant: fixture.admin.tenantContext(),
		Status: "removed",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListComments with an unknown status error = %v, want invalid_argument", err)
	}
}
