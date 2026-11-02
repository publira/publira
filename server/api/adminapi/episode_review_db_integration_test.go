package adminapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// episodeReviewFixture is a tenant that requires review, its Tenant admin, an
// Editor, and a draft episode of a published series.
type episodeReviewFixture struct {
	admin     adminDBTenant
	editor    adminDBTenant
	auditor   adminDBTenant
	episodeID string
	publicID  string
}

func (e *adminDBEnv) seedEpisodeReviewFixture(t *testing.T, prefix string) episodeReviewFixture {
	t.Helper()

	admin := e.seedTenantWithAdmin(t, prefix, prefix+".example.com", "Review "+prefix, prefix+"ADMIN1", "admin@"+prefix+".example.com")
	editor := admin.as(e.PG.SeedTenantUser(t, admin.Tenant.ID, prefix+"EDIT01", "editor@"+prefix+".example.com", "Editor", auth.RoleTenantEditor))
	auditor := admin.as(e.PG.SeedTenantUser(t, admin.Tenant.ID, prefix+"AUDIT1", "auditor@"+prefix+".example.com", "Auditor", auth.RoleTenantAuditor))
	series := e.PG.SeedSeries(t, admin.Tenant.ID, testutil.SeriesSeed{PublicID: prefix + "SER001", Title: "Series", Published: true})
	episode := e.PG.SeedEpisode(t, admin.Tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: prefix + "EP0001", Title: "Episode", Status: testutil.EpisodeStatusDraft})
	return episodeReviewFixture{admin: admin, editor: editor, auditor: auditor, episodeID: episode.ID.String(), publicID: episode.PublicID}
}

func (e *adminDBEnv) setEpisodeReviewRequired(t *testing.T, admin adminDBTenant, required bool) {
	t.Helper()
	res, err := e.tenantSettingsClient().UpdateTenantEpisodeReviewSettings(testutil.WithBearer(context.Background(), admin.token()), &publiraadminv1.UpdateTenantEpisodeReviewSettingsRequest{
		Tenant:                admin.tenantContext(),
		EpisodeReviewRequired: required,
	})
	if err != nil {
		t.Fatalf("UpdateTenantEpisodeReviewSettings: %v", err)
	}
	if res.EpisodeReviewRequired != required {
		t.Fatalf("episode_review_required = %v, want %v", res.EpisodeReviewRequired, required)
	}
}

func (e *adminDBEnv) dashboardClient() publiraadminv1connect.AdminDashboardServiceClient {
	return publiraadminv1connect.NewAdminDashboardServiceClient(connect.NewClient(connecthttp.NewTransport(e.Server.Client(), e.Server.URL)))
}

func reviewState(t *testing.T, episode *publirattypesv1.Episode) publirattypesv1.EpisodeReviewState {
	t.Helper()
	if episode.GetReview() == nil {
		return publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_UNSPECIFIED
	}
	return episode.GetReview().GetState()
}

