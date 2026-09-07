package dbtest

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// A report may only name a comment and a reader of its own tenant. Without the
// composite keys a report could point at another storefront's comment, and the
// counter it maintains would then be moved from outside the tenant entirely.
func TestEpisodeCommentReportsRejectCrossTenantReferences(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queries := dbmodels.New(pg.DB)
	first := seedCommentTenant(t, ctx, pg.DB, "RPA")
	second := seedCommentTenant(t, ctx, pg.DB, "RPB")
	commentA := mustCreateComment(t, ctx, queries, first, "published", "RPACOMMENT1")
	commentB := mustCreateComment(t, ctx, queries, second, "published", "RPBCOMMENT1")
	reporterA := mustInsertUser(t, ctx, pg.DB, first.tenantID, "RPAREPORT01", "rpa-reporter@example.com", "Reporter A")
	reporterB := mustInsertUser(t, ctx, pg.DB, second.tenantID, "RPBREPORT01", "rpb-reporter@example.com", "Reporter B")

	if _, err := queries.CreateEpisodeCommentReport(ctx, newReportParams(first.tenantID, commentA.ID, reporterA)); err != nil {
		t.Fatalf("same-tenant report insert: %v", err)
	}

	_, err := queries.CreateEpisodeCommentReport(ctx, newReportParams(first.tenantID, commentB.ID, reporterA))
	if !isForeignKeyViolation(err) || !strings.Contains(err.Error(), "episode_comment_reports_tenant_comment_id_fkey") {
		t.Fatalf("cross-tenant comment error = %v, want episode_comment_reports_tenant_comment_id_fkey", err)
	}

	_, err = queries.CreateEpisodeCommentReport(ctx, newReportParams(first.tenantID, commentA.ID, reporterB))
	if !isForeignKeyViolation(err) || !strings.Contains(err.Error(), "episode_comment_reports_tenant_reporter_user_id_fkey") {
		t.Fatalf("cross-tenant reporter error = %v, want episode_comment_reports_tenant_reporter_user_id_fkey", err)
	}
}

// One reader reports one comment once. A repeat writes nothing and is not an
// error the caller has to tell apart from a failure: the insert simply returns
// no row.
func TestRepeatedEpisodeCommentReportWritesNothing(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queries := dbmodels.New(pg.DB)
	seed := seedCommentTenant(t, ctx, pg.DB, "RPT")
	comment := mustCreateComment(t, ctx, queries, seed, "published", "RPTCOMMENT1")
	reporter := mustInsertUser(t, ctx, pg.DB, seed.tenantID, "RPTREPORT01", "rpt-reporter@example.com", "Reporter")

	first, err := queries.CreateEpisodeCommentReport(ctx, newReportParams(seed.tenantID, comment.ID, reporter))
	if err != nil {
		t.Fatalf("first report: %v", err)
	}
	if first.Status != "open" {
		t.Fatalf("first report status = %q, want open", first.Status)
	}
	if count := mustRefreshOpenReportCount(t, ctx, queries, seed.tenantID, comment.ID); count != 1 {
		t.Fatalf("open report count after the first report = %d, want 1", count)
	}

	repeat := newReportParams(seed.tenantID, comment.ID, reporter)
	repeat.Reason = "abuse"
	_, err = queries.CreateEpisodeCommentReport(ctx, repeat)
	if err != sql.ErrNoRows {
		t.Fatalf("repeated report error = %v, want sql.ErrNoRows", err)
	}
	if count := mustRefreshOpenReportCount(t, ctx, queries, seed.tenantID, comment.ID); count != 1 {
		t.Fatalf("open report count after the repeat = %d, want 1", count)
	}
	if stored := mustCountReports(t, ctx, pg.DB, comment.ID); stored != 1 {
		t.Fatalf("stored reports = %d, want 1", stored)
	}
	// The first reader's reason stands. A repeat is not an edit, so the queue is
	// worked from what they said the first time.
	if reason := mustReportReason(t, ctx, pg.DB, first.ID); reason != "spam" {
		t.Fatalf("stored reason = %q, want spam", reason)
	}
}

