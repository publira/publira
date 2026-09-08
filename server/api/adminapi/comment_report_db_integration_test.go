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
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

// The report queue is worked from stored rows the same way the comment queues
// are: which report may still be decided, whose comment it is about, and what
// the decision does to the counter the removal threshold reads. These run
// against a real database on the RLS-bound admin role, so another tenant's
// report is out of reach here for the reason it is in production.

// seedReporter adds one more reader of the fixture's tenant, so a comment can
// collect reports from several accounts: one reader reports one comment once.
func (f commentModerationFixture) seedReporter(t *testing.T, publicID, email, name string) uuid.UUID {
	t.Helper()
	return f.env.PG.SeedEndUser(t, f.admin.Tenant.ID, publicID, email, name).ID
}

// seedReport stores one reader's report the way ReportEpisodeComment does, and
// moves the counter with it. No admin RPC creates a report, so the write is the
// public API's own query run here directly.
func (f commentModerationFixture) seedReport(
	t *testing.T,
	commentID, reporterID uuid.UUID,
	reason, note string,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	queries := dbmodels.New(f.env.PG.DB)
	report, err := queries.CreateEpisodeCommentReport(ctx, dbmodels.CreateEpisodeCommentReportParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       f.admin.Tenant.ID,
		CommentID:      commentID,
		ReporterUserID: reporterID,
		Reason:         reason,
		Note:           sql.NullString{String: note, Valid: note != ""},
	})
	if err != nil {
		t.Fatalf("create report on %s: %v", commentID, err)
	}
	if _, err := queries.RefreshEpisodeCommentOpenReportCount(ctx, dbmodels.RefreshEpisodeCommentOpenReportCountParams{
		TenantID:  f.admin.Tenant.ID,
		CommentID: commentID,
	}); err != nil {
		t.Fatalf("refresh open report count for %s: %v", commentID, err)
	}
	return report.ID
}

// hideCommentAutomatically puts a comment in the state the report threshold
// leaves it in. The threshold itself is not implemented yet, and the queue has
// to tell that removal from a moderator's either way.
func (f commentModerationFixture) hideCommentAutomatically(t *testing.T, publicID string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := dbmodels.New(f.env.PG.DB).HideEpisodeCommentByPublicIDForTenant(ctx, dbmodels.HideEpisodeCommentByPublicIDForTenantParams{
		TenantID:     f.admin.Tenant.ID,
		PublicID:     publicID,
		HiddenBy:     uuid.NullUUID{},
		HiddenReason: "auto_reports",
	}); err != nil {
		t.Fatalf("hide %s automatically: %v", publicID, err)
	}
}

func (f commentModerationFixture) listReports(t *testing.T, req *publiraadminv1.ListCommentReportsRequest) *publiraadminv1.ListCommentReportsResponse {
	t.Helper()

	req.Tenant = f.admin.tenantContext()
	res, err := f.env.commentClient().ListCommentReports(context.Background(), newAdminDBRequest(f.admin, req))
	if err != nil {
		t.Fatalf("ListCommentReports %+v: %v", req, err)
	}
	return res.Msg
}

func (f commentModerationFixture) resolveReport(
	t *testing.T,
	reportID uuid.UUID,
	resolution, reason string,
) *publiraadminv1.CommentReport {
	t.Helper()

	res, err := f.env.commentClient().ResolveCommentReport(context.Background(), newAdminDBRequest(f.admin, &publiraadminv1.ResolveCommentReportRequest{
		Tenant:     f.admin.tenantContext(),
		ReportId:   reportID.String(),
		Resolution: resolution,
		Reason:     reason,
	}))
	if err != nil {
		t.Fatalf("ResolveCommentReport(%s, %s): %v", reportID, resolution, err)
	}
	return res.Msg.Report
}

func commentReportIDs(reports []*publiraadminv1.CommentReport) []string {
	ids := make([]string, 0, len(reports))
	for _, report := range reports {
		ids = append(ids, report.ReportId)
	}
	return ids
}

