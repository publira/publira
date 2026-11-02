package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/publishepisodes"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// maxEpisodeReviewCommentLength bounds what a Tenant admin writes with a
// decision, in characters: room for a list of fixes, and short enough to
// travel whole in the mail that tells the submitter.
const maxEpisodeReviewCommentLength = 2000

// The episode_listings.review_state and episode_reviews.decision values.
const (
	episodeReviewInReview = "in_review"
	episodeReviewApproved = "approved"
	episodeReviewReturned = "returned"
)

func episodeReviewStateFromStored(stored string) (publirattypesv1.EpisodeReviewState, error) {
	switch stored {
	case episodeReviewInReview:
		return publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW, nil
	case episodeReviewApproved:
		return publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_APPROVED, nil
	case episodeReviewReturned:
		return publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_RETURNED, nil
	default:
		return publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_UNSPECIFIED, fmt.Errorf("unknown episode review state %q", stored)
	}
}

// episodeReviewStateFilter is the stored state ListEpisodes narrows to, and
// the empty string for no filter.
func episodeReviewStateFilter(state publirattypesv1.EpisodeReviewState) (string, error) {
	switch state {
	case publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_UNSPECIFIED:
		return "", nil
	case publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW:
		return episodeReviewInReview, nil
	case publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_APPROVED:
		return episodeReviewApproved, nil
	case publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_RETURNED:
		return episodeReviewReturned, nil
	default:
		return "", rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("review_state is not a known state"), "review_state")
	}
}

// episodeReviewComment trims a decision's comment and refuses one past the
// limit. required is a return, which has to say what to fix.
func episodeReviewComment(comment string, required bool) (sql.NullString, error) {
	trimmed := strings.TrimSpace(comment)
	if trimmed == "" {
		if required {
			return sql.NullString{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("comment is required"), "comment")
		}
		return sql.NullString{}, nil
	}
	if utf8.RuneCountInString(trimmed) > maxEpisodeReviewCommentLength {
		return sql.NullString{}, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, fmt.Errorf("comment must be at most %d characters", maxEpisodeReviewCommentLength), "comment")
	}
	return sql.NullString{String: trimmed, Valid: true}, nil
}

// fillEpisodeDetails puts onto each episode what a console answer carries of
// it beyond its own row: its eye-catch, and where it stands in review.
func (s *adminServer) fillEpisodeDetails(ctx context.Context, tenantID uuid.UUID, episodes ...*publirattypesv1.Episode) error {
	if err := s.fillEpisodeEyeCatches(ctx, tenantID, episodes...); err != nil {
		return err
	}
	return s.fillEpisodeReviews(ctx, tenantID, episodes...)
}

// fillEpisodeReviews sets Episode.review on each episode a round was ever
// opened for, from its latest round.
func (s *adminServer) fillEpisodeReviews(ctx context.Context, tenantID uuid.UUID, episodes ...*publirattypesv1.Episode) error {
	if len(episodes) == 0 {
		return nil
	}
	ids, err := protomapper.EpisodeIDs(episodes)
	if err != nil {
		return s.internalError(ctx, "episode response carries an id that is not one", err, "tenant_id", tenantID.String())
	}
	rows, err := s.queriesFor(ctx).ListLatestEpisodeReviewsByEpisodeIDs(ctx, dbmodels.ListLatestEpisodeReviewsByEpisodeIDsParams{
		TenantID:   tenantID,
		EpisodeIds: ids,
	})
	if err != nil {
		return s.internalDBError(ctx, "failed to list episode reviews", err, "tenant_id", tenantID.String())
	}
	reviews := make(map[string]*publirattypesv1.EpisodeReview, len(rows))
	for _, row := range rows {
		state, err := episodeReviewStateFromStored(row.ReviewState)
		if err != nil {
			return s.internalError(ctx, "episode holds a review state this build does not know", err, "tenant_id", tenantID.String(), "episode_id", row.EpisodeID.String())
		}
		reviews[row.EpisodeID.String()] = &publirattypesv1.EpisodeReview{
			State:       state,
			SubmittedAt: row.SubmittedAt.UTC().Format(time.RFC3339),
			DecidedAt:   formatOptionalTime(row.DecidedAt),
			Comment:     row.Comment.String,
		}
	}
	for _, episode := range episodes {
		episode.Review = reviews[episode.Id]
	}
	return nil
}

