package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	defaultSeriesPageSize = int32(20)
	maxSeriesPageSize     = int32(100)
	defaultLabelPageSize  = int32(20)
	maxLabelPageSize      = int32(100)
	seriesInclusiveKey    = "inclusive"
)

const (
	seriesOrderColumnPublishedAt = "published_at"
	seriesOrderColumnTitle       = "title"
)

// seriesOrder is a SeriesOrder resolved into what the query needs: the column
// to sort by, and whether the list runs down or up that column.
type seriesOrder struct {
	name       string
	column     string
	descending bool
}

var seriesOrders = map[publirav1.SeriesOrder]seriesOrder{
	publirav1.SeriesOrder_SERIES_ORDER_UNSPECIFIED:       {name: "published_at_desc", column: seriesOrderColumnPublishedAt, descending: true},
	publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_DESC: {name: "published_at_desc", column: seriesOrderColumnPublishedAt, descending: true},
	publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_ASC:  {name: "published_at_asc", column: seriesOrderColumnPublishedAt},
	publirav1.SeriesOrder_SERIES_ORDER_TITLE_ASC:         {name: "title_asc", column: seriesOrderColumnTitle},
	publirav1.SeriesOrder_SERIES_ORDER_TITLE_DESC:        {name: "title_desc", column: seriesOrderColumnTitle, descending: true},
}

func resolveSeriesOrder(requested publirav1.SeriesOrder) (seriesOrder, error) {
	order, ok := seriesOrders[requested]
	if !ok {
		return seriesOrder{}, connect.NewError(connect.CodeInvalidArgument, errors.New("order is not supported"))
	}
	return order, nil
}

// seriesCursorKeys is the decoded cursor, in the shape the keyset queries take.
type seriesCursorKeys struct {
	publishedAt sql.NullTime
	title       sql.NullString
	id          uuid.NullUUID
	inclusive   bool
}

// The ListPublishedSeries cursor carries the order it was built for, then the
// sort keys of the query in order: the sorted column, then the id that breaks
// its ties. Token rules: proto/README.md.
func encodeSeriesCursor(direction pagination.Direction, order seriesOrder, row dbmodels.ListActiveSeriesByIDsRow) string {
	sortValue := row.Title
	if order.column == seriesOrderColumnPublishedAt {
		sortValue = row.PublishedAt.Time.UTC().Format(time.RFC3339Nano)
	}
	return pagination.Encode(direction, order.name, sortValue, row.ID.String())
}

// A recovery token includes the boundary once. That keeps the boundary row in
// the page when rows beyond it were deleted after the original token was issued.
func encodeSeriesRecoveryToken(direction pagination.Direction, order seriesOrder, keys seriesCursorKeys) string {
	sortValue := keys.title.String
	if order.column == seriesOrderColumnPublishedAt {
		sortValue = keys.publishedAt.Time.UTC().Format(time.RFC3339Nano)
	}
	return pagination.Encode(direction, order.name, sortValue, keys.id.UUID.String(), seriesInclusiveKey)
}