// One episode through every step: saved with a time, sent back with a
// comment, submitted again, approved, and edited after it was approved. The
// time is kept throughout, each step is in the audit log, and the rounds read
// back in order with their comments.
func TestDBEpisodeReviewRoundsFromSubmissionToApproval(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedEpisodeReviewFixture(t, "REVFLW")
	env.setEpisodeReviewRequired(t, f.admin, true)
	ctx := context.Background()
	series := env.seriesClient()
	scheduledAt := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Second).Format(time.RFC3339)

	scheduled, err := series.UpdateEpisodePublishSchedule(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID, ScheduledAt: scheduledAt,
	})
	if err != nil {
		t.Fatalf("UpdateEpisodePublishSchedule: %v", err)
	}
	if scheduled.Episode.Status != "scheduled" || reviewState(t, scheduled.Episode) != publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW {
		t.Fatalf("saved episode = %s, %v, want scheduled and in review", scheduled.Episode.Status, scheduled.Episode.Review)
	}

	if _, err := series.SubmitEpisodeForReview(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.SubmitEpisodeForReviewRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID,
	}); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("SubmitEpisodeForReview while in review: code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if _, err := series.ApproveEpisode(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.ApproveEpisodeRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID,
	}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ApproveEpisode as an Editor: code = %v, want permission_denied", connect.CodeOf(err))
	}
	if _, err := series.ReturnEpisode(testutil.WithBearer(ctx, f.admin.token()), &publiraadminv1.ReturnEpisodeRequest{
		Tenant: f.admin.tenantContext(), EpisodeId: f.episodeID, Comment: "  ",
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ReturnEpisode without a comment: code = %v, want invalid_argument", connect.CodeOf(err))
	}

	returned, err := series.ReturnEpisode(testutil.WithBearer(ctx, f.admin.token()), &publiraadminv1.ReturnEpisodeRequest{
		Tenant: f.admin.tenantContext(), EpisodeId: f.episodeID, Comment: "The speech bubble on page 4 is cut off.",
	})
	if err != nil {
		t.Fatalf("ReturnEpisode: %v", err)
	}
	if reviewState(t, returned.Episode) != publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_RETURNED ||
		returned.Episode.Review.Comment != "The speech bubble on page 4 is cut off." ||
		returned.Episode.ScheduledAt != scheduledAt || returned.Episode.Status != "scheduled" {
		t.Fatalf("returned episode = %s at %s, %v, want scheduled at %s and returned with the comment", returned.Episode.Status, returned.Episode.ScheduledAt, returned.Episode.Review, scheduledAt)
	}
	events := env.pendingOutboxEvents(t, outbox.EventTypeEpisodeReviewReturnedNotification)
	if len(events) != 1 {
		t.Fatalf("returned notifications = %d, want 1", len(events))
	}
	var payload outbox.EpisodeReviewReturnedNotificationPayload
	if err := json.Unmarshal(events[0].Payload, &payload); err != nil {
		t.Fatalf("decode the returned notification: %v", err)
	}
	if payload.TenantID != f.admin.Tenant.ID.String() || payload.ReviewID == "" {
		t.Fatalf("returned notification payload = %+v", payload)
	}

	resubmitted, err := series.SubmitEpisodeForReview(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.SubmitEpisodeForReviewRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID,
	})
	if err != nil {
		t.Fatalf("SubmitEpisodeForReview: %v", err)
	}
	if reviewState(t, resubmitted.Episode) != publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW {
		t.Fatalf("resubmitted episode review = %v, want in review", resubmitted.Episode.Review)
	}

	approved, err := series.ApproveEpisode(testutil.WithBearer(ctx, f.admin.token()), &publiraadminv1.ApproveEpisodeRequest{
		Tenant: f.admin.tenantContext(), EpisodeId: f.episodeID,
	})
	if err != nil {
		t.Fatalf("ApproveEpisode: %v", err)
	}
	if reviewState(t, approved.Episode) != publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_APPROVED || approved.Episode.Status != "scheduled" {
		t.Fatalf("approved episode = %s, %v, want scheduled and approved", approved.Episode.Status, approved.Episode.Review)
	}

	// Saving the time it was approved at changes nothing a review looks at.
	if res, err := series.UpdateEpisodePublishSchedule(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID, ScheduledAt: scheduledAt,
	}); err != nil || reviewState(t, res.Episode) != publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_APPROVED {
		t.Fatalf("resaving the approved time: %v, %v, want it still approved", err, res.GetEpisode().GetReview())
	}

	edited, err := series.UpdateEpisodeTitle(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.UpdateEpisodeTitleRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID, Title: "Episode, revised",
	})
	if err != nil {
		t.Fatalf("UpdateEpisodeTitle: %v", err)
	}
	if reviewState(t, edited.Episode) != publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW {
		t.Fatalf("edited episode review = %v, want it back in review", edited.Episode.Review)
	}

	rounds, err := series.ListEpisodeReviews(testutil.WithBearer(ctx, f.auditor.token()), &publiraadminv1.ListEpisodeReviewsRequest{
		Tenant: f.auditor.tenantContext(), EpisodeId: f.episodeID,
	})
	if err != nil {
		t.Fatalf("ListEpisodeReviews: %v", err)
	}
	want := []struct {
		state     publirattypesv1.EpisodeReviewState
		submitter string
		decider   string
		comment   string
	}{
		{publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_RETURNED, f.editor.User.PublicID, f.admin.User.PublicID, "The speech bubble on page 4 is cut off."},
		{publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_APPROVED, f.editor.User.PublicID, f.admin.User.PublicID, ""},
		{publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW, f.editor.User.PublicID, "", ""},
	}
	if len(rounds.Rounds) != len(want) {
		t.Fatalf("rounds = %v, want %d", rounds.Rounds, len(want))
	}
	for i, round := range rounds.Rounds {
		if round.State != want[i].state || round.SubmittedByUserPublicId != want[i].submitter ||
			round.DecidedByUserPublicId != want[i].decider || round.Comment != want[i].comment {
			t.Fatalf("rounds[%d] = %v, want %+v", i, round, want[i])
		}
	}

	for action, wantCount := range map[string]int{
		"episode_review_submitted": 3,
		"episode_review_returned":  1,
		"episode_review_approved":  1,
	} {
		if got := env.countRows(t,
			"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND target_type = 'episode' AND target_id = $3",
			f.admin.Tenant.ID, action, f.publicID); got != wantCount {
			t.Fatalf("%s entries = %d, want %d", action, got, wantCount)
		}
	}

	inReview, err := series.ListEpisodes(testutil.WithBearer(ctx, f.auditor.token()), &publiraadminv1.ListEpisodesRequest{
		Tenant: f.auditor.tenantContext(), SeriesId: env.seriesID(t, "REVFLWSER001"), ReviewState: publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW,
	})
	if err != nil {
		t.Fatalf("ListEpisodes in review: %v", err)
	}
	if len(inReview.Episodes) != 1 || inReview.Episodes[0].Id != f.episodeID {
		t.Fatalf("episodes in review = %v, want the edited one", inReview.Episodes)
	}
	approvedList, err := series.ListEpisodes(testutil.WithBearer(ctx, f.auditor.token()), &publiraadminv1.ListEpisodesRequest{
		Tenant: f.auditor.tenantContext(), SeriesId: env.seriesID(t, "REVFLWSER001"), ReviewState: publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_APPROVED,
	})
	if err != nil {
		t.Fatalf("ListEpisodes approved: %v", err)
	}
	if len(approvedList.Episodes) != 0 {
		t.Fatalf("approved episodes = %v, want none", approvedList.Episodes)
	}
}