// consoleEpisode answers one episode in the shape the console's episode writes
// respond with.
func (s *adminServer) consoleEpisode(ctx context.Context, tenantID, episodeID uuid.UUID) (*publirattypesv1.Episode, error) {
	row, err := s.queriesFor(ctx).GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenantID, ID: episodeID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	episode := protomapper.EpisodeFromGetEpisodeByIDForTenantRow(row)
	if err := setEpisodeAvailability(episode, row.Availability); err != nil {
		return nil, s.internalError(ctx, "episode holds an availability this build does not know", err, "tenant_id", tenantID.String(), "episode_public_id", row.PublicID)
	}
	if _, err := episodePurchaseAvailability(episode, row.PurchaseAvailability, row.ResolvedPurchaseAvailability); err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenantID.String(), "episode_public_id", row.PublicID)
	}
	if err := s.fillEpisodeDetails(ctx, tenantID, episode); err != nil {
		return nil, err
	}
	return episode, nil
}

// writeEpisodeReviewAudit records a review step on the querier txCtx carries,
// so the step and its entry commit together.
func (s *adminServer) writeEpisodeReviewAudit(txCtx context.Context, tenantID uuid.UUID, action, episodePublicID string) error {
	session, ok := rpcmiddleware.SessionContextFromContext(txCtx)
	if !ok {
		return nil
	}
	if err := auditlog.WriteTenant(txCtx, s.queriesFor(txCtx), s.logger, auditlog.TenantEntry{
		TenantID:    tenantID,
		ActorUserID: session.User.ID,
		ActorRole:   session.Role,
		Action:      action,
		TargetType:  "episode",
		TargetID:    episodePublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    clientip.FromContext(txCtx),
	}); err != nil {
		return s.internalDBError(txCtx, "failed to record the audit entry of an episode review", err, "tenant_id", tenantID.String(), "action", action)
	}
	return nil
}

// sessionUserID is the caller's account, which a round names as its submitter
// or its decider.
func sessionUserID(ctx context.Context) uuid.NullUUID {
	session, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok || session.Service {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: session.User.ID, Valid: true}
}

// openEpisodeReview puts an episode in review in the caller's name, in the
// transaction txCtx carries. An episode already in review is left as it is:
// its round is still open, and a second save is the same submission.
func (s *adminServer) openEpisodeReview(txCtx context.Context, tenantID uuid.UUID, listing dbmodels.LockEpisodeListingForReviewRow) error {
	if listing.ReviewState.String == episodeReviewInReview {
		return nil
	}
	q := s.queriesFor(txCtx)
	if err := q.OpenEpisodeReview(txCtx, dbmodels.OpenEpisodeReviewParams{
		TenantID:          tenantID,
		EpisodeID:         listing.EpisodeID,
		SubmittedByUserID: sessionUserID(txCtx),
	}); err != nil {
		return s.internalDBError(txCtx, "failed to open an episode review", err, "tenant_id", tenantID.String(), "episode_id", listing.EpisodeID.String())
	}
	if err := q.SetEpisodeListingReviewState(txCtx, dbmodels.SetEpisodeListingReviewStateParams{
		TenantID:    tenantID,
		EpisodeID:   listing.EpisodeID,
		ReviewState: sql.NullString{String: episodeReviewInReview, Valid: true},
	}); err != nil {
		return s.internalDBError(txCtx, "failed to put an episode in review", err, "tenant_id", tenantID.String(), "episode_id", listing.EpisodeID.String())
	}
	return s.writeEpisodeReviewAudit(txCtx, tenantID, "episode_review_submitted", listing.EpisodePublicID)
}

