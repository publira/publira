package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// What a reader writes raises an errand for the tenant's staff: a comment held
// for approval, and a report against a published one. Both travel as outbox
// events written in the transaction that stores the comment or the report, and
// both collapse into one alert per episode per hour.
//
// These run against a real database because the collapsing is enforced by the
// unique constraint on outbox_events.idempotency_key and by the one on the
// notification's (user_id, notification_type, subject_key), not by anything the
// handlers check for themselves.

// staffAlertCount counts the queued alerts of one kind for a tenant.
func (e *publicDBEnv) staffAlertCount(t *testing.T, tenant testutil.Tenant, eventType string) int {
	t.Helper()

	return e.countRows(t,
		"SELECT COUNT(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = $2",
		tenant.ID, eventType,
	)
}

// drainStaffAlerts runs the worker's handler over every queued alert of one
// kind, the way the outbox worker does once it has claimed them.
func (e *publicDBEnv) drainStaffAlerts(t *testing.T, tenant testutil.Tenant, eventType string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	rows, err := e.PG.DB.QueryContext(ctx,
		"SELECT id, tenant_id, event_type, payload, idempotency_key FROM outbox_events WHERE tenant_id = $1 AND event_type = $2 ORDER BY id",
		tenant.ID, eventType,
	)
	if err != nil {
		t.Fatalf("read queued %s alerts: %v", eventType, err)
	}
	defer rows.Close() //nolint:errcheck

	var events []dbmodels.OutboxEvent
	for rows.Next() {
		var event dbmodels.OutboxEvent
		if err := rows.Scan(&event.ID, &event.TenantID, &event.EventType, &event.Payload, &event.IdempotencyKey); err != nil {
			t.Fatalf("scan queued %s alert: %v", eventType, err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read queued %s alerts: %v", eventType, err)
	}

	cfg := outbox.StaffNotificationHandlerConfig{DB: e.PG.DB}
	var handler outbox.Handler
	switch eventType {
	case outbox.EventTypeCommentAwaitingApprovalNotification:
		handler = outbox.NewCommentAwaitingApprovalNotificationHandler(cfg)
	case outbox.EventTypeCommentReportedNotification:
		handler = outbox.NewCommentReportedNotificationHandler(cfg)
	default:
		t.Fatalf("no staff notification handler for %q", eventType)
	}
	for _, event := range events {
		if err := handler(ctx, event); err != nil {
			t.Fatalf("handle %s alert %s: %v", eventType, event.ID, err)
		}
	}
}

func (e *publicDBEnv) notificationCount(t *testing.T, tenant testutil.Tenant, notificationType string) int {
	t.Helper()

	return e.countRows(t,
		"SELECT COUNT(*) FROM notifications WHERE tenant_id = $1 AND notification_type = $2",
		tenant.ID, notificationType,
	)
}

// staffNotification reads back one alert of the given kind as the console does.
func (e *publicDBEnv) staffNotification(
	t *testing.T,
	tenant testutil.Tenant,
	notificationType string,
) (subjectKey, payload string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := e.PG.DB.QueryRowContext(ctx,
		"SELECT subject_key, payload::text FROM notifications WHERE tenant_id = $1 AND notification_type = $2 ORDER BY id LIMIT 1",
		tenant.ID, notificationType,
	).Scan(&subjectKey, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("no %s notification was written", notificationType)
	}
	if err != nil {
		t.Fatalf("read %s notification: %v", notificationType, err)
	}
	return subjectKey, payload
}

// A burst of comments on one episode is one errand, so the window's first
// comment queues the alert and the rest add nothing. A comment published
// straight away queues none at all: nothing is waiting for anyone.
func TestDBPendingCommentsRaiseOneStaffAlertPerEpisodeWindow(t *testing.T) {
	fixture := newCommentFixture(t, "SNQ")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	second := env.PG.SeedEndUser(t, tenant.ID, "SNQREADER", "snq-reader@example.com", "Second Reader")

	env.setCommentMode(t, tenant.ID, "immediate")
	env.mustPostComment(t, tenant, member, episode.PublicID, "Nothing is waiting for approval.")
	if got := env.staffAlertCount(t, tenant, outbox.EventTypeCommentAwaitingApprovalNotification); got != 0 {
		t.Fatalf("queued approval alerts under immediate = %d, want 0", got)
	}

	env.setCommentMode(t, tenant.ID, "approval_required")
	env.mustPostComment(t, tenant, member, episode.PublicID, "The first one waiting.")
	env.mustPostComment(t, tenant, member, episode.PublicID, "A second one, minutes later.")
	env.mustPostComment(t, tenant, second, episode.PublicID, "And another reader's.")
	if got := env.staffAlertCount(t, tenant, outbox.EventTypeCommentAwaitingApprovalNotification); got != 1 {
		t.Fatalf("queued approval alerts after a burst = %d, want 1", got)
	}

	// A different episode is a different queue to work through, so it gets its
	// own alert inside the same window.
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SNQSERIES2", Title: "Another series", Published: true})
	other := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "SNQEPISOD2",
		Title:    "Another commented episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	env.mustPostComment(t, tenant, member, other.PublicID, "Waiting over here instead.")
	if got := env.staffAlertCount(t, tenant, outbox.EventTypeCommentAwaitingApprovalNotification); got != 2 {
		t.Fatalf("queued approval alerts across two episodes = %d, want 2", got)
	}
}

// The alert reaches every member of staff the tenant has and no reader, and
// names the episode they have to open. Draining it twice writes nothing more:
// the worker is at-least-once, and the bell must not show one window twice.
func TestDBPendingCommentAlertNotifiesEveryStaffMemberOnce(t *testing.T) {
	fixture := newCommentFixture(t, "SNN")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.PG.SeedTenantAdmin(t, tenant.ID, "SNNSTAFF1", "snn-staff-1@example.com", "First Moderator")
	env.PG.SeedTenantAdmin(t, tenant.ID, "SNNSTAFF2", "snn-staff-2@example.com", "Second Moderator")

	env.setCommentMode(t, tenant.ID, "approval_required")
	env.mustPostComment(t, tenant, member, episode.PublicID, "Waiting for a moderator.")
	env.drainStaffAlerts(t, tenant, outbox.EventTypeCommentAwaitingApprovalNotification)

	if got := env.notificationCount(t, tenant, outbox.NotificationTypeCommentAwaitingApproval); got != 2 {
		t.Fatalf("notifications after the first drain = %d, want one per staff member", got)
	}
	env.drainStaffAlerts(t, tenant, outbox.EventTypeCommentAwaitingApprovalNotification)
	if got := env.notificationCount(t, tenant, outbox.NotificationTypeCommentAwaitingApproval); got != 2 {
		t.Fatalf("notifications after a redelivery = %d, want the same 2", got)
	}

	// The reader who wrote the comment is not staff and hears nothing about the
	// queue their own comment landed in.
	if got := env.countRows(t,
		"SELECT COUNT(*) FROM notifications WHERE tenant_id = $1 AND user_id = $2",
		tenant.ID, member.ID,
	); got != 0 {
		t.Fatalf("notifications addressed to the commenting reader = %d, want 0", got)
	}

	// The episode is what the key has to name here. Recomputing the whole key
	// would read the clock a second time, and a run that crossed the UTC hour in
	// between would expect the next window; the window format is the unit test's
	// assertion, not this one's.
	subjectKey, payload := env.staffNotification(t, tenant, outbox.NotificationTypeCommentAwaitingApproval)
	if want := "episode:" + episode.PublicID + ":"; !strings.HasPrefix(subjectKey, want) {
		t.Fatalf("notification subject_key = %q, want it to start with %q", subjectKey, want)
	}
	// The console assembles its copy and its link from the payload, so the
	// alert has to name the episode and the series it is on.
	for _, want := range []string{episode.PublicID, "Commented episode", "Commented series"} {
		if !strings.Contains(payload, want) {
			t.Fatalf("notification payload %s, want it to name %q", payload, want)
		}
	}
}

// A report is its own errand: it collapses across the window the way the
// approval queue does, and it is a separate alert from the one an approval
// queue raises.
func TestDBCommentReportsRaiseOneStaffAlertPerEpisodeWindow(t *testing.T) {
	fixture := newCommentFixture(t, "SNR")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	env.PG.SeedTenantAdmin(t, tenant.ID, "SNRSTAFF", "snr-staff@example.com", "Moderator")
	first := env.PG.SeedEndUser(t, tenant.ID, "SNRREADER", "snr-reader@example.com", "Reporting Reader")
	second := env.PG.SeedEndUser(t, tenant.ID, "SNRREADR2", "snr-reader-2@example.com", "Another Reader")

	env.setCommentMode(t, tenant.ID, "immediate")
	comment := env.mustPostComment(t, tenant, member, episode.PublicID, "Buy cheap watches at example.com")
	other := env.mustPostComment(t, tenant, member, episode.PublicID, "And again here.")

	if err := env.reportComment(t, tenant, first, comment.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); err != nil {
		t.Fatalf("ReportEpisodeComment: %v", err)
	}
	if got := env.staffAlertCount(t, tenant, outbox.EventTypeCommentReportedNotification); got != 1 {
		t.Fatalf("queued report alerts after one report = %d, want 1", got)
	}

	// A second reader's report and a report on a second comment are the same
	// episode's queue, so neither raises another alert this hour.
	if err := env.reportComment(t, tenant, second, comment.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_ABUSE); err != nil {
		t.Fatalf("second reader's ReportEpisodeComment: %v", err)
	}
	if err := env.reportComment(t, tenant, first, other.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); err != nil {
		t.Fatalf("ReportEpisodeComment on a second comment: %v", err)
	}
	if got := env.staffAlertCount(t, tenant, outbox.EventTypeCommentReportedNotification); got != 1 {
		t.Fatalf("queued report alerts after three reports = %d, want 1", got)
	}

	// The approval queue is a different errand and stays empty: this tenant
	// publishes immediately, so nothing is waiting to be approved.
	if got := env.staffAlertCount(t, tenant, outbox.EventTypeCommentAwaitingApprovalNotification); got != 0 {
		t.Fatalf("queued approval alerts = %d, want 0", got)
	}

	env.drainStaffAlerts(t, tenant, outbox.EventTypeCommentReportedNotification)
	if got := env.notificationCount(t, tenant, outbox.NotificationTypeCommentReported); got != 1 {
		t.Fatalf("report notifications = %d, want one for the tenant's only staff member", got)
	}
}

// A repeated report writes no report row, so it must not queue an alert
// either — a reader tapping the button again is not a new errand.
func TestDBRepeatedCommentReportRaisesNoStaffAlert(t *testing.T) {
	fixture := newCommentFixture(t, "SNP")
	env, tenant, member, episode := fixture.env, fixture.tenant, fixture.member, fixture.episode
	reporter := env.PG.SeedEndUser(t, tenant.ID, "SNPREADER", "snp-reader@example.com", "Reporting Reader")

	env.setCommentMode(t, tenant.ID, "immediate")
	comment := env.mustPostComment(t, tenant, member, episode.PublicID, "Buy cheap watches at example.com")
	if err := env.reportComment(t, tenant, reporter, comment.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_SPAM); err != nil {
		t.Fatalf("ReportEpisodeComment: %v", err)
	}

	// The alert the first report queued is taken out of the way, so the repeat
	// cannot hide behind the window that report opened.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx,
		"DELETE FROM outbox_events WHERE tenant_id = $1 AND event_type = $2",
		tenant.ID, outbox.EventTypeCommentReportedNotification,
	); err != nil {
		t.Fatalf("clear queued report alerts: %v", err)
	}

	if err := env.reportComment(t, tenant, reporter, comment.PublicId, publirav1.CommentReportReason_COMMENT_REPORT_REASON_ABUSE); err != nil {
		t.Fatalf("repeated ReportEpisodeComment: %v", err)
	}
	if got := env.staffAlertCount(t, tenant, outbox.EventTypeCommentReportedNotification); got != 0 {
		t.Fatalf("queued report alerts after a repeat = %d, want 0", got)
	}
}
