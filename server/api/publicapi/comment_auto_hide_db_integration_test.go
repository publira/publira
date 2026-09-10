package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The tenant's report threshold takes an obviously bad comment off the site
// without waiting for staff. These run against a real database on the
// RLS-bound public role, because the threshold is read and the removal written
// inside the transaction that stores the report.

// setCommentAutoHideThreshold writes how many open reports remove a comment.
// The config row may not exist yet, as it does not for a tenant that has never
// saved anything about commenting.
func (e *publicDBEnv) setCommentAutoHideThreshold(t *testing.T, tenantID uuid.UUID, threshold int32) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := e.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_config (tenant_id, comment_auto_hide_report_threshold)
		VALUES ($1, $2)
		ON CONFLICT (tenant_id) DO UPDATE SET comment_auto_hide_report_threshold = EXCLUDED.comment_auto_hide_report_threshold
	`, tenantID, threshold); err != nil {
		t.Fatalf("set comment_auto_hide_report_threshold = %d: %v", threshold, err)
	}
}

// commentRemoval is how a comment stands after the threshold has had its say.
type commentRemoval struct {
	status       string
	hiddenReason string
	hasHiddenBy  bool
}

func (e *publicDBEnv) commentRemoval(t *testing.T, tenant testutil.Tenant, publicID string) commentRemoval {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var removal commentRemoval
	var reason *string
	var hiddenBy *uuid.UUID
	if err := e.PG.DB.QueryRowContext(ctx, `
		SELECT status, hidden_reason, hidden_by
		FROM episode_comments
		WHERE tenant_id = $1 AND public_id = $2
	`, tenant.ID, publicID).Scan(&removal.status, &reason, &hiddenBy); err != nil {
		t.Fatalf("read the removal state of %s: %v", publicID, err)
	}
	if reason != nil {
		removal.hiddenReason = *reason
	}
	removal.hasHiddenBy = hiddenBy != nil
	return removal
}

// reportUntil has as many fresh readers report the comment as the caller asks
// for. One reader reports one comment once, so a threshold is only ever
// reached by distinct accounts.
func (e *publicDBEnv) reportUntil(
	t *testing.T,
	tenant testutil.Tenant,
	commentPublicID, readerPrefix string,
	reports int,
) {
	t.Helper()

	for index := range reports {
		reader := e.PG.SeedEndUser(t,
			tenant.ID,
			readerPrefix+string(rune('A'+index)),
			readerPrefix+string(rune('a'+index))+"@example.com",
			"Reporting Reader",
		)
		if err := e.reportComment(t, tenant, reader, commentPublicID, publirav1.CommentReportReason_COMMENT_REPORT_REASON_ABUSE); err != nil {
			t.Fatalf("report %d of %d: %v", index+1, reports, err)
		}
	}
}

// The threshold is a count of open reports, and the comment goes at exactly
// the report that reaches it: one short leaves it on the site.
func TestDBReportThresholdHidesTheCommentOnlyOnceItIsReached(t *testing.T) {
	fixture := newCommentFixture(t, "ATH")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")
	env.setCommentAutoHideThreshold(t, tenant.ID, 3)

	comment := env.mustPostComment(t, tenant, member, episode.PublicID, "Buy cheap watches at example.com")
	env.reportUntil(t, tenant, comment.PublicId, "ATHRDR", 2)

	if got := env.commentRemoval(t, tenant, comment.PublicId); got.status != "published" {
		t.Fatalf("comment status one report short of the threshold = %q, want published", got.status)
	}
	if got := commentPublicIDs(env.listComments(t, tenant, episode.PublicID, 0, "").Comments); !containsPublicID(got, comment.PublicId) {
		t.Fatalf("public comments = %v, want %s still listed one report short", got, comment.PublicId)
	}

	env.reportUntil(t, tenant, comment.PublicId, "ATHLAST", 1)

	removal := env.commentRemoval(t, tenant, comment.PublicId)
	if removal.status != "hidden" {
		t.Fatalf("comment status at the threshold = %q, want hidden", removal.status)
	}
	// 'auto_reports' with no actor is what tells the automatic removal from a
	// staff one whose moderator has since been deleted.
	if removal.hiddenReason != "auto_reports" {
		t.Fatalf("hidden_reason = %q, want auto_reports", removal.hiddenReason)
	}
	if removal.hasHiddenBy {
		t.Fatal("hidden_by is set, want the automatic removal to name no actor")
	}
	if got := commentPublicIDs(env.listComments(t, tenant, episode.PublicID, 0, "").Comments); containsPublicID(got, comment.PublicId) {
		t.Fatalf("public comments = %v, want the removed %s withheld", got, comment.PublicId)
	}
	// The author is never told, so their own list still carries the comment.
	if got := myCommentPublicIDs(env.listMyComments(t, tenant, member, episode.PublicID)); !containsPublicID(got, comment.PublicId) {
		t.Fatalf("the author's own comments = %v, want %s unchanged for them", got, comment.PublicId)
	}
	// The reports stay open, so the queue puts the automatic decision in front
	// of staff instead of the site simply forgetting about it.
	if got := env.openReportCount(t, tenant, comment.PublicId); got != 3 {
		t.Fatalf("open_report_count after the automatic removal = %d, want 3", got)
	}
}

// The removal is the tenant's own setting running, so the audit entry names no
// account: the readers who reported only pressed "report".
func TestDBReportThresholdRecordsAnAuditEntryWithNoActor(t *testing.T) {
	fixture := newCommentFixture(t, "AUD")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")
	env.setCommentAutoHideThreshold(t, tenant.ID, 2)

	comment := env.mustPostComment(t, tenant, member, episode.PublicID, "Buy cheap watches at example.com")
	env.reportUntil(t, tenant, comment.PublicId, "AUDRDR", 2)

	if got := env.countRows(t, `
		SELECT COUNT(*)
		FROM audit_logs
		WHERE tenant_id = $1
			AND action = 'comment_auto_hidden'
			AND target_type = 'comment'
			AND target_id = $2
			AND actor_user_id IS NULL
			AND actor_role = 'system'
			AND outcome = 'success'
	`, tenant.ID, comment.PublicId); got != 1 {
		t.Fatalf("actorless audit entries for %s = %d, want 1", comment.PublicId, got)
	}
}

// 0 turns the automatic removal off. However many readers report a comment,
// only staff take it down.
func TestDBReportThresholdOfZeroNeverHidesTheComment(t *testing.T) {
	fixture := newCommentFixture(t, "ATZ")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.setCommentMode(t, tenant.ID, "immediate")
	env.setCommentAutoHideThreshold(t, tenant.ID, 0)

	comment := env.mustPostComment(t, tenant, member, episode.PublicID, "Buy cheap watches at example.com")
	env.reportUntil(t, tenant, comment.PublicId, "ATZRDR", 5)

	if got := env.commentRemoval(t, tenant, comment.PublicId); got.status != "published" {
		t.Fatalf("comment status with the threshold turned off = %q, want published", got.status)
	}
	if got := env.openReportCount(t, tenant, comment.PublicId); got != 5 {
		t.Fatalf("open_report_count = %d, want the reports still collected", got)
	}
	if got := env.countRows(t, "SELECT COUNT(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'comment_auto_hidden'", tenant.ID); got != 0 {
		t.Fatalf("automatic removal audit entries = %d, want none", got)
	}
}

// Deciding the reports is not putting the comment back. The counter follows
// the decisions, and only an explicit restore returns the comment to the site.
func TestDBDecidingReportsLeavesTheAutomaticRemovalStanding(t *testing.T) {
	fixture := newCommentFixture(t, "ATD")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	staff := env.PG.SeedTenantAdmin(t, tenant.ID, "ATDSTAFF", "atd-staff@example.com", "Moderator")
	env.setCommentMode(t, tenant.ID, "immediate")
	env.setCommentAutoHideThreshold(t, tenant.ID, 2)

	comment := env.mustPostComment(t, tenant, member, episode.PublicID, "Buy cheap watches at example.com")
	env.reportUntil(t, tenant, comment.PublicId, "ATDRDR", 2)
	if got := env.commentRemoval(t, tenant, comment.PublicId); got.status != "hidden" {
		t.Fatalf("comment status at the threshold = %q, want hidden", got.status)
	}

	console := env.openAdminCommentConsole(t, tenant, staff)
	for index, report := range env.listCommentReports(t, console, tenant, comment.PublicId) {
		resolution := "resolved"
		if index == 1 {
			resolution = "rejected"
		}
		env.resolveCommentReport(t, console, tenant, report, resolution)
	}

	if got := env.openReportCount(t, tenant, comment.PublicId); got != 0 {
		t.Fatalf("open_report_count once every report is decided = %d, want 0", got)
	}
	if got := env.commentRemoval(t, tenant, comment.PublicId); got.status != "hidden" || got.hiddenReason != "auto_reports" {
		t.Fatalf("comment after the decisions = %q/%q, want hidden/auto_reports", got.status, got.hiddenReason)
	}
	if got := commentPublicIDs(env.listComments(t, tenant, episode.PublicID, 0, "").Comments); containsPublicID(got, comment.PublicId) {
		t.Fatalf("public comments = %v, want the removed %s still withheld", got, comment.PublicId)
	}

	env.restoreComment(t, console, tenant, comment.PublicId)

	if got := env.commentRemoval(t, tenant, comment.PublicId); got.status != "published" || got.hiddenReason != "" {
		t.Fatalf("comment after the restore = %q/%q, want published with no removal in force", got.status, got.hiddenReason)
	}
	if got := commentPublicIDs(env.listComments(t, tenant, episode.PublicID, 0, "").Comments); !containsPublicID(got, comment.PublicId) {
		t.Fatalf("public comments = %v, want the restored %s back", got, comment.PublicId)
	}
}

func (e *publicDBEnv) listCommentReports(
	t *testing.T,
	console adminCommentConsole,
	tenant testutil.Tenant,
	commentPublicID string,
) []string {
	t.Helper()

	req := connect.NewRequest(&publiraadminv1.ListCommentReportsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+console.token)
	res, err := console.client.ListCommentReports(context.Background(), req)
	if err != nil {
		t.Fatalf("ListCommentReports: %v", err)
	}
	reportIDs := make([]string, 0, len(res.Msg.Reports))
	for _, report := range res.Msg.Reports {
		if report.Comment.GetPublicId() == commentPublicID {
			reportIDs = append(reportIDs, report.ReportId)
		}
	}
	return reportIDs
}

func (e *publicDBEnv) resolveCommentReport(
	t *testing.T,
	console adminCommentConsole,
	tenant testutil.Tenant,
	reportID, resolution string,
) {
	t.Helper()

	req := connect.NewRequest(&publiraadminv1.ResolveCommentReportRequest{
		Tenant:     &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		ReportId:   reportID,
		Resolution: resolution,
	})
	req.Header().Set("Authorization", "Bearer "+console.token)
	if _, err := console.client.ResolveCommentReport(context.Background(), req); err != nil {
		t.Fatalf("ResolveCommentReport %s as %s: %v", reportID, resolution, err)
	}
}

func (e *publicDBEnv) restoreComment(
	t *testing.T,
	console adminCommentConsole,
	tenant testutil.Tenant,
	publicID string,
) {
	t.Helper()

	req := connect.NewRequest(&publiraadminv1.RestoreCommentRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
		PublicId: publicID,
		Reason:   "Restored for this test.",
	})
	req.Header().Set("Authorization", "Bearer "+console.token)
	if _, err := console.client.RestoreComment(context.Background(), req); err != nil {
		t.Fatalf("RestoreComment %s: %v", publicID, err)
	}
}