// With review on, a time that has passed is saved for review rather than
// published, and the approval of an episode whose time has passed publishes
// it at once.
func TestDBApprovingAnEpisodeWhoseTimeHasPassedPublishesIt(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedEpisodeReviewFixture(t, "REVPST")
	env.setEpisodeReviewRequired(t, f.admin, true)
	ctx := context.Background()
	series := env.seriesClient()

	saved, err := series.UpdateEpisodePublishSchedule(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID, ScheduledAt: time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("UpdateEpisodePublishSchedule: %v", err)
	}
	if saved.Episode.Status != "scheduled" || reviewState(t, saved.Episode) != publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW {
		t.Fatalf("saved episode = %s, %v, want scheduled and in review", saved.Episode.Status, saved.Episode.Review)
	}

	approved, err := series.ApproveEpisode(testutil.WithBearer(ctx, f.admin.token()), &publiraadminv1.ApproveEpisodeRequest{
		Tenant: f.admin.tenantContext(), EpisodeId: f.episodeID, Comment: "Looks good.",
	})
	if err != nil {
		t.Fatalf("ApproveEpisode: %v", err)
	}
	if approved.Episode.Status != "published" || approved.Episode.PublishedAt == "" {
		t.Fatalf("approved episode = %s at %q, want published", approved.Episode.Status, approved.Episode.PublishedAt)
	}
	if approved.Episode.Review.GetComment() != "Looks good." {
		t.Fatalf("approval comment = %q, want it kept", approved.Episode.Review.GetComment())
	}
}