// decodeSeriesCursorKeys reads a token into the keyset the query compares
// against. A token built for another order is rejected rather than
// reinterpreted: its keys point into a page that does not exist in the
// requested order.
func decodeSeriesCursorKeys(cursor pagination.Cursor, order seriesOrder) (seriesCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 3 && len(cursor.Keys) != 4 {
		return seriesCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 4
	if inclusive && cursor.Keys[3] != seriesInclusiveKey {
		return seriesCursorKeys{}, invalid
	}
	if cursor.Keys[0] != order.name {
		return seriesCursorKeys{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token was issued for another order"))
	}

	seriesID, err := uuid.Parse(cursor.Keys[2])
	if err != nil {
		return seriesCursorKeys{}, invalid
	}
	keys := seriesCursorKeys{id: uuid.NullUUID{UUID: seriesID, Valid: true}, inclusive: inclusive}

	if order.column == seriesOrderColumnTitle {
		keys.title = sql.NullString{String: cursor.Keys[1], Valid: true}
		return keys, nil
	}

	publishedAt, err := time.Parse(time.RFC3339Nano, cursor.Keys[1])
	if err != nil {
		return seriesCursorKeys{}, invalid
	}
	keys.publishedAt = sql.NullTime{Time: publishedAt.UTC(), Valid: true}

	return keys, nil
}

// activeSeriesPageIDs runs the keyset half of the page. The sort order lives in
// the query rather than in a parameter so each one reads its index in order and
// stops at LIMIT; a CASE in ORDER BY would sort the whole tenant first.
// `descending` is the direction actually scanned: the sort order and the page
// direction folded together.
func (s *apiServer) activeSeriesPageIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	order seriesOrder,
	descending bool,
	keys seriesCursorKeys,
	limit int32,
) ([]uuid.UUID, error) {
	queries := s.queriesFor(ctx)

	switch {
	case order.column == seriesOrderColumnTitle && descending:
		return queries.ListActiveSeriesIDsByTitleDesc(ctx, dbmodels.ListActiveSeriesIDsByTitleDescParams{
			TenantID:        tenantID,
			CursorTitle:     keys.title,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			Limit:           limit,
		})
	case order.column == seriesOrderColumnTitle:
		return queries.ListActiveSeriesIDsByTitleAsc(ctx, dbmodels.ListActiveSeriesIDsByTitleAscParams{
			TenantID:        tenantID,
			CursorTitle:     keys.title,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			Limit:           limit,
		})
	case descending:
		return queries.ListActiveSeriesIDsByPublishedAtDesc(ctx, dbmodels.ListActiveSeriesIDsByPublishedAtDescParams{
			TenantID:          tenantID,
			CursorPublishedAt: keys.publishedAt,
			CursorID:          keys.id,
			CursorInclusive:   keys.inclusive,
			Limit:             limit,
		})
	default:
		return queries.ListActiveSeriesIDsByPublishedAtAsc(ctx, dbmodels.ListActiveSeriesIDsByPublishedAtAscParams{
			TenantID:          tenantID,
			CursorPublishedAt: keys.publishedAt,
			CursorID:          keys.id,
			CursorInclusive:   keys.inclusive,
			Limit:             limit,
		})
	}
}

// activeSeriesRowsInOrder fetches the display rows for a page and puts them back
// in the order the keyset query decided; the detail query is unordered.
func (s *apiServer) activeSeriesRowsInOrder(
	ctx context.Context,
	tenantID uuid.UUID,
	ids []uuid.UUID,
) ([]dbmodels.ListActiveSeriesByIDsRow, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	rows, err := s.queriesFor(ctx).ListActiveSeriesByIDs(ctx, dbmodels.ListActiveSeriesByIDsParams{
		TenantID: tenantID,
		Ids:      ids,
	})
	if err != nil {
		return nil, err
	}

	byID := make(map[uuid.UUID]dbmodels.ListActiveSeriesByIDsRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}

	ordered := make([]dbmodels.ListActiveSeriesByIDsRow, 0, len(ids))
	for _, id := range ids {
		// A series unpublished between the two queries simply drops out.
		if row, ok := byID[id]; ok {
			ordered = append(ordered, row)
		}
	}

	return ordered, nil
}

type creatorJSON struct {
	PublicID               string `json:"public_id"`
	Name                   string `json:"name"`
	Role                   string `json:"role"`
	ProfileText            string `json:"profile_text"`
	IconImageURL           string `json:"icon_image_url"`
	IconImageFileSizeBytes int64  `json:"icon_image_file_size_bytes"`
	IconImageUpdatedAt     string `json:"icon_image_updated_at"`
}

type episodeJSON struct {
	PublicID           string  `json:"public_id"`
	Title              string  `json:"title"`
	OrderIndex         int32   `json:"order_index"`
	Price              int32   `json:"price"`
	ReadingPeriodHours *int32  `json:"reading_period_hours"`
	Status             string  `json:"status"`
	ScheduledAt        *string `json:"scheduled_at"`
	PublishedAt        *string `json:"published_at"`
}

func publishedSeriesFromRow(row dbmodels.ListActiveSeriesByIDsRow) (*publirattypesv1.Series, error) {
	item := &publirattypesv1.Series{PublicId: row.PublicID, Title: row.Title}
	if row.Synopsis.Valid {
		item.Synopsis = row.Synopsis.String
	}
	if row.EyeCatchImageUpdatedAt.Valid {
		item.EyeCatchImageUpdatedAt = row.EyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	creators := make([]creatorJSON, 0)
	if len(row.Creators) > 0 {
		if err := json.Unmarshal(row.Creators, &creators); err != nil {
			return nil, err
		}
	}
	item.Creators = make([]*publirattypesv1.Creator, 0, len(creators))
	for _, creator := range creators {
		item.Creators = append(item.Creators, &publirattypesv1.Creator{
			PublicId:               creator.PublicID,
			Name:                   creator.Name,
			Role:                   creator.Role,
			ProfileText:            creator.ProfileText,
			IconImageUrl:           creator.IconImageURL,
			IconImageFileSizeBytes: creator.IconImageFileSizeBytes,
			IconImageUpdatedAt:     creator.IconImageUpdatedAt,
		})
	}

	if len(row.LabelInfo) > 0 && string(row.LabelInfo) != "{}" {
		var labelInfo map[string]any
		if err := json.Unmarshal(row.LabelInfo, &labelInfo); err == nil {
			if publicIDVal, ok := labelInfo["public_id"].(string); ok {
				label := &publirattypesv1.Label{
					PublicId: publicIDVal,
				}
				if nameVal, ok := labelInfo["name"].(string); ok {
					label.Name = nameVal
				}
				if eyeCatchImageUpdatedAtVal, ok := labelInfo["eye_catch_image_updated_at"].(string); ok {
					label.EyeCatchImageUpdatedAt = eyeCatchImageUpdatedAtVal
				}
				item.Label = label
			}
		}
	}

	return item, nil
}

func (s *apiServer) publishedSeriesItems(
	ctx context.Context,
	rows []dbmodels.ListActiveSeriesByIDsRow,
) ([]*publirattypesv1.Series, error) {
	items := make([]*publirattypesv1.Series, 0, len(rows))
	imageIDs := make([]uuid.UUID, 0)
	for _, row := range rows {
		item, err := publishedSeriesFromRow(row)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if row.EyeCatchImageID.Valid {
			imageIDs = append(imageIDs, row.EyeCatchImageID.UUID)
		}
		items = append(items, item)
	}
	if len(imageIDs) == 0 {
		return items, nil
	}

	variantsByImageID, err := s.seriesEyeCatchVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		// Variants decorate the series; the page itself is still usable.
		slog.WarnContext(ctx, "eye catch variants unavailable", "error", err)
		return items, nil
	}
	for i, row := range rows {
		if row.EyeCatchImageID.Valid {
			if variants, ok := variantsByImageID[row.EyeCatchImageID.UUID]; ok {
				items[i].EyeCatchImageVariants = variants
			}
		}
	}
	return items, nil
}

func mapSeriesEyeCatchVariants(seriesImageID uuid.UUID, rows []dbmodels.ListSeriesImageVariantsByImageIDsRow) []*publirattypesv1.SeriesEyeCatchVariant {
	items := make([]*publirattypesv1.SeriesEyeCatchVariant, 0, len(rows))
	for _, row := range rows {
		items = append(items, &publirattypesv1.SeriesEyeCatchVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           fmt.Sprintf("/images/series/%s/%s/%d", seriesImageID.String(), row.VariantType, row.Width),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
	return items
}

func (s *apiServer) seriesEyeCatchVariantsByImageIDs(
	ctx context.Context,
	imageIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	if len(imageIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}, nil
	}

	rows, err := s.queriesFor(ctx).ListSeriesImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list series image variants", err, "image_count", len(imageIDs))
	}

	byImageID := make(map[uuid.UUID][]dbmodels.ListSeriesImageVariantsByImageIDsRow, len(imageIDs))
	for _, row := range rows {
		byImageID[row.SeriesImageID] = append(byImageID[row.SeriesImageID], row)
	}

	mapped := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, len(byImageID))
	for imageID, variants := range byImageID {
		mapped[imageID] = mapSeriesEyeCatchVariants(imageID, variants)
	}

	return mapped, nil
}

