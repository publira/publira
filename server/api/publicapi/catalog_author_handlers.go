package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	defaultAuthorPageSize = int32(20)
	maxAuthorPageSize     = int32(100)
	authorInclusiveKey    = "inclusive"
)

// authorCursorKeys is the decoded cursor for ListPublishedAuthors. The list is
// name ascending, then id; a backward page scans the opposite way and is
// flipped back in pagination.Page.
type authorCursorKeys struct {
	name      sql.NullString
	id        uuid.NullUUID
	inclusive bool
}

func encodeAuthorCursor(direction pagination.Direction, row dbmodels.ListPublishedAuthorsByIDsRow) string {
	return pagination.Encode(direction, row.Name, row.ID.String())
}

func encodeAuthorRecoveryToken(direction pagination.Direction, keys authorCursorKeys) string {
	return pagination.Encode(direction, keys.name.String, keys.id.UUID.String(), authorInclusiveKey)
}

func decodeAuthorCursorKeys(cursor pagination.Cursor) (authorCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 2 && len(cursor.Keys) != 3 {
		return authorCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 3
	if inclusive && cursor.Keys[2] != authorInclusiveKey {
		return authorCursorKeys{}, invalid
	}
	authorID, err := uuid.Parse(cursor.Keys[1])
	if err != nil {
		return authorCursorKeys{}, invalid
	}
	return authorCursorKeys{
		name:      sql.NullString{String: cursor.Keys[0], Valid: true},
		id:        uuid.NullUUID{UUID: authorID, Valid: true},
		inclusive: inclusive,
	}, nil
}

func publishedAuthorFromFields(
	publicID string,
	name string,
	profileText sql.NullString,
	iconImageID uuid.NullUUID,
	iconImageFileSizeBytes int64,
	iconImageUpdatedAt sql.NullTime,
	publishedSeriesCount int32,
) *publirav1.PublishedAuthor {
	author := &publirav1.PublishedAuthor{
		PublicId:             publicID,
		Name:                 name,
		PublishedSeriesCount: publishedSeriesCount,
	}
	if profileText.Valid {
		author.ProfileText = profileText.String
	}
	if iconImageID.Valid {
		author.IconImageUrl = fmt.Sprintf("/images/creators/%s", iconImageID.UUID.String())
		author.IconImageFileSizeBytes = iconImageFileSizeBytes
	}
	if iconImageUpdatedAt.Valid {
		author.IconImageUpdatedAt = iconImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	return author
}

func publishedAuthorFromListRow(row dbmodels.ListPublishedAuthorsByIDsRow) *publirav1.PublishedAuthor {
	return publishedAuthorFromFields(
		row.PublicID,
		row.Name,
		row.ProfileText,
		row.IconImageID,
		row.IconImageFileSizeBytes,
		row.IconImageUpdatedAt,
		row.PublishedSeriesCount,
	)
}

func publishedAuthorFromDetailRow(row dbmodels.GetPublishedAuthorByPublicIDRow) *publirav1.PublishedAuthor {
	return publishedAuthorFromFields(
		row.PublicID,
		row.Name,
		row.ProfileText,
		row.IconImageID,
		row.IconImageFileSizeBytes,
		row.IconImageUpdatedAt,
		row.PublishedSeriesCount,
	)
}

func (s *apiServer) publishedAuthorPageIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	descending bool,
	keys authorCursorKeys,
	limit int32,
) ([]uuid.UUID, error) {
	queries := s.queriesFor(ctx)
	if descending {
		return queries.ListPublishedAuthorIDsByNameDesc(ctx, dbmodels.ListPublishedAuthorIDsByNameDescParams{
			TenantID:        tenantID,
			CursorName:      keys.name,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			Limit:           limit,
		})
	}
	return queries.ListPublishedAuthorIDsByNameAsc(ctx, dbmodels.ListPublishedAuthorIDsByNameAscParams{
		TenantID:        tenantID,
		CursorName:      keys.name,
		CursorID:        keys.id,
		CursorInclusive: keys.inclusive,
		Limit:           limit,
	})
}

func (s *apiServer) publishedAuthorRowsInOrder(
	ctx context.Context,
	tenantID uuid.UUID,
	ids []uuid.UUID,
) ([]dbmodels.ListPublishedAuthorsByIDsRow, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	rows, err := s.queriesFor(ctx).ListPublishedAuthorsByIDs(ctx, dbmodels.ListPublishedAuthorsByIDsParams{
		TenantID: tenantID,
		Ids:      ids,
	})
	if err != nil {
		return nil, err
	}

	byID := make(map[uuid.UUID]dbmodels.ListPublishedAuthorsByIDsRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}

	ordered := make([]dbmodels.ListPublishedAuthorsByIDsRow, 0, len(ids))
	for _, id := range ids {
		row, ok := byID[id]
		// An author whose last published series disappeared between the two
		// queries simply drops out, the same way an unpublished series does.
		if !ok || row.PublishedSeriesCount == 0 {
			continue
		}
		ordered = append(ordered, row)
	}
	return ordered, nil
}

func (s *apiServer) ListPublishedAuthors(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedAuthorsRequest],
) (*connect.Response[publirav1.ListPublishedAuthorsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultAuthorPageSize, maxAuthorPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys authorCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeAuthorCursorKeys(cursor)
		if err != nil {
			return nil, err
		}
	}
	descending := cursor.Direction == pagination.Backward
	ids, err := s.publishedAuthorPageIDs(ctx, tenant.ID, descending, keys, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published authors", err, "tenant_id", tenant.ID.String())
	}
	ids, hasMore := pagination.Page(ids, limit, cursor.Direction)
	rows, err := s.publishedAuthorRowsInOrder(ctx, tenant.ID, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published authors", err, "tenant_id", tenant.ID.String())
	}

	items := make([]*publirav1.PublishedAuthor, 0, len(rows))
	for _, row := range rows {
		items = append(items, publishedAuthorFromListRow(row))
	}

	res := &publirav1.ListPublishedAuthorsResponse{Authors: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeAuthorCursor(pagination.Backward, rows[0])
		}
		if hasNext {
			res.NextToken = encodeAuthorCursor(pagination.Forward, rows[len(rows)-1])
		}
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeAuthorRecoveryToken(pagination.Backward, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeAuthorRecoveryToken(pagination.Forward, keys)
	}
	return connect.NewResponse(res), nil
}