func TestDBAdminCommentReportQueueCarriesTheCommentItIsAbout(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RQU", "report-queue.example.com")
	comment := fixture.seedComment(t, "RQUREPORTED1", "published")
	reporter := fixture.seedReporter(t, "RQUREPORT001", "rqu-reporter@report-queue.example.com", "Report Queue Reader")
	reportID := fixture.seedReport(t, comment.ID, reporter, "spoiler", "Gives away the ending.")

	queue := fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{Status: "open"})
	if got := commentReportIDs(queue.Reports); !slices.Equal(got, []string{reportID.String()}) {
		t.Fatalf("open report queue = %v, want %s", got, reportID)
	}

	// A report cannot be judged from the reason alone: the queue carries what
	// the reader said, who they are, and the comment in the state it is in.
	queued := queue.Reports[0]
	if queued.Reason != "spoiler" || queued.Note != "Gives away the ending." {
		t.Fatalf("queued report = (%q, %q), want the reason and the note the reader gave", queued.Reason, queued.Note)
	}
	if queued.Status != "open" || queued.ResolvedAt != "" {
		t.Fatalf("queued report = (%s, %q), want open with no decision on it", queued.Status, queued.ResolvedAt)
	}
	if queued.ReporterPublicId != "RQUREPORT001" || queued.ReporterName != "Report Queue Reader" {
		t.Fatalf("reporter = (%q, %q), want the account that sent the report", queued.ReporterPublicId, queued.ReporterName)
	}
	if queued.Comment.GetPublicId() != comment.PublicID || queued.Comment.GetBody() != comment.Body {
		t.Fatalf("reported comment = (%q, %q), want %q", queued.Comment.GetPublicId(), queued.Comment.GetBody(), comment.PublicID)
	}
	if queued.Comment.GetAuthorPublicId() != fixture.readerPublicID {
		t.Fatalf("comment author = %q, want %q", queued.Comment.GetAuthorPublicId(), fixture.readerPublicID)
	}
	if queued.Comment.GetEpisodePublicId() != fixture.episode.PublicID || queued.Comment.GetSeriesPublicId() != fixture.series.PublicID {
		t.Fatalf("comment episode/series = %q/%q, want %q/%q",
			queued.Comment.GetEpisodePublicId(), queued.Comment.GetSeriesPublicId(), fixture.episode.PublicID, fixture.series.PublicID)
	}
	if queued.Comment.GetOpenReportCount() != 1 {
		t.Fatalf("open report count = %d, want 1", queued.Comment.GetOpenReportCount())
	}
	// Nothing removed this comment, so the queue says as much rather than
	// leaving staff to assume the threshold got there first.
	if queued.Comment.GetHiddenReason() != "" {
		t.Fatalf("hidden reason = %q, want empty on a comment nothing removed", queued.Comment.GetHiddenReason())
	}
}

