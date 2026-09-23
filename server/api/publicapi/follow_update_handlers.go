package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	defaultFollowUpdatePageSize = int32(20)
	maxFollowUpdatePageSize     = int32(100)
)

// ListMyFollowUpdates answers what is new in what a member follows: the
// episodes that have arrived in the series and the creators they follow, most
// recently published first.
//
// The keyset scan is kept to the member's own follows and the episode columns
// a row shows; the series card beside each of them is a second query, the way
// ListMyRecentSeries builds its page. One series can carry several of the
// episodes on a page, so the cards are looked up once per series and shared by
// the rows that name it.
func (s *apiServer) ListMyFollowUpdates(
	ctx context.Context,
	req *connect.Request[publirav1.ListMyFollowUpdatesRequest],
) (*connect.Response[publirav1.ListMyFollowUpdatesResponse], error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Msg.Tenant, req.Header())
	if err != nil {
		return nil, err
	}
	surface, err := callingSurface(req.Msg.Surface)
	if err != nil {
		return nil, err
	}
	if err := s.scopeFollowUser(ctx, user.ID); err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultFollowUpdatePageSize, maxFollowUpdatePageSize)
	cursor, err := decodeSurfaceToken(req.Msg.Token, surface)
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
	rows, err := s.followUpdatePage(ctx, tenant.ID, user.ID, surface, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list follow updates", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	seriesByID, err := s.followUpdateSeriesByID(ctx, tenant.ID, surface, rows)
	if err != nil {
		return nil, err
	}

	items := make([]*publirav1.FollowUpdate, 0, len(rows))
	for _, row := range rows {
		series, ok := seriesByID[row.SeriesID]
		// Unpublished between the two queries: drop the row rather than name an
		// episode of a series the storefront no longer carries.
		if !ok {
			continue
		}
		items = append(items, &publirav1.FollowUpdate{
			Series: series,
			Episode: &publirattypesv1.Episode{
				PublicId:    row.EpisodePublicID,
				Title:       row.EpisodeTitle,
				OrderIndex:  row.EpisodeOrderIndex,
				PublishedAt: row.PublishedAt.Time.UTC().Format(time.RFC3339),
			},
		})
	}

	res := &publirav1.ListMyFollowUpdatesResponse{Updates: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			first := rows[0]
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, first.PublishedAt.Time, first.EpisodeID)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.PublishedAt.Time, last.EpisodeID)
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
	bindSurfaceTokens(surface, &res.PreviousToken, &res.NextToken)

	return noStorePrivateResponse(res), nil
}

// followUpdatePage runs the keyset scan in the direction the cursor asks for.
// The ascending query carries the previous-page direction and returns the same
// columns, so its rows are converted rather than mapped through a third type.
func (s *apiServer) followUpdatePage(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	surface string,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]dbmodels.ListMyFollowUpdatesDescRow, error) {
	queries := s.queriesFor(ctx)
	params := dbmodels.ListMyFollowUpdatesDescParams{
		TenantID:          tenantID,
		UserID:            userID,
		Surface:           surface,
		CursorPublishedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive:   keys.Inclusive,
		CursorEpisodeID:   uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:             limit,
	}
	if direction == pagination.Backward {
		ascending, err := queries.ListMyFollowUpdatesAsc(ctx, dbmodels.ListMyFollowUpdatesAscParams(params))
		if err != nil {
			return nil, err
		}
		rows := make([]dbmodels.ListMyFollowUpdatesDescRow, 0, len(ascending))
		for _, row := range ascending {
			rows = append(rows, dbmodels.ListMyFollowUpdatesDescRow(row))
		}
		return rows, nil
	}

	return queries.ListMyFollowUpdatesDesc(ctx, params)
}

// followUpdateSeriesByID loads the series card for every series the page
// names, once each, keyed by the identifier the scan rows carry.
func (s *apiServer) followUpdateSeriesByID(
	ctx context.Context,
	tenantID uuid.UUID,
	surface string,
	rows []dbmodels.ListMyFollowUpdatesDescRow,
) (map[uuid.UUID]*publirattypesv1.Series, error) {
	ids := make([]uuid.UUID, 0, len(rows))
	seen := make(map[uuid.UUID]struct{}, len(rows))
	for _, row := range rows {
		if _, ok := seen[row.SeriesID]; ok {
			continue
		}
		seen[row.SeriesID] = struct{}{}
		ids = append(ids, row.SeriesID)
	}

	seriesRows, err := s.activeSeriesRowsInOrder(ctx, tenantID, surface, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list follow update series", err, "tenant_id", tenantID.String())
	}
	seriesItems, err := s.publishedSeriesItems(ctx, seriesRows)
	if err != nil {
		return nil, err
	}

	byID := make(map[uuid.UUID]*publirattypesv1.Series, len(seriesRows))
	for i, seriesRow := range seriesRows {
		byID[seriesRow.ID] = seriesItems[i]
	}
	return byID, nil
}
