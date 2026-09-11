package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	defaultCreatorPageSize = int32(20)
	maxCreatorPageSize     = int32(100)
	creatorInclusiveKey    = "inclusive"
)

// creatorCursorKeys is the decoded cursor for ListPublishedCreators. The list is
// name ascending, then id; a backward page scans the opposite way and is
// flipped back in pagination.Page.
type creatorCursorKeys struct {
	name      sql.NullString
	id        uuid.NullUUID
	inclusive bool
}

func encodeCreatorCursor(direction pagination.Direction, row dbmodels.ListPublishedCreatorsByIDsRow) string {
	return pagination.Encode(direction, row.Name, row.ID.String())
}

func encodeCreatorRecoveryToken(direction pagination.Direction, keys creatorCursorKeys) string {
	return pagination.Encode(direction, keys.name.String, keys.id.UUID.String(), creatorInclusiveKey)
}

func decodeCreatorCursorKeys(cursor pagination.Cursor) (creatorCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 2 && len(cursor.Keys) != 3 {
		return creatorCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 3
	if inclusive && cursor.Keys[2] != creatorInclusiveKey {
		return creatorCursorKeys{}, invalid
	}
	creatorRowID, err := uuid.Parse(cursor.Keys[1])
	if err != nil {
		return creatorCursorKeys{}, invalid
	}
	return creatorCursorKeys{
		name:      sql.NullString{String: cursor.Keys[0], Valid: true},
		id:        uuid.NullUUID{UUID: creatorRowID, Valid: true},
		inclusive: inclusive,
	}, nil
}

func publishedCreatorFromFields(
	publicID string,
	name string,
	profileText sql.NullString,
	iconImageID uuid.NullUUID,
	iconImageFileSizeBytes int64,
	iconImageUpdatedAt sql.NullTime,
	publishedSeriesCount int32,
) *publirav1.PublishedCreator {
	creator := &publirav1.PublishedCreator{
		PublicId:             publicID,
		Name:                 name,
		PublishedSeriesCount: publishedSeriesCount,
	}
	if profileText.Valid {
		creator.ProfileText = profileText.String
	}
	if iconImageID.Valid {
		creator.IconImageUrl = fmt.Sprintf("/images/creators/%s", iconImageID.UUID.String())
		creator.IconImageFileSizeBytes = iconImageFileSizeBytes
	}
	if iconImageUpdatedAt.Valid {
		creator.IconImageUpdatedAt = iconImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	return creator
}

func publishedCreatorFromListRow(row dbmodels.ListPublishedCreatorsByIDsRow) *publirav1.PublishedCreator {
	return publishedCreatorFromFields(
		row.PublicID,
		row.Name,
		row.ProfileText,
		row.IconImageID,
		row.IconImageFileSizeBytes,
		row.IconImageUpdatedAt,
		row.PublishedSeriesCount,
	)
}

func publishedCreatorFromDetailRow(row dbmodels.GetPublishedCreatorByPublicIDRow) *publirav1.PublishedCreator {
	return publishedCreatorFromFields(
		row.PublicID,
		row.Name,
		row.ProfileText,
		row.IconImageID,
		row.IconImageFileSizeBytes,
		row.IconImageUpdatedAt,
		row.PublishedSeriesCount,
	)
}

func (s *apiServer) publishedCreatorPageIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	descending bool,
	keys creatorCursorKeys,
	limit int32,
) ([]uuid.UUID, error) {
	queries := s.queriesFor(ctx)
	if descending {
		return queries.ListPublishedCreatorIDsByNameDesc(ctx, dbmodels.ListPublishedCreatorIDsByNameDescParams{
			TenantID:        tenantID,
			CursorName:      keys.name,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			Limit:           limit,
		})
	}
	return queries.ListPublishedCreatorIDsByNameAsc(ctx, dbmodels.ListPublishedCreatorIDsByNameAscParams{
		TenantID:        tenantID,
		CursorName:      keys.name,
		CursorID:        keys.id,
		CursorInclusive: keys.inclusive,
		Limit:           limit,
	})
}

func (s *apiServer) publishedCreatorRowsInOrder(
	ctx context.Context,
	tenantID uuid.UUID,
	ids []uuid.UUID,
) ([]dbmodels.ListPublishedCreatorsByIDsRow, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	rows, err := s.queriesFor(ctx).ListPublishedCreatorsByIDs(ctx, dbmodels.ListPublishedCreatorsByIDsParams{
		TenantID: tenantID,
		Ids:      ids,
	})
	if err != nil {
		return nil, err
	}

	byID := make(map[uuid.UUID]dbmodels.ListPublishedCreatorsByIDsRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}

	ordered := make([]dbmodels.ListPublishedCreatorsByIDsRow, 0, len(ids))
	for _, id := range ids {
		row, ok := byID[id]
		// A creator whose last published series disappeared between the two
		// queries simply drops out, the same way an unpublished series does.
		if !ok || row.PublishedSeriesCount == 0 {
			continue
		}
		ordered = append(ordered, row)
	}
	return ordered, nil
}

func (s *apiServer) ListPublishedCreators(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedCreatorsRequest],
) (*connect.Response[publirav1.ListPublishedCreatorsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultCreatorPageSize, maxCreatorPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys creatorCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeCreatorCursorKeys(cursor)
		if err != nil {
			return nil, err
		}
	}
	descending := cursor.Direction == pagination.Backward
	ids, err := s.publishedCreatorPageIDs(ctx, tenant.ID, descending, keys, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published creators", err, "tenant_id", tenant.ID.String())
	}
	ids, hasMore := pagination.Page(ids, limit, cursor.Direction)
	rows, err := s.publishedCreatorRowsInOrder(ctx, tenant.ID, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published creators", err, "tenant_id", tenant.ID.String())
	}

	items := make([]*publirav1.PublishedCreator, 0, len(rows))
	for _, row := range rows {
		items = append(items, publishedCreatorFromListRow(row))
	}

	res := &publirav1.ListPublishedCreatorsResponse{Creators: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeCreatorCursor(pagination.Backward, rows[0])
		}
		if hasNext {
			res.NextToken = encodeCreatorCursor(pagination.Forward, rows[len(rows)-1])
		}
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeCreatorRecoveryToken(pagination.Backward, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeCreatorRecoveryToken(pagination.Forward, keys)
	}
	return connect.NewResponse(res), nil
}