func TestDBAdminResolvingAReportLeavesTheCommentAlone(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RRS", "report-resolve.example.com")
	comment := fixture.seedComment(t, "RRSREPORTED1", "published")
	first := fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RRSREPORT001", "rrs-reporter-1@report-resolve.example.com", "Reader One"),
		"spam", "")
	second := fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RRSREPORT002", "rrs-reporter-2@report-resolve.example.com", "Reader Two"),
		"abuse", "")

	resolved := fixture.resolveReport(t, first, "resolved", "Agreed, this is advertising.")
	if resolved.Status != "resolved" || resolved.ResolvedAt == "" {
		t.Fatalf("decided report = (%s, %q), want resolved with a timestamp", resolved.Status, resolved.ResolvedAt)
	}
	// Agreeing with a report is not the same act as removing what it is about,
	// so the comment is exactly where it was; only the counter follows.
	if resolved.Comment.GetStatus() != "published" || resolved.Comment.GetHiddenAt() != "" {
		t.Fatalf("comment after a resolution = (%s, %q), want it published and untouched",
			resolved.Comment.GetStatus(), resolved.Comment.GetHiddenAt())
	}
	if resolved.Comment.GetOpenReportCount() != 1 {
		t.Fatalf("open report count after one decision = %d, want 1", resolved.Comment.GetOpenReportCount())
	}
	if got := env.auditRowCount(t, fixture.admin.Tenant.ID, "comment_report_resolved", comment.PublicID, "Agreed, this is advertising."); got != 1 {
		t.Fatalf("comment_report_resolved audit rows = %d, want 1", got)
	}

	rejected := fixture.resolveReport(t, second, "rejected", "")
	if rejected.Status != "rejected" {
		t.Fatalf("second decision = %s, want rejected", rejected.Status)
	}
	if rejected.Comment.GetOpenReportCount() != 0 {
		t.Fatalf("open report count once every report is decided = %d, want 0", rejected.Comment.GetOpenReportCount())
	}
	if got := env.auditRowCount(t, fixture.admin.Tenant.ID, "comment_report_rejected", comment.PublicID, ""); got != 1 {
		t.Fatalf("comment_report_rejected audit rows = %d, want 1", got)
	}

	// A decision is made once. The second attempt is refused rather than
	// overwriting the moderator who got there first.
	_, err := env.commentClient().ResolveCommentReport(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.ResolveCommentReportRequest{
		Tenant:     fixture.admin.tenantContext(),
		ReportId:   first.String(),
		Resolution: "rejected",
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ResolveCommentReport on a decided report error = %v, want failed_precondition", err)
	}
}

func TestDBAdminRejectingEveryReportLeavesAnAutomaticRemovalInPlace(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RAU", "report-auto.example.com")
	comment := fixture.seedComment(t, "RAUREPORTED1", "published")
	first := fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RAUREPORT001", "rau-reporter-1@report-auto.example.com", "Reader One"),
		"abuse", "")
	second := fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RAUREPORT002", "rau-reporter-2@report-auto.example.com", "Reader Two"),
		"abuse", "")
	fixture.hideCommentAutomatically(t, comment.PublicID)

	// The queue says which kind of removal is in force, because the two are
	// acted on differently: one is a decision staff made, the other one they
	// are being asked to review.
	queued := fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{Status: "open"}).Reports
	if len(queued) != 2 {
		t.Fatalf("open reports = %d, want 2", len(queued))
	}
	if queued[0].Comment.GetHiddenReason() != "auto_reports" {
		t.Fatalf("hidden reason = %q, want auto_reports", queued[0].Comment.GetHiddenReason())
	}

	fixture.resolveReport(t, first, "rejected", "")
	last := fixture.resolveReport(t, second, "rejected", "")

	// Disagreeing with every report is not the same decision as putting the
	// comment back: the removal stands until someone restores it by name.
	if last.Comment.GetStatus() != "hidden" || last.Comment.GetHiddenReason() != "auto_reports" {
		t.Fatalf("comment after every report was rejected = (%s, %q), want it still removed",
			last.Comment.GetStatus(), last.Comment.GetHiddenReason())
	}
	if last.Comment.GetOpenReportCount() != 0 {
		t.Fatalf("open report count = %d, want 0", last.Comment.GetOpenReportCount())
	}
}