// The counter answers the same question after a resolution as after a report,
// because it is recomputed from the reports rather than incremented.
func TestOpenReportCountFollowsReportsAndResolutions(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queries := dbmodels.New(pg.DB)
	seed := seedCommentTenant(t, ctx, pg.DB, "RPC")
	comment := mustCreateComment(t, ctx, queries, seed, "published", "RPCCOMMENT1")

	reporters := []uuid.UUID{
		mustInsertUser(t, ctx, pg.DB, seed.tenantID, "RPCREPORT01", "rpc-reporter-1@example.com", "Reporter One"),
		mustInsertUser(t, ctx, pg.DB, seed.tenantID, "RPCREPORT02", "rpc-reporter-2@example.com", "Reporter Two"),
		mustInsertUser(t, ctx, pg.DB, seed.tenantID, "RPCREPORT03", "rpc-reporter-3@example.com", "Reporter Three"),
	}
	reports := make([]uuid.UUID, 0, len(reporters))
	for _, reporter := range reporters {
		report, err := queries.CreateEpisodeCommentReport(ctx, newReportParams(seed.tenantID, comment.ID, reporter))
		if err != nil {
			t.Fatalf("report by %s: %v", reporter, err)
		}
		reports = append(reports, report.ID)
	}
	if count := mustRefreshOpenReportCount(t, ctx, queries, seed.tenantID, comment.ID); count != 3 {
		t.Fatalf("open report count after three reports = %d, want 3", count)
	}

	// Staff deciding on a report is what the admin console will do; here it is
	// the write, and the counter has to follow it whichever way they decided.
	mustDecideReport(t, ctx, pg.DB, reports[0], "resolved", seed.staffID)
	if count := mustRefreshOpenReportCount(t, ctx, queries, seed.tenantID, comment.ID); count != 2 {
		t.Fatalf("open report count after one resolution = %d, want 2", count)
	}

	mustDecideReport(t, ctx, pg.DB, reports[1], "rejected", seed.staffID)
	if count := mustRefreshOpenReportCount(t, ctx, queries, seed.tenantID, comment.ID); count != 1 {
		t.Fatalf("open report count after a rejection = %d, want 1", count)
	}

	mustDecideReport(t, ctx, pg.DB, reports[2], "resolved", seed.staffID)
	if count := mustRefreshOpenReportCount(t, ctx, queries, seed.tenantID, comment.ID); count != 0 {
		t.Fatalf("open report count once every report is decided = %d, want 0", count)
	}
}

// The report queue keeps a decision after the account that made it is deleted:
// only the actor column is dropped, so the report stays decided on its tenant.
func TestDeletingAModeratorLeavesTheReportDecided(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queries := dbmodels.New(pg.DB)
	seed := seedCommentTenant(t, ctx, pg.DB, "RPD")
	comment := mustCreateComment(t, ctx, queries, seed, "published", "RPDCOMMENT1")
	reporter := mustInsertUser(t, ctx, pg.DB, seed.tenantID, "RPDREPORT01", "rpd-reporter@example.com", "Reporter")

	report, err := queries.CreateEpisodeCommentReport(ctx, newReportParams(seed.tenantID, comment.ID, reporter))
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	mustDecideReport(t, ctx, pg.DB, report.ID, "resolved", seed.staffID)

	if _, err := pg.DB.ExecContext(ctx, "DELETE FROM users WHERE id = $1", seed.staffID); err != nil {
		t.Fatalf("delete moderator: %v", err)
	}

	var (
		tenantID   uuid.UUID
		status     string
		resolvedBy uuid.NullUUID
		resolvedAt sql.NullTime
	)
	row := pg.DB.QueryRowContext(ctx, "SELECT tenant_id, status, resolved_by, resolved_at FROM episode_comment_reports WHERE id = $1", report.ID)
	if err := row.Scan(&tenantID, &status, &resolvedBy, &resolvedAt); err != nil {
		t.Fatalf("read report after moderator deletion: %v", err)
	}
	if tenantID != seed.tenantID {
		t.Fatalf("tenant_id = %s, want %s", tenantID, seed.tenantID)
	}
	if status != "resolved" || !resolvedAt.Valid {
		t.Fatalf("status = %q with resolved_at valid = %t, want resolved with a timestamp", status, resolvedAt.Valid)
	}
	if resolvedBy.Valid {
		t.Fatalf("resolved_by = %s, want null once the account is gone", resolvedBy.UUID)
	}
}