func (s *apiServer) GetPublishedCreatorDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetPublishedCreatorDetailRequest],
) (*connect.Response[publirav1.GetPublishedCreatorDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetPublishedCreatorByPublicID(ctx, dbmodels.GetPublishedCreatorByPublicIDParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.PublicId,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("creator not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get published creator", err, "tenant_id", tenant.ID.String(), "public_id", req.Msg.PublicId)
	}

	series, previousToken, nextToken, err := s.publishedCreatorSeriesPage(
		ctx,
		tenant.ID,
		row.ID,
		req.Msg.Limit,
		req.Msg.Token,
	)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publirav1.GetPublishedCreatorDetailResponse{
		Creator:       publishedCreatorFromDetailRow(row),
		Series:        series,
		PreviousToken: previousToken,
		NextToken:     nextToken,
	}), nil
}

// publishedCreatorSeriesPage is the related-series half of GetPublishedCreatorDetail.
// Title ascending is the only order; the scan direction and the page direction
// fold the same way ListPublishedCreators does.
func (s *apiServer) publishedCreatorSeriesPage(
	ctx context.Context,
	tenantID uuid.UUID,
	creatorID uuid.UUID,
	requestedLimit int32,
	token string,
) ([]*publirattypesv1.Series, string, string, error) {
	order := seriesOrders[publirav1.SeriesOrder_SERIES_ORDER_TITLE_ASC]
	limit := pagination.NormalizeLimit(requestedLimit, defaultSeriesPageSize, maxSeriesPageSize)
	cursor, err := pagination.Decode(token)
	if err != nil {
		return nil, "", "", connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys seriesCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeSeriesCursorKeys(cursor, order, seriesFilters{})
		if err != nil {
			return nil, "", "", err
		}
	}
	descending := cursor.Direction == pagination.Backward
	ids, err := s.publishedCreatorSeriesPageIDs(ctx, tenantID, creatorID, descending, keys, limit+1)
	if err != nil {
		return nil, "", "", s.internalDBError(ctx, "failed to list published creator series", err, "tenant_id", tenantID.String(), "creator_id", creatorID.String())
	}
	ids, hasMore := pagination.Page(ids, limit, cursor.Direction)
	rows, err := s.activeSeriesRowsInOrder(ctx, tenantID, ids)
	if err != nil {
		return nil, "", "", s.internalDBError(ctx, "failed to list published creator series", err, "tenant_id", tenantID.String(), "creator_id", creatorID.String())
	}
	items, err := s.publishedSeriesItems(ctx, rows)
	if err != nil {
		return nil, "", "", err
	}

	var previousToken, nextToken string
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			previousToken = encodeSeriesCursor(pagination.Backward, order, seriesFilters{}, seriesBoundary{row: rows[0]})
		}
		if hasNext {
			nextToken = encodeSeriesCursor(pagination.Forward, order, seriesFilters{}, seriesBoundary{row: rows[len(rows)-1]})
		}
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		previousToken = encodeSeriesRecoveryToken(pagination.Backward, order, seriesFilters{}, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		nextToken = encodeSeriesRecoveryToken(pagination.Forward, order, seriesFilters{}, keys)
	}
	return items, previousToken, nextToken, nil
}

func (s *apiServer) publishedCreatorSeriesPageIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	creatorID uuid.UUID,
	descending bool,
	keys seriesCursorKeys,
	limit int32,
) ([]uuid.UUID, error) {
	queries := s.queriesFor(ctx)
	if descending {
		return queries.ListPublishedSeriesIDsByCreatorTitleDesc(ctx, dbmodels.ListPublishedSeriesIDsByCreatorTitleDescParams{
			CreatorID:       creatorID,
			TenantID:        tenantID,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			CursorTitle:     keys.title,
			Limit:           limit,
		})
	}
	return queries.ListPublishedSeriesIDsByCreatorTitleAsc(ctx, dbmodels.ListPublishedSeriesIDsByCreatorTitleAscParams{
		CreatorID:       creatorID,
		TenantID:        tenantID,
		CursorID:        keys.id,
		CursorInclusive: keys.inclusive,
		CursorTitle:     keys.title,
		Limit:           limit,
	})
}