func TestDBAdminRestoringACommentClearsTheReportsThatRemovedIt(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RRE", "report-restore.example.com")
	comment := fixture.seedComment(t, "RREREPORTED1", "published")
	fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RREREPORT001", "rre-reporter-1@report-restore.example.com", "Reader One"),
		"abuse", "")
	fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RREREPORT002", "rre-reporter-2@report-restore.example.com", "Reader Two"),
		"spam", "")
	fixture.hideCommentAutomatically(t, comment.PublicID)

	restored, err := env.commentClient().RestoreComment(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.RestoreCommentRequest{
		Tenant:   fixture.admin.tenantContext(),
		PublicId: comment.PublicID,
		Reason:   "Read it in full; it is within the rules.",
	}))
	if err != nil {
		t.Fatalf("RestoreComment: %v", err)
	}
	// Putting the comment back is staff saying it stands, so the reports
	// against it do not: leaving them open would let the very same reports
	// carry it past the removal threshold again straight away.
	if restored.Msg.Comment.Status != "published" || restored.Msg.Comment.OpenReportCount != 0 {
		t.Fatalf("restored comment = (%s, %d open reports), want it published with the counter reset",
			restored.Msg.Comment.Status, restored.Msg.Comment.OpenReportCount)
	}
	if got := env.countRows(t,
		"SELECT count(*) FROM episode_comment_reports WHERE comment_id = $1 AND status = 'open'", comment.ID,
	); got != 0 {
		t.Fatalf("open report rows after the restore = %d, want 0", got)
	}
	if got := env.countRows(t,
		"SELECT count(*) FROM episode_comment_reports WHERE comment_id = $1 AND status = 'rejected' AND resolved_at IS NOT NULL", comment.ID,
	); got != 2 {
		t.Fatalf("rejected report rows after the restore = %d, want both of them decided", got)
	}

	// Every report is decided, so there is nothing left in the queue to work.
	if got := commentReportIDs(fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{Status: "open"}).Reports); len(got) != 0 {
		t.Fatalf("open queue after the restore = %v, want it empty", got)
	}
	if got := fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{Status: "rejected"}).Reports; len(got) != 2 {
		t.Fatalf("rejected queue after the restore = %d reports, want 2", len(got))
	}
}

func TestDBAdminListCommentReportsFiltersAndPages(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RPG", "report-paging.example.com")
	comment := fixture.seedComment(t, "RPGREPORTED1", "published")
	first := fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RPGREPORT001", "rpg-reporter-1@report-paging.example.com", "Reader One"),
		"spam", "")
	second := fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RPGREPORT002", "rpg-reporter-2@report-paging.example.com", "Reader Two"),
		"abuse", "")
	third := fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RPGREPORT003", "rpg-reporter-3@report-paging.example.com", "Reader Three"),
		"other", "Off topic.")

	// One comment, three reports, three rows: a report is what staff decide on,
	// so each of them is its own entry in the queue.
	all := fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{})
	if got := commentReportIDs(all.Reports); !slices.Equal(got, []string{third.String(), second.String(), first.String()}) {
		t.Fatalf("unfiltered queue = %v, want all three newest first", got)
	}

	fixture.resolveReport(t, first, "resolved", "")
	if got := commentReportIDs(fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{Status: "open"}).Reports); !slices.Equal(got, []string{third.String(), second.String()}) {
		t.Fatalf("open queue = %v, want the two still waiting", got)
	}
	if got := commentReportIDs(fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{Status: "resolved"}).Reports); !slices.Equal(got, []string{first.String()}) {
		t.Fatalf("resolved queue = %v, want %s", got, first)
	}

	page := fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{Limit: 1})
	if got := commentReportIDs(page.Reports); !slices.Equal(got, []string{third.String()}) {
		t.Fatalf("first page = %v, want %s", got, third)
	}
	if page.NextToken == "" || page.PreviousToken != "" {
		t.Fatalf("first page tokens = (%q, %q), want a next token only", page.PreviousToken, page.NextToken)
	}
	next := fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{Limit: 1, Token: page.NextToken})
	if got := commentReportIDs(next.Reports); !slices.Equal(got, []string{second.String()}) {
		t.Fatalf("second page = %v, want %s", got, second)
	}
	back := fixture.listReports(t, &publiraadminv1.ListCommentReportsRequest{Limit: 1, Token: next.PreviousToken})
	if got := commentReportIDs(back.Reports); !slices.Equal(got, []string{third.String()}) {
		t.Fatalf("page back = %v, want %s", got, third)
	}
}