// reopenEpisodeReview takes back the approval of an episode an edit has just
// changed, in the edit's transaction, so what is published is what a Tenant
// admin approved. It changes nothing for an episode that is not approved, is
// already published, or belongs to a tenant that does not require review.
func (s *adminServer) reopenEpisodeReview(txCtx context.Context, tenantID, episodeID uuid.UUID) error {
	return s.reopenEpisodeReviews(txCtx, tenantID, []uuid.UUID{episodeID})
}

// reopenEpisodeReviews is reopenEpisodeReview for every episode one edit
// changed, in one statement.
func (s *adminServer) reopenEpisodeReviews(txCtx context.Context, tenantID uuid.UUID, episodeIDs []uuid.UUID) error {
	publicIDs, err := s.queriesFor(txCtx).ReopenApprovedEpisodeReviews(txCtx, dbmodels.ReopenApprovedEpisodeReviewsParams{
		TenantID:          tenantID,
		EpisodeIds:        episodeIDs,
		SubmittedByUserID: sessionUserID(txCtx),
	})
	if err != nil {
		return s.internalDBError(txCtx, "failed to take back the approval of an edited episode", err, "tenant_id", tenantID.String())
	}
	for _, publicID := range publicIDs {
		if err := s.writeEpisodeReviewAudit(txCtx, tenantID, "episode_review_submitted", publicID); err != nil {
			return err
		}
	}
	return nil
}

// lockEpisodeListingForReview locks the listing a review step acts on, and
// answers not_found for an episode the tenant does not have.
func (s *adminServer) lockEpisodeListingForReview(txCtx context.Context, tenantID, episodeID uuid.UUID) (dbmodels.LockEpisodeListingForReviewRow, error) {
	listing, err := s.queriesFor(txCtx).LockEpisodeListingForReview(txCtx, dbmodels.LockEpisodeListingForReviewParams{
		TenantID:  tenantID,
		EpisodeID: episodeID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return listing, connect.NewError(connect.CodeNotFound, "episode not found")
	}
	if err != nil {
		return listing, s.internalDBError(txCtx, "failed to lock the episode listing for review", err, "tenant_id", tenantID.String(), "episode_id", episodeID.String())
	}
	return listing, nil
}

func (s *adminServer) episodeReviewRequired(txCtx context.Context, tenantID uuid.UUID) (bool, error) {
	required, err := s.queriesFor(txCtx).GetTenantEpisodeReviewRequired(txCtx, tenantID)
	if err != nil {
		return false, s.internalDBError(txCtx, "failed to read whether the tenant requires episode review", err, "tenant_id", tenantID.String())
	}
	return required, nil
}

func (s *adminServer) SubmitEpisodeForReview(
	ctx context.Context,
	req *publiraadminv1.SubmitEpisodeForReviewRequest,
) (*publiraadminv1.SubmitEpisodeForReviewResponse, error) {
	if _, err := s.requireTenantEditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}

	// Nothing a reader sees changes, so there is no cache to drop.
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		required, err := s.episodeReviewRequired(txCtx, tenant.ID)
		if err != nil {
			return nil, err
		}
		if !required {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "the tenant does not require episode review")
		}
		listing, err := s.lockEpisodeListingForReview(txCtx, tenant.ID, episodeID)
		if err != nil {
			return nil, err
		}
		switch {
		case listing.Status == "published":
			return nil, connect.NewError(connect.CodeFailedPrecondition, "a published episode is not reviewed")
		case !listing.ScheduledAt.Valid:
			return nil, connect.NewError(connect.CodeFailedPrecondition, "an episode without a publication time cannot be submitted for review")
		case listing.ReviewState.String == episodeReviewInReview:
			return nil, connect.NewError(connect.CodeFailedPrecondition, "the episode is already in review")
		case listing.ReviewState.String == episodeReviewApproved:
			return nil, connect.NewError(connect.CodeFailedPrecondition, "the episode is already approved")
		}
		return nil, s.openEpisodeReview(txCtx, tenant.ID, listing)
	}); err != nil {
		return nil, err
	}

	episode, err := s.consoleEpisode(ctx, tenant.ID, episodeID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.SubmitEpisodeForReviewResponse{Episode: episode}, nil
}

