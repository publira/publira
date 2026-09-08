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

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	defaultRecentSeriesPageSize = int32(20)
	maxRecentSeriesPageSize     = int32(100)
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

// GetMySeriesProgress answers everything the series page shows about this one
// member: the episode they moved in most recently with where they stopped in
// it, and which episodes of the series they have already finished. It is its
// own RPC so GetSeriesDetail keeps returning the same bytes to everyone and
// stays shared-cacheable.
//
// The finished episodes are read separately from the progress row because they
// come from a different write: MarkEpisodeAsRead stores a completion, while the
// progress row is the position SaveReadingPosition stores, so a member can have
// finished episodes and no position at all.
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

	finished, err := s.queriesFor(ctx).ListMyFinishedEpisodePublicIDsInSeries(ctx, dbmodels.ListMyFinishedEpisodePublicIDsInSeriesParams{
		TenantID:       tenant.ID,
		UserID:         user.ID,
		SeriesPublicID: seriesPublicID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list finished episodes of the series", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	res := &publirav1.GetMySeriesProgressResponse{FinishedEpisodePublicIds: finished}

	row, err := s.queriesFor(ctx).GetMySeriesReadingProgress(ctx, dbmodels.GetMySeriesReadingProgressParams{
		TenantID:       tenant.ID,
		UserID:         user.ID,
		SeriesPublicID: seriesPublicID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return noStorePrivateResponse(res), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get series reading progress", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}

	res.Progress = &publirav1.SeriesProgress{
		Episode: protomapper.EpisodeFromGetMySeriesReadingProgressRow(row),
		Position: &publirav1.ReadingPosition{
			EpisodePublicId: row.EpisodePublicID,
			PageIndex:       row.PageIndex,
			PageCount:       row.PageCount,
			UpdatedAt:       row.UpdatedAt.UTC().Format(time.RFC3339Nano),
		},
		IsFinished: row.IsFinished,
	}
	return noStorePrivateResponse(res), nil
}

// ListMyRecentSeries answers what a "continue reading" row shows: the series
// the authenticated member was in the middle of, newest activity first, each
// with the episode to open and the page to open it at.
//
// The keyset scan is kept to the reader's own history and the identifiers it
// settles on; the series display data is a second query, the way every other
// paginated series list here is built.
func (s *apiServer) ListMyRecentSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListMyRecentSeriesRequest],
) (*connect.Response[publirav1.ListMyRecentSeriesResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	if err := s.scopeEpisodeReadUser(ctx, user.ID); err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultRecentSeriesPageSize, maxRecentSeriesPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.recentSeriesPage(ctx, tenant.ID, user.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list recent series", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	ids := make([]uuid.UUID, 0, len(rows))
	rowBySeriesID := make(map[uuid.UUID]dbmodels.ListMyRecentSeriesDescRow, len(rows))
	for _, row := range rows {
		ids = append(ids, row.SeriesID)
		rowBySeriesID[row.SeriesID] = row
	}
	seriesRows, err := s.activeSeriesRowsInOrder(ctx, tenant.ID, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list recent series", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	seriesItems, err := s.publishedSeriesItems(ctx, seriesRows)
	if err != nil {
		return nil, err
	}
	items := make([]*publirav1.RecentSeries, 0, len(seriesItems))
	for i, seriesRow := range seriesRows {
		items = append(items, recentSeriesFromRow(seriesItems[i], rowBySeriesID[seriesRow.ID]))
	}

	res := &publirav1.ListMyRecentSeriesResponse{Series: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			first := rows[0]
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, first.LastActivityAt, first.SeriesID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.LastActivityAt, last.SeriesID)
		}
	// An empty page means the boundary row moved after the token was issued.
	// Hand back a token to where the client came from, and only once: a
	// recovery token that comes back empty means the boundary is gone too, so
	// both tokens stay empty rather than bouncing between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return noStorePrivateResponse(res), nil
}

// recentSeriesPage runs the keyset scan in the direction the cursor asks for.
// The ascending query carries the previous-page direction and returns the same
// columns, so its rows are converted rather than mapped through a third type.
func (s *apiServer) recentSeriesPage(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]dbmodels.ListMyRecentSeriesDescRow, error) {
	queries := s.queriesFor(ctx)
	params := dbmodels.ListMyRecentSeriesDescParams{
		TenantID:             tenantID,
		UserID:               userID,
		CursorLastActivityAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive:      keys.Inclusive,
		CursorSeriesID:       uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:                limit,
	}
	if direction == pagination.Backward {
		ascending, err := queries.ListMyRecentSeriesAsc(ctx, dbmodels.ListMyRecentSeriesAscParams(params))
		if err != nil {
			return nil, err
		}
		rows := make([]dbmodels.ListMyRecentSeriesDescRow, 0, len(ascending))
		for _, row := range ascending {
			rows = append(rows, dbmodels.ListMyRecentSeriesDescRow(row))
		}
		return rows, nil
	}

	return queries.ListMyRecentSeriesDesc(ctx, params)
}

func recentSeriesFromRow(series *publirattypesv1.Series, row dbmodels.ListMyRecentSeriesDescRow) *publirav1.RecentSeries {
	item := &publirav1.RecentSeries{
		Series:         series,
		Episode:        protomapper.EpisodeFromListMyRecentSeriesRow(row),
		LastActivityAt: row.LastActivityAt.UTC().Format(time.RFC3339Nano),
	}
	// The position is joined only when the reader can still open the body, so
	// an episode they have yet to buy is offered without one.
	if row.PositionUpdatedAt.Valid {
		item.Position = &publirav1.ReadingPosition{
			EpisodePublicId: row.EpisodePublicID,
			PageIndex:       row.PageIndex.Int32,
			PageCount:       row.PageCount.Int32,
			UpdatedAt:       row.PositionUpdatedAt.Time.UTC().Format(time.RFC3339Nano),
		}
	}
	return item
}