func TestDBAdminCommentReportsStopAtTheTenantBoundary(t *testing.T) {
	env := newAdminDBEnv(t)
	mine := newCommentModerationFixture(t, env, "ROW", "report-own.example.com")
	theirs := newCommentModerationFixture(t, env, "ROT", "report-other.example.com")

	mineComment := mine.seedComment(t, "ROWREPORTED1", "published")
	mine.seedReport(t,
		mineComment.ID,
		mine.seedReporter(t, "ROWREPORT001", "row-reporter@report-own.example.com", "Own Reader"),
		"spam", "")
	theirComment := theirs.seedComment(t, "ROTREPORTED1", "published")
	foreign := theirs.seedReport(t,
		theirComment.ID,
		theirs.seedReporter(t, "ROTREPORT001", "rot-reporter@report-other.example.com", "Other Reader"),
		"spam", "")

	if got := len(mine.listReports(t, &publiraadminv1.ListCommentReportsRequest{}).Reports); got != 1 {
		t.Fatalf("queue = %d reports, want only this tenant's", got)
	}

	// Naming another tenant's report is not found rather than forbidden.
	_, err := env.commentClient().ResolveCommentReport(context.Background(), newAdminDBRequest(mine.admin, &publiraadminv1.ResolveCommentReportRequest{
		Tenant:     mine.admin.tenantContext(),
		ReportId:   foreign.String(),
		Resolution: "resolved",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ResolveCommentReport on another tenant's report error = %v, want not_found", err)
	}
	if got := env.countRows(t, "SELECT count(*) FROM episode_comment_reports WHERE id = $1 AND status = 'open'", foreign); got != 1 {
		t.Fatalf("the other tenant's report = %d open rows, want it untouched", got)
	}
}

func TestDBAdminCommentReportsRejectInvalidArguments(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RIV", "report-invalid.example.com")
	comment := fixture.seedComment(t, "RIVREPORTED1", "published")
	reportID := fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RIVREPORT001", "riv-reporter@report-invalid.example.com", "Reader"),
		"spam", "")
	client := env.commentClient()

	if _, err := client.ListCommentReports(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.ListCommentReportsRequest{
		Tenant: fixture.admin.tenantContext(),
		Status: "closed",
	})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListCommentReports with an unknown status error = %v, want invalid_argument", err)
	}

	// Which way the decision went is the whole content of the call, so neither
	// an empty resolution nor the state the report is already in is accepted.
	for _, resolution := range []string{"", "open", "dismissed"} {
		if _, err := client.ResolveCommentReport(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.ResolveCommentReportRequest{
			Tenant:     fixture.admin.tenantContext(),
			ReportId:   reportID.String(),
			Resolution: resolution,
		})); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("ResolveCommentReport with resolution %q error = %v, want invalid_argument", resolution, err)
		}
	}

	if _, err := client.ResolveCommentReport(context.Background(), newAdminDBRequest(fixture.admin, &publiraadminv1.ResolveCommentReportRequest{
		Tenant:     fixture.admin.tenantContext(),
		ReportId:   "not-an-identifier",
		Resolution: "resolved",
	})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ResolveCommentReport with a malformed report id error = %v, want invalid_argument", err)
	}
}

func TestDBAdminCommentReportsRequireTheAdminRole(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := newCommentModerationFixture(t, env, "RRO", "report-role.example.com")
	comment := fixture.seedComment(t, "RROREPORTED1", "published")
	reportID := fixture.seedReport(t,
		comment.ID,
		fixture.seedReporter(t, "RROREPORT001", "rro-reporter@report-role.example.com", "Reader"),
		"spam", "")
	editor := env.PG.SeedTenantUser(t, fixture.admin.Tenant.ID, "RROEDITOR001", "editor@report-role.example.com", "Editor", auth.RoleTenantEditor)
	asEditor := fixture.admin.as(editor)
	client := env.commentClient()

	if _, err := client.ListCommentReports(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.ListCommentReportsRequest{
		Tenant: asEditor.tenantContext(),
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListCommentReports as an editor error = %v, want permission_denied", err)
	}
	if _, err := client.ResolveCommentReport(context.Background(), newAdminDBRequest(asEditor, &publiraadminv1.ResolveCommentReportRequest{
		Tenant:     asEditor.tenantContext(),
		ReportId:   reportID.String(),
		Resolution: "resolved",
	})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ResolveCommentReport as an editor error = %v, want permission_denied", err)
	}
}