// Turning review on puts every scheduled episode in review, so the Dashboard
// counts and names what it now holds back; a draft has no time to review.
func TestDBTurningReviewOnSubmitsTheScheduledEpisodes(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedEpisodeReviewFixture(t, "REVTRN")
	series := env.PG.SeedSeries(t, f.admin.Tenant.ID, testutil.SeriesSeed{PublicID: "REVTRNSER002", Title: "Other", Published: true})
	scheduled := env.PG.SeedEpisode(t, f.admin.Tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "REVTRNEP0002", Title: "Scheduled", Status: testutil.EpisodeStatusScheduled, ScheduledAt: time.Now().Add(24 * time.Hour),
	})

	env.setEpisodeReviewRequired(t, f.admin, true)
	// Saving the setting again changes nothing, so it opens no second round.
	env.setEpisodeReviewRequired(t, f.admin, true)

	dashboard, err := env.dashboardClient().GetDashboard(testutil.WithBearer(context.Background(), f.auditor.token()), &publiraadminv1.GetDashboardRequest{
		Tenant: f.auditor.tenantContext(),
	})
	if err != nil {
		t.Fatalf("GetDashboard: %v", err)
	}
	if dashboard.Stats.InReviewEpisodeCount != 1 {
		t.Fatalf("in review = %d, want 1", dashboard.Stats.InReviewEpisodeCount)
	}
	for _, item := range dashboard.Queue {
		want := publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_UNSPECIFIED
		if item.EpisodePublicId == scheduled.PublicID {
			want = publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW
		}
		if item.ReviewState != want {
			t.Fatalf("queue item %s review state = %v, want %v", item.EpisodePublicId, item.ReviewState, want)
		}
	}
	if got := env.countRows(t, "SELECT count(*) FROM episode_reviews WHERE episode_id = $1 AND decision IS NULL AND submitted_by_user_id IS NULL", scheduled.ID); got != 1 {
		t.Fatalf("open rounds of the scheduled episode = %d, want 1 in no one's name", got)
	}
}

// With review off, submitting is refused, and saving a time behaves as it
// always did: no round is opened.
func TestDBSubmittingIsRefusedWhileReviewIsOff(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedEpisodeReviewFixture(t, "REVOFF")
	ctx := context.Background()

	saved, err := env.seriesClient().UpdateEpisodePublishSchedule(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID, ScheduledAt: time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("UpdateEpisodePublishSchedule: %v", err)
	}
	if saved.Episode.Review != nil {
		t.Fatalf("review = %v, want none while review is off", saved.Episode.Review)
	}
	if _, err := env.seriesClient().SubmitEpisodeForReview(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.SubmitEpisodeForReviewRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID,
	}); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("SubmitEpisodeForReview: code = %v, want failed_precondition", connect.CodeOf(err))
	}
	if got := env.countRows(t, "SELECT count(*) FROM episode_reviews WHERE tenant_id = $1", f.admin.Tenant.ID); got != 0 {
		t.Fatalf("rounds = %d, want none", got)
	}
}

// Taking an episode in review back to a draft withdraws its open round, and a
// return the Tenant admin makes of their own submission tells nobody.
func TestDBDraftWithdrawsTheOpenRoundAndAReturnOfOnesOwnSubmissionTellsNobody(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	f := env.seedEpisodeReviewFixture(t, "REVDRF")
	env.setEpisodeReviewRequired(t, f.admin, true)
	ctx := context.Background()
	series := env.seriesClient()
	at := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)

	if _, err := series.UpdateEpisodePublishSchedule(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID, ScheduledAt: at,
	}); err != nil {
		t.Fatalf("schedule: %v", err)
	}
	draft, err := series.UpdateEpisodePublishSchedule(testutil.WithBearer(ctx, f.editor.token()), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant: f.editor.tenantContext(), EpisodeId: f.episodeID,
	})
	if err != nil {
		t.Fatalf("back to a draft: %v", err)
	}
	if draft.Episode.Status != "draft" || draft.Episode.Review != nil {
		t.Fatalf("draft = %s, %v, want a draft with no review", draft.Episode.Status, draft.Episode.Review)
	}
	if got := env.countRows(t, "SELECT count(*) FROM episode_reviews WHERE tenant_id = $1", f.admin.Tenant.ID); got != 0 {
		t.Fatalf("rounds = %d, want the withdrawn one gone", got)
	}

	if _, err := series.UpdateEpisodePublishSchedule(testutil.WithBearer(ctx, f.admin.token()), &publiraadminv1.UpdateEpisodePublishScheduleRequest{
		Tenant: f.admin.tenantContext(), EpisodeId: f.episodeID, ScheduledAt: at,
	}); err != nil {
		t.Fatalf("schedule as the Tenant admin: %v", err)
	}
	if _, err := series.ReturnEpisode(testutil.WithBearer(ctx, f.admin.token()), &publiraadminv1.ReturnEpisodeRequest{
		Tenant: f.admin.tenantContext(), EpisodeId: f.episodeID, Comment: "Not yet.",
	}); err != nil {
		t.Fatalf("ReturnEpisode: %v", err)
	}
	if events := env.pendingOutboxEvents(t, outbox.EventTypeEpisodeReviewReturnedNotification); len(events) != 0 {
		t.Fatalf("returned notifications = %d, want none for one's own submission", len(events))
	}
}