func (s *apiServer) GetPublishedAuthorDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetPublishedAuthorDetailRequest],
) (*connect.Response[publirav1.GetPublishedAuthorDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetPublishedAuthorByPublicID(ctx, dbmodels.GetPublishedAuthorByPublicIDParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.PublicId,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("author not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get published author", err, "tenant_id", tenant.ID.String(), "public_id", req.Msg.PublicId)
	}

	series, previousToken, nextToken, err := s.publishedAuthorSeriesPage(
		ctx,
		tenant.ID,
		row.ID,
		req.Msg.Limit,
		req.Msg.Token,
	)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publirav1.GetPublishedAuthorDetailResponse{
		Author:        publishedAuthorFromDetailRow(row),
		Series:        series,
		PreviousToken: previousToken,
		NextToken:     nextToken,
	}), nil
}

// publishedAuthorSeriesPage is the related-series half of GetPublishedAuthorDetail.
// Title ascending is the only order; the scan direction and the page direction
// fold the same way ListPublishedAuthors does.
func (s *apiServer) publishedAuthorSeriesPage(
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
		keys, err = decodeSeriesCursorKeys(cursor, order)
		if err != nil {
			return nil, "", "", err
		}
	}
	descending := cursor.Direction == pagination.Backward
	ids, err := s.publishedAuthorSeriesPageIDs(ctx, tenantID, creatorID, descending, keys, limit+1)
	if err != nil {
		return nil, "", "", s.internalDBError(ctx, "failed to list published author series", err, "tenant_id", tenantID.String(), "creator_id", creatorID.String())
	}
	ids, hasMore := pagination.Page(ids, limit, cursor.Direction)
	rows, err := s.activeSeriesRowsInOrder(ctx, tenantID, ids)
	if err != nil {
		return nil, "", "", s.internalDBError(ctx, "failed to list published author series", err, "tenant_id", tenantID.String(), "creator_id", creatorID.String())
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
			previousToken = encodeSeriesCursor(pagination.Backward, order, rows[0])
		}
		if hasNext {
			nextToken = encodeSeriesCursor(pagination.Forward, order, rows[len(rows)-1])
		}
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		previousToken = encodeSeriesRecoveryToken(pagination.Backward, order, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		nextToken = encodeSeriesRecoveryToken(pagination.Forward, order, keys)
	}
	return items, previousToken, nextToken, nil
}

func (s *apiServer) publishedAuthorSeriesPageIDs(
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
