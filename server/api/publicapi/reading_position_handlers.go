package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

// SaveReadingPosition stores where the authenticated member stopped inside an
// episode. The write query repeats the publication and paid-body checks, so a
// viewer saving on its way out cannot record a position in an episode that was
// unpublished or a rental that has expired while it was open.
func (s *apiServer) SaveReadingPosition(
	ctx context.Context,
	req *connect.Request[publirav1.SaveReadingPositionRequest],
) (*connect.Response[publirav1.SaveReadingPositionResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	publicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode public id is required"))
	}
	if err := s.scopeEpisodeReadUser(ctx, user.ID); err != nil {
		return nil, err
	}

	row, err := s.queriesFor(ctx).SaveEpisodeReadingPosition(ctx, dbmodels.SaveEpisodeReadingPositionParams{
		TenantID:        tenant.ID,
		UserID:          user.ID,
		EpisodePublicID: publicID,
		PageIndex:       req.Msg.PageIndex,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// Publication, tenant, and entitlement failures share one response for
		// the reason MarkEpisodeAsRead gives them one: this member cannot probe
		// for episode IDs they are not allowed to see.
		return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to save reading position", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	// The episode is readable and only the page was refused, so the count it
	// was measured against is the member's own to see.
	if !row.PageIndex.Valid {
		if row.EpisodePageCount == 0 {
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("episode has no pages"))
		}
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("page index must be between 0 and %d", row.EpisodePageCount-1))
	}

	return noStorePrivateResponse(&publirav1.SaveReadingPositionResponse{
		Position: &publirav1.ReadingPosition{
			EpisodePublicId: publicID,
			PageIndex:       row.PageIndex.Int32,
			PageCount:       row.PageCount.Int32,
			UpdatedAt:       row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano),
		},
	}), nil
}

// GetMyReadingPosition returns where the authenticated member stopped in one
// episode. An episode they may no longer read answers like one they never
// opened: the viewer starts at page 1 either way, and the empty answer tells
// them nothing about what the tenant holds.
func (s *apiServer) GetMyReadingPosition(
	ctx context.Context,
	req *connect.Request[publirav1.GetMyReadingPositionRequest],
) (*connect.Response[publirav1.GetMyReadingPositionResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	publicID := strings.TrimSpace(req.Msg.EpisodePublicId)
	if publicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("episode public id is required"))
	}
	if err := s.scopeEpisodeReadUser(ctx, user.ID); err != nil {
		return nil, err
	}

	row, err := s.queriesFor(ctx).GetMyEpisodeReadingPosition(ctx, dbmodels.GetMyEpisodeReadingPositionParams{
		TenantID:        tenant.ID,
		UserID:          user.ID,
		EpisodePublicID: publicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return noStorePrivateResponse(&publirav1.GetMyReadingPositionResponse{}), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get reading position", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	return noStorePrivateResponse(&publirav1.GetMyReadingPositionResponse{
		Position: &publirav1.ReadingPosition{
			EpisodePublicId: publicID,
			PageIndex:       row.PageIndex,
			PageCount:       row.PageCount,
			UpdatedAt:       row.UpdatedAt.UTC().Format(time.RFC3339Nano),
		},
	}), nil
}

// GetMySeriesProgress answers what the series page needs to offer the member a
// way back in: the episode they moved in most recently, where they stopped in
// it, and whether they already finished it. It is its own RPC so GetSeriesDetail
// keeps returning the same bytes to everyone and stays shared-cacheable.
func (s *apiServer) GetMySeriesProgress(
	ctx context.Context,
	req *connect.Request[publirav1.GetMySeriesProgressRequest],
) (*connect.Response[publirav1.GetMySeriesProgressResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	seriesPublicID := strings.TrimSpace(req.Msg.SeriesPublicId)
	if seriesPublicID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("series public id is required"))
	}
	if err := s.scopeEpisodeReadUser(ctx, user.ID); err != nil {
		return nil, err
	}

	row, err := s.queriesFor(ctx).GetMySeriesReadingProgress(ctx, dbmodels.GetMySeriesReadingProgressParams{
		TenantID:       tenant.ID,
		UserID:         user.ID,
		SeriesPublicID: seriesPublicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return noStorePrivateResponse(&publirav1.GetMySeriesProgressResponse{}), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get series reading progress", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	return noStorePrivateResponse(&publirav1.GetMySeriesProgressResponse{
		Progress: &publirav1.SeriesProgress{
			Episode: protomapper.EpisodeFromGetMySeriesReadingProgressRow(row),
			Position: &publirav1.ReadingPosition{
				EpisodePublicId: row.EpisodePublicID,
				PageIndex:       row.PageIndex,
				PageCount:       row.PageCount,
				UpdatedAt:       row.UpdatedAt.UTC().Format(time.RFC3339Nano),
			},
			IsFinished: row.IsFinished,
		},
	}), nil
}