func (s *adminServer) ApproveEpisode(
	ctx context.Context,
	req *publiraadminv1.ApproveEpisodeRequest,
) (*publiraadminv1.ApproveEpisodeResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	comment, err := episodeReviewComment(req.Comment, false)
	if err != nil {
		return nil, err
	}

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		q := s.queriesFor(txCtx)
		listing, err := s.lockEpisodeListingForReview(txCtx, tenant.ID, episodeID)
		if err != nil {
			return nil, err
		}
		if listing.ReviewState.String != episodeReviewInReview {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "the episode is not in review")
		}
		round, err := q.DecideEpisodeReview(txCtx, dbmodels.DecideEpisodeReviewParams{
			Decision:        episodeReviewApproved,
			DecidedByUserID: sessionUserID(txCtx),
			Comment:         comment,
			TenantID:        tenant.ID,
			EpisodeID:       episodeID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "the episode is not in review")
		}
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to approve the episode review", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		if err := q.SetEpisodeListingReviewState(txCtx, dbmodels.SetEpisodeListingReviewStateParams{
			TenantID:         tenant.ID,
			EpisodeID:        episodeID,
			ReviewState:      sql.NullString{String: episodeReviewApproved, Valid: true},
			ReviewApprovedAt: round.DecidedAt,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the approval on the episode", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		if err := s.writeEpisodeReviewAudit(txCtx, tenant.ID, "episode_review_approved", listing.EpisodePublicID); err != nil {
			return nil, err
		}
		// An episode whose time passed while it waited is published now, the
		// way UpdateEpisodePublishSchedule publishes one given a time that has
		// passed, rather than on the scheduled publication job's next pass.
		if listing.Status != "scheduled" || !listing.ScheduledAt.Valid || listing.ScheduledAt.Time.After(time.Now()) {
			return nil, nil
		}
		rows, err := q.PublishEpisodeNowByIDForTenant(txCtx, dbmodels.PublishEpisodeNowByIDForTenantParams{TenantID: tenant.ID, ID: episodeID, ScheduledAt: listing.ScheduledAt.Time})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to publish the approved episode", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		if rows == 0 {
			return nil, nil
		}
		if err := recordEpisodePublication(txCtx, q, tenant.ID, listing.SeriesID, episodeID); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the publication of the approved episode", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		return publishepisodes.RevalidateTags(tenant.ID), nil
	}); err != nil {
		return nil, err
	}

	episode, err := s.consoleEpisode(ctx, tenant.ID, episodeID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ApproveEpisodeResponse{Episode: episode}, nil
}

