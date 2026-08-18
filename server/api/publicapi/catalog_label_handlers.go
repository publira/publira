package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/pagination"
)

func publishedLabelFromRow(row dbmodels.GetPublishedLabelByPublicIDRow) *publirav1.PublishedLabel {
	label := &publirav1.PublishedLabel{
		PublicId:             row.PublicID,
		Name:                 row.Name,
		PublishedSeriesCount: row.PublishedSeriesCount,
	}
	if row.EyeCatchImageUpdatedAt.Valid {
		label.EyeCatchImageUpdatedAt = row.EyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	return label
}

func (s *apiServer) GetPublishedLabelDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetPublishedLabelDetailRequest],
) (*connect.Response[publirav1.GetPublishedLabelDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetPublishedLabelByPublicID(ctx, dbmodels.GetPublishedLabelByPublicIDParams{
		TenantID: tenant.ID,
		PublicID: req.Msg.PublicId,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("label not found"))
		}
		return nil, s.internalDBError("failed to get published label", err, "tenant_id", tenant.ID.String(), "public_id", req.Msg.PublicId)
	}

	label := publishedLabelFromRow(row)
	if row.EyeCatchImageID.Valid {
		variants, variantErr := s.labelEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{row.EyeCatchImageID.UUID})
		if variantErr == nil {
			if imageVariants, ok := variants[row.EyeCatchImageID.UUID]; ok {
				label.EyeCatchImageVariants = imageVariants
			}
		}
	}

	series, previousToken, nextToken, err := s.publishedLabelSeriesPage(
		ctx,
		tenant.ID,
		row.ID,
		req.Msg.Limit,
		req.Msg.Token,
	)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publirav1.GetPublishedLabelDetailResponse{
		Label:         label,
		Series:        series,
		PreviousToken: previousToken,
		NextToken:     nextToken,
	}), nil
}

// publishedLabelSeriesPage is the related-series half of GetPublishedLabelDetail.
// Title ascending is the only order; the scan direction and the page direction
// fold the same way GetPublishedAuthorDetail does.
func (s *apiServer) publishedLabelSeriesPage(
	ctx context.Context,
	tenantID uuid.UUID,
	labelID uuid.UUID,
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
	ids, err := s.publishedLabelSeriesPageIDs(ctx, tenantID, labelID, descending, keys, limit+1)
	if err != nil {
		return nil, "", "", s.internalDBError("failed to list published label series", err, "tenant_id", tenantID.String(), "label_id", labelID.String())
	}
	ids, hasMore := pagination.Page(ids, limit, cursor.Direction)
	rows, err := s.activeSeriesRowsInOrder(ctx, tenantID, ids)
	if err != nil {
		return nil, "", "", s.internalDBError("failed to list published label series", err, "tenant_id", tenantID.String(), "label_id", labelID.String())
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

func (s *apiServer) publishedLabelSeriesPageIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	labelID uuid.UUID,
	descending bool,
	keys seriesCursorKeys,
	limit int32,
) ([]uuid.UUID, error) {
	queries := s.queriesFor(ctx)
	if descending {
		return queries.ListPublishedSeriesIDsByLabelTitleDesc(ctx, dbmodels.ListPublishedSeriesIDsByLabelTitleDescParams{
			LabelID:         labelID,
			TenantID:        tenantID,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			CursorTitle:     keys.title,
			Limit:           limit,
		})
	}
	return queries.ListPublishedSeriesIDsByLabelTitleAsc(ctx, dbmodels.ListPublishedSeriesIDsByLabelTitleAscParams{
		LabelID:         labelID,
		TenantID:        tenantID,
		CursorID:        keys.id,
		CursorInclusive: keys.inclusive,
		CursorTitle:     keys.title,
		Limit:           limit,
	})
}