// The columns that describe a decision are required together, so a report
// cannot claim to be decided with nothing saying when.
func TestEpisodeCommentReportRejectsAHalfDecision(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queries := dbmodels.New(pg.DB)
	seed := seedCommentTenant(t, ctx, pg.DB, "RPE")
	comment := mustCreateComment(t, ctx, queries, seed, "published", "RPECOMMENT1")
	reporter := mustInsertUser(t, ctx, pg.DB, seed.tenantID, "RPEREPORT01", "rpe-reporter@example.com", "Reporter")
	report, err := queries.CreateEpisodeCommentReport(ctx, newReportParams(seed.tenantID, comment.ID, reporter))
	if err != nil {
		t.Fatalf("report: %v", err)
	}

	_, err = pg.DB.ExecContext(ctx, "UPDATE episode_comment_reports SET status = 'resolved' WHERE id = $1", report.ID)
	if !isCheckViolation(err) || checkName(err) != "episode_comment_reports_resolved_at_check" {
		t.Fatalf("decision without a timestamp error = %v (%s), want episode_comment_reports_resolved_at_check", err, checkName(err))
	}

	_, err = pg.DB.ExecContext(ctx, "UPDATE episode_comment_reports SET resolved_at = NOW() WHERE id = $1", report.ID)
	if !isCheckViolation(err) || checkName(err) != "episode_comment_reports_resolved_at_check" {
		t.Fatalf("open report with a timestamp error = %v (%s), want episode_comment_reports_resolved_at_check", err, checkName(err))
	}
}

// Purging a comment takes its reports with it. There is nothing left to report
// on, and audit_logs is what keeps the record of the purge.
func TestPurgingACommentDeletesItsReports(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queries := dbmodels.New(pg.DB)
	seed := seedCommentTenant(t, ctx, pg.DB, "RPF")
	comment := mustCreateComment(t, ctx, queries, seed, "published", "RPFCOMMENT1")
	reporter := mustInsertUser(t, ctx, pg.DB, seed.tenantID, "RPFREPORT01", "rpf-reporter@example.com", "Reporter")
	if _, err := queries.CreateEpisodeCommentReport(ctx, newReportParams(seed.tenantID, comment.ID, reporter)); err != nil {
		t.Fatalf("report: %v", err)
	}

	deleted, err := queries.DeleteEpisodeCommentByPublicIDForTenant(ctx, dbmodels.DeleteEpisodeCommentByPublicIDForTenantParams{
		TenantID: seed.tenantID,
		PublicID: comment.PublicID,
	})
	if err != nil {
		t.Fatalf("purge comment: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("purged comments = %d, want 1", deleted)
	}
	if remaining := mustCountReports(t, ctx, pg.DB, comment.ID); remaining != 0 {
		t.Fatalf("reports left behind = %d, want 0", remaining)
	}
}

func newReportParams(tenantID, commentID, reporterID uuid.UUID) dbmodels.CreateEpisodeCommentReportParams {
	return dbmodels.CreateEpisodeCommentReportParams{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       tenantID,
		CommentID:      commentID,
		ReporterUserID: reporterID,
		Reason:         "spam",
		Note:           sql.NullString{String: "Nothing to do with the episode.", Valid: true},
	}
}

func mustRefreshOpenReportCount(t *testing.T, ctx context.Context, queries *dbmodels.Queries, tenantID, commentID uuid.UUID) int32 {
	t.Helper()
	count, err := queries.RefreshEpisodeCommentOpenReportCount(ctx, dbmodels.RefreshEpisodeCommentOpenReportCountParams{
		TenantID:  tenantID,
		CommentID: commentID,
	})
	if err != nil {
		t.Fatalf("refresh open report count: %v", err)
	}
	return count
}

func mustDecideReport(t *testing.T, ctx context.Context, db *sql.DB, reportID uuid.UUID, status string, moderatorID uuid.UUID) {
	t.Helper()
	_, err := db.ExecContext(ctx, `
		UPDATE episode_comment_reports
		SET status = $2, resolved_at = NOW(), resolved_by = $3
		WHERE id = $1
	`, reportID, status, moderatorID)
	if err != nil {
		t.Fatalf("decide report %s as %s: %v", reportID, status, err)
	}
}

func mustCountReports(t *testing.T, ctx context.Context, db *sql.DB, commentID uuid.UUID) int {
	t.Helper()
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM episode_comment_reports WHERE comment_id = $1", commentID).Scan(&count); err != nil {
		t.Fatalf("count reports: %v", err)
	}
	return count
}

func mustReportReason(t *testing.T, ctx context.Context, db *sql.DB, reportID uuid.UUID) string {
	t.Helper()
	var reason string
	if err := db.QueryRowContext(ctx, "SELECT reason FROM episode_comment_reports WHERE id = $1", reportID).Scan(&reason); err != nil {
		t.Fatalf("read report reason: %v", err)
	}
	return reason
}