func (s *adminServer) ReturnEpisode(
	ctx context.Context,
	req *publiraadminv1.ReturnEpisodeRequest,
) (*publiraadminv1.ReturnEpisodeResponse, error) {
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	comment, err := episodeReviewComment(req.Comment, true)
	if err != nil {
		return nil, err
	}

	// The episode keeps its time and stays unpublished, so nothing a reader
	// sees changes.
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		q := s.queriesFor(txCtx)
		listing, err := s.lockEpisodeListingForReview(txCtx, tenant.ID, episodeID)
		if err != nil {
			return nil, err
		}
		if listing.ReviewState.String != episodeReviewInReview {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "the episode is not in review")
		}
		decider := sessionUserID(txCtx)
		round, err := q.DecideEpisodeReview(txCtx, dbmodels.DecideEpisodeReviewParams{
			Decision:        episodeReviewReturned,
			DecidedByUserID: decider,
			Comment:         comment,
			TenantID:        tenant.ID,
			EpisodeID:       episodeID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "the episode is not in review")
		}
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to return the episode review", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		if err := q.SetEpisodeListingReviewState(txCtx, dbmodels.SetEpisodeListingReviewStateParams{
			TenantID:    tenant.ID,
			EpisodeID:   episodeID,
			ReviewState: sql.NullString{String: episodeReviewReturned, Valid: true},
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the return on the episode", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		if err := s.writeEpisodeReviewAudit(txCtx, tenant.ID, "episode_review_returned", listing.EpisodePublicID); err != nil {
			return nil, err
		}
		// Whoever submitted the round is told, unless that is the person
		// returning it, who already knows; a round opened in no one's name has
		// nobody to tell.
		if !round.SubmittedByUserID.Valid || round.SubmittedByUserID == decider {
			return nil, nil
		}
		payload, err := json.Marshal(outbox.EpisodeReviewReturnedNotificationPayload{
			TenantID: tenant.ID.String(),
			ReviewID: round.ID.String(),
		})
		if err != nil {
			return nil, s.internalError(ctx, "failed to encode the episode review returned notification", err, "tenant_id", tenant.ID.String())
		}
		if err := insertAdminOutboxEvent(txCtx, q, tenant.ID, outbox.EventTypeEpisodeReviewReturnedNotification, payload, outbox.EpisodeReviewReturnedIdempotencyKey(round.ID)); err != nil {
			return nil, s.internalDBError(ctx, "failed to queue the episode review returned notification", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
		}
		return nil, nil
	}); err != nil {
		return nil, err
	}

	episode, err := s.consoleEpisode(ctx, tenant.ID, episodeID)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.ReturnEpisodeResponse{Episode: episode}, nil
}

func (s *adminServer) ListEpisodeReviews(
	ctx context.Context,
	req *publiraadminv1.ListEpisodeReviewsRequest,
) (*publiraadminv1.ListEpisodeReviewsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	episodeID, err := parseRecordID(req.EpisodeId, "episode_id")
	if err != nil {
		return nil, err
	}
	q := s.queriesFor(ctx)
	if _, err := q.GetEpisodeByIDForTenant(ctx, dbmodels.GetEpisodeByIDForTenantParams{TenantID: tenant.ID, ID: episodeID}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get episode for its reviews", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	rows, err := q.ListEpisodeReviews(ctx, dbmodels.ListEpisodeReviewsParams{TenantID: tenant.ID, EpisodeID: episodeID})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode reviews", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	rounds := make([]*publiraadminv1.EpisodeReviewRound, 0, len(rows))
	for _, row := range rows {
		state := publirattypesv1.EpisodeReviewState_EPISODE_REVIEW_STATE_IN_REVIEW
		if row.Decision.Valid {
			state, err = episodeReviewStateFromStored(row.Decision.String)
			if err != nil {
				return nil, s.internalError(ctx, "episode review holds a decision this build does not know", err, "tenant_id", tenant.ID.String(), "review_id", row.ID.String())
			}
		}
		rounds = append(rounds, &publiraadminv1.EpisodeReviewRound{
			Id:                      row.ID.String(),
			SubmittedAt:             row.SubmittedAt.UTC().Format(time.RFC3339),
			SubmittedByUserPublicId: row.SubmittedByPublicID,
			SubmittedByName:         row.SubmittedByName,
			State:                   state,
			DecidedAt:               formatOptionalTime(row.DecidedAt),
			DecidedByUserPublicId:   row.DecidedByPublicID,
			DecidedByName:           row.DecidedByName,
			Comment:                 row.Comment.String,
		})
	}
	return &publiraadminv1.ListEpisodeReviewsResponse{Rounds: rounds}, nil
}