type labelPageRow struct {
	id                     uuid.UUID
	publicID               string
	name                   string
	createdAt              time.Time
	eyeCatchImageID        uuid.NullUUID
	eyeCatchImageUpdatedAt sql.NullTime
}

func labelPageFromDesc(row dbmodels.ListLabelsByTenantDescRow) labelPageRow {
	return labelPageRow{
		id:                     row.ID,
		publicID:               row.PublicID,
		name:                   row.Name,
		createdAt:              row.CreatedAt,
		eyeCatchImageID:        row.EyeCatchImageID,
		eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
	}
}

func labelPageFromAsc(row dbmodels.ListLabelsByTenantAscRow) labelPageRow {
	return labelPageRow{
		id:                     row.ID,
		publicID:               row.PublicID,
		name:                   row.Name,
		createdAt:              row.CreatedAt,
		eyeCatchImageID:        row.EyeCatchImageID,
		eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
	}
}

func toLabelPage[T any](rows []T, convert func(T) labelPageRow) []labelPageRow {
	page := make([]labelPageRow, len(rows))
	for index, row := range rows {
		page[index] = convert(row)
	}
	return page
}

func (s *apiServer) labelPage(
	ctx context.Context,
	tenantID uuid.UUID,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]labelPageRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListLabelsByTenantAsc(ctx, dbmodels.ListLabelsByTenantAscParams{
			TenantID:        tenantID,
			CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive: keys.Inclusive,
			CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}

		return toLabelPage(rows, labelPageFromAsc), nil
	}

	rows, err := queries.ListLabelsByTenantDesc(ctx, dbmodels.ListLabelsByTenantDescParams{
		TenantID:        tenantID,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}

	return toLabelPage(rows, labelPageFromDesc), nil
}

