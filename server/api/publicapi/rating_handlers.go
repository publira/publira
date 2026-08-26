package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	// The stored column carries the same bounds as a CHECK constraint. Rejecting
	// here as well keeps the client-facing failure an invalid_argument instead of
	// an internal error from a constraint violation.
	minRatingScore = 1
	maxRatingScore = 5
)

// resolvedRatingTarget is what content_events needs to file a rating: the
// series it belongs to, and the episode when the rating is about one episode
// rather than the whole series. Both come from the server's own catalog row.
type resolvedRatingTarget struct {
	seriesID  uuid.UUID
	episodeID uuid.NullUUID
}

// resolveRatingTarget mirrors resolveFollowTarget: every member-facing RPC that
// acts on a catalog entity starts from the public query, so a foreign,
// unpublished, or missing target is NotFound before anything is written.
func (s *apiServer) resolveRatingTarget(
	ctx context.Context,
	tenantID uuid.UUID,
	target *publirav1.RatingTarget,
) (resolvedRatingTarget, error) {
	if target == nil || strings.TrimSpace(target.PublicId) == "" {
		return resolvedRatingTarget{}, connect.NewError(connect.CodeInvalidArgument, errors.New("target is required"))
	}
	publicID := strings.TrimSpace(target.PublicId)

	queries := s.queriesFor(ctx)
	switch target.Type {
	case publirav1.RatingTargetType_RATING_TARGET_TYPE_SERIES:
		seriesID, err := queries.GetPublishedSeriesIDByPublicID(ctx, dbmodels.GetPublishedSeriesIDByPublicIDParams{
			TenantID: tenantID,
			PublicID: publicID,
		})
		if err == nil {
			return resolvedRatingTarget{seriesID: seriesID}, nil
		}
		if errors.Is(err, sql.ErrNoRows) {
			return resolvedRatingTarget{}, connect.NewError(connect.CodeNotFound, errors.New("target not found"))
		}
		return resolvedRatingTarget{}, s.internalDBError(ctx, "failed to get rating series target", err, "tenant_id", tenantID.String())
	case publirav1.RatingTargetType_RATING_TARGET_TYPE_EPISODE:
		row, err := queries.GetPublishedEpisodeByPublicIDForTenant(ctx, dbmodels.GetPublishedEpisodeByPublicIDForTenantParams{
			TenantID: tenantID,
			PublicID: publicID,
		})
		if err == nil {
			// series_id comes from the episode row, so an episode rating can only
			// ever be filed under the series that episode actually belongs to.
			return resolvedRatingTarget{
				seriesID:  row.SeriesID,
				episodeID: uuid.NullUUID{UUID: row.ID, Valid: true},
			}, nil
		}
		if errors.Is(err, sql.ErrNoRows) {
			return resolvedRatingTarget{}, connect.NewError(connect.CodeNotFound, errors.New("target not found"))
		}
		return resolvedRatingTarget{}, s.internalDBError(ctx, "failed to get rating episode target", err, "tenant_id", tenantID.String())
	default:
		return resolvedRatingTarget{}, connect.NewError(connect.CodeInvalidArgument, errors.New("target type is invalid"))
	}
}

// validateRatingScore narrows the wire's int32 to the smallint the column
// holds. The unset 0 fails the same way an out-of-range score does: there is no
// "no opinion" rating, and a member who wants to take a rating back has nothing
// to send here.
func validateRatingScore(score int32) (int16, error) {
	if score < minRatingScore || score > maxRatingScore {
		return 0, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("score must be between %d and %d", minRatingScore, maxRatingScore))
	}
	return int16(score), nil
}

// RateContent appends one rating event for the authenticated member. It never
// updates or deletes an earlier one: re-rating leaves both events in place and
// aggregation decides which counts, so the sequence a member went through stays
// readable in content_events (see ListLatestContentRatingsByEntity).
//
// Unlike the soft PV instrumentation, a failure here is reported. A rating is
// something the member asked for, so silently dropping it would show them a
// success for a score that was never recorded.
func (s *apiServer) RateContent(
	ctx context.Context,
	req *connect.Request[publirav1.RateContentRequest],
) (*connect.Response[publirav1.RateContentResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	// Validated before the target is resolved, so a malformed score cannot be
	// used to probe which public IDs exist.
	score, err := validateRatingScore(req.Msg.Score)
	if err != nil {
		return nil, err
	}
	target, err := s.resolveRatingTarget(ctx, tenant.ID, req.Msg.Target)
	if err != nil {
		return nil, err
	}

	eventID, err := uuid.NewV7()
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to allocate rating event id", err, "tenant_id", tenant.ID.String())
	}
	row, err := s.queriesFor(ctx).InsertRatingEvent(ctx, dbmodels.InsertRatingEventParams{
		ID:          eventID,
		TenantID:    tenant.ID,
		UserID:      user.ID,
		SeriesID:    target.seriesID,
		EpisodeID:   target.episodeID,
		RatingScore: score,
		OccurredAt:  time.Now().UTC(),
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to insert rating event", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	return noStorePrivateResponse(&publirav1.RateContentResponse{
		Score:   int32(row.RatingScore.Int16),
		RatedAt: row.OccurredAt.UTC().Format(time.RFC3339),
	}), nil
}