func (s *apiServer) ListPublishedLabels(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedLabelsRequest],
) (*connect.Response[publirav1.ListPublishedLabelsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultLabelPageSize, maxLabelPageSize)
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

	rows, err := s.labelPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published labels", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	items := make([]*publirattypesv1.Label, 0, len(rows))
	imageIDs := make([]uuid.UUID, 0)
	for _, row := range rows {
		item := &publirattypesv1.Label{PublicId: row.publicID, Name: row.name}
		if row.eyeCatchImageUpdatedAt.Valid {
			item.EyeCatchImageUpdatedAt = row.eyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
		}
		if row.eyeCatchImageID.Valid {
			imageIDs = append(imageIDs, row.eyeCatchImageID.UUID)
		}
		items = append(items, item)
	}

	// ラベル画像バリアント情報を取得
	if len(imageIDs) > 0 {
		variantsByImageID, variantsErr := s.labelEyeCatchVariantsByImageIDs(ctx, imageIDs)
		if variantsErr != nil {
			return nil, variantsErr
		}
		for i, row := range rows {
			if row.eyeCatchImageID.Valid {
				if variants, ok := variantsByImageID[row.eyeCatchImageID.UUID]; ok {
					items[i].EyeCatchImageVariants = variants
				}
			}
		}
	}

	res := &publirav1.ListPublishedLabelsResponse{Labels: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].createdAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}

	return connect.NewResponse(res), nil
}

func (s *apiServer) ListPublishedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedSeriesRequest],
) (*connect.Response[publirav1.ListPublishedSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	order, err := resolveSeriesOrder(req.Msg.Order)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultSeriesPageSize, maxSeriesPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys seriesCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeSeriesCursorKeys(cursor, order)
		if err != nil {
			return nil, err
		}
	}
	// Walking back through the list runs against the sort order.
	descending := order.descending != (cursor.Direction == pagination.Backward)
	// One id past the page: its presence is what says another page exists.
	ids, err := s.activeSeriesPageIDs(ctx, tenant.ID, order, descending, keys, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published series", err, "tenant_id", tenant.ID.String())
	}
	ids, hasMore := pagination.Page(ids, limit, cursor.Direction)
	rows, err := s.activeSeriesRowsInOrder(ctx, tenant.ID, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published series", err, "tenant_id", tenant.ID.String())
	}
	items, err := s.publishedSeriesItems(ctx, rows)
	if err != nil {
		return nil, err
	}

	res := &publirav1.ListPublishedSeriesResponse{Series: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeSeriesCursor(pagination.Backward, order, rows[0])
		}
		if hasNext {
			res.NextToken = encodeSeriesCursor(pagination.Forward, order, rows[len(rows)-1])
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeSeriesRecoveryToken(pagination.Backward, order, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeSeriesRecoveryToken(pagination.Forward, order, keys)
	}
	return connect.NewResponse(res), nil
}

func (s *apiServer) GetSeriesDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetSeriesDetailRequest],
) (*connect.Response[publirav1.GetSeriesDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetSeriesDetail(ctx, dbmodels.GetSeriesDetailParams{PublicID: req.Msg.PublicId, TenantID: tenant.ID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("series not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get series detail", err, "tenant_id", tenant.ID.String(), "public_id", req.Msg.PublicId)
	}
	if !row.IsPublished || !row.PublishedAt.Valid || row.PublishedAt.Time.After(time.Now()) {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("series is not published"))
	}

	creators := make([]creatorJSON, 0)
	if len(row.Creators) > 0 {
		if err := json.Unmarshal(row.Creators, &creators); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	episodes := make([]episodeJSON, 0)
	if len(row.Episodes) > 0 {
		if err := json.Unmarshal(row.Episodes, &episodes); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	res := connect.NewResponse(&publirav1.GetSeriesDetailResponse{
		Series:   &publirattypesv1.Series{PublicId: row.PublicID, Title: row.Title},
		Episodes: make([]*publirattypesv1.Episode, 0, len(episodes)),
	})
	if row.Synopsis.Valid {
		res.Msg.Series.Synopsis = row.Synopsis.String
	}
	if row.EyeCatchImageUpdatedAt.Valid {
		res.Msg.Series.EyeCatchImageUpdatedAt = row.EyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}

	// ラベル情報を処理
	if row.LabelPublicID.Valid && row.LabelName.Valid {
		label := &publirattypesv1.Label{
			PublicId: row.LabelPublicID.String,
			Name:     row.LabelName.String,
		}

		res.Msg.Series.Label = label
	}
	if row.EyeCatchImageID.Valid {
		variants, err := s.seriesEyeCatchVariantsByImageIDs(ctx, []uuid.UUID{row.EyeCatchImageID.UUID})
		if err == nil && len(variants) > 0 {
			if imageVariants, ok := variants[row.EyeCatchImageID.UUID]; ok {
				res.Msg.Series.EyeCatchImageVariants = imageVariants
			}
		}
	}

	res.Msg.Series.Creators = make([]*publirattypesv1.Creator, 0, len(creators))
	for _, creator := range creators {
		res.Msg.Series.Creators = append(res.Msg.Series.Creators, &publirattypesv1.Creator{
			PublicId:               creator.PublicID,
			Name:                   creator.Name,
			Role:                   creator.Role,
			ProfileText:            creator.ProfileText,
			IconImageUrl:           creator.IconImageURL,
			IconImageFileSizeBytes: creator.IconImageFileSizeBytes,
			IconImageUpdatedAt:     creator.IconImageUpdatedAt,
		})
	}
	for _, episode := range episodes {
		item := &publirattypesv1.Episode{
			PublicId:   episode.PublicID,
			Title:      episode.Title,
			OrderIndex: episode.OrderIndex,
			Price:      episode.Price,
			Status:     episode.Status,
		}
		if episode.ReadingPeriodHours != nil {
			item.ReadingPeriodHours = *episode.ReadingPeriodHours
		}
		if episode.ScheduledAt != nil {
			item.ScheduledAt = *episode.ScheduledAt
		}
		if episode.PublishedAt != nil {
			item.PublishedAt = *episode.PublishedAt
		}
		res.Msg.Episodes = append(res.Msg.Episodes, item)
	}
	return res, nil
}

func (s *apiServer) GetEpisodeDetail(
	ctx context.Context,
	req *connect.Request[publirav1.GetEpisodeDetailRequest],
) (*connect.Response[publirav1.GetEpisodeDetailResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetPublishedEpisodeByPublicIDForTenant(ctx, dbmodels.GetPublishedEpisodeByPublicIDForTenantParams{TenantID: tenant.ID, PublicID: req.Msg.PublicId})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("episode not found"))
		}
		return nil, s.internalDBError(ctx, "failed to get episode detail", err, "tenant_id", tenant.ID.String(), "public_id", req.Msg.PublicId)
	}

	access := publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED
	includeImages := false
	if row.Price == 0 {
		access = publirav1.EpisodeAccess_EPISODE_ACCESS_FREE
		includeImages = true
	} else if _, hasBearer := auth.BearerTokenFromHeader(req.Header()); hasBearer {
		// Optional auth: invalid session stays locked; only Internal errors fail the RPC.
		session, authErr := s.authenticateAccessToken(ctx, req.Msg.Tenant, req.Header())
		if authErr != nil {
			if connect.CodeOf(authErr) == connect.CodeInternal {
				return nil, authErr
			}
			// Invalid/expired sessions are treated as locked; log for operational tracing.
			slog.InfoContext(ctx, "episode detail: bearer session rejected, treating as locked",
				"tenant_id", tenant.ID,
				"episode_public_id", req.Msg.PublicId,
				"code", connect.CodeOf(authErr).String(),
			)
		} else {
			hasAccess, accessErr := s.queriesFor(ctx).UserHasEpisodeContentAccess(ctx, dbmodels.UserHasEpisodeContentAccessParams{
				TenantID:  tenant.ID,
				UserID:    session.User.ID,
				EpisodeID: row.ID,
			})
			if accessErr != nil {
				return nil, s.internalDBError(ctx, "failed to check episode content access", accessErr, "tenant_id", tenant.ID.String(), "episode_public_id", req.Msg.PublicId)
			}
			if hasAccess.Valid && hasAccess.Bool {
				access = publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED
				includeImages = true
			}
		}
	}

	res := connect.NewResponse(&publirav1.GetEpisodeDetailResponse{
		Episode: protomapper.EpisodeFromGetPublishedEpisodeByPublicIDForTenantRow(row),
		Series:  protomapper.SeriesFromGetPublishedEpisodeByPublicIDForTenantRow(row),
		Images:  make([]*publirattypesv1.EpisodeImage, 0),
		Access:  access,
	})
	if includeImages {
		images, listErr := s.queriesFor(ctx).ListEpisodeImagesByEpisodeID(ctx, row.ID)
		if listErr != nil {
			return nil, s.internalDBError(ctx, "failed to list episode images", listErr, "tenant_id", tenant.ID.String(), "episode_public_id", req.Msg.PublicId)
		}
		res.Msg.Images = make([]*publirattypesv1.EpisodeImage, 0, len(images))
		for _, image := range images {
			res.Msg.Images = append(res.Msg.Images, protomapper.EpisodeImageFromEpisodeImage(image))
		}
	}

	return res, nil
}

// labelEyeCatchVariantsByImageIDs ラベル画像IDのリストからバリアント情報を取得する
func (s *apiServer) labelEyeCatchVariantsByImageIDs(
	ctx context.Context,
	imageIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	if len(imageIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}, nil
	}

	rows, err := s.queriesFor(ctx).ListLabelImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list label image variants", err, "image_count", len(imageIDs))
	}

	byImageID := make(map[uuid.UUID][]dbmodels.ListLabelImageVariantsByImageIDsRow, len(imageIDs))
	for _, row := range rows {
		byImageID[row.LabelImageID] = append(byImageID[row.LabelImageID], row)
	}

	mapped := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, len(byImageID))
	for imageID, variants := range byImageID {
		items := make([]*publirattypesv1.SeriesEyeCatchVariant, 0, len(variants))
		for _, row := range variants {
			items = append(items, &publirattypesv1.SeriesEyeCatchVariant{
				Label:         row.Label,
				VariantType:   row.VariantType,
				Url:           fmt.Sprintf("/images/labels/%s/%s/%d", imageID.String(), row.VariantType, row.Width),
				ContentType:   row.ContentType,
				Width:         row.Width,
				Height:        row.Height,
				FileSizeBytes: row.FileSizeBytes,
			})
		}
		mapped[imageID] = items
	}

	return mapped, nil
}
