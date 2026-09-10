package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	defaultSeriesPageSize = int32(20)
	maxSeriesPageSize     = int32(100)
	defaultLabelPageSize  = int32(20)
	maxLabelPageSize      = int32(100)
	seriesInclusiveKey    = "inclusive"
	labelInclusiveKey     = "inclusive"
)

const (
	seriesOrderColumnPublishedAt     = "published_at"
	seriesOrderColumnTitle           = "title"
	seriesOrderColumnLatestEpisodeAt = "latest_episode_at"
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
	publirav1.SeriesOrder_SERIES_ORDER_LATEST_EPISODE_AT_DESC: {
		name:       "latest_episode_at_desc",
		column:     seriesOrderColumnLatestEpisodeAt,
		descending: true,
	},
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
	publishedAt     sql.NullTime
	title           sql.NullString
	latestEpisodeAt sql.NullTime
	id              uuid.NullUUID
	inclusive       bool
}

// seriesFilters is what a series list was narrowed by, beyond the tenant and
// the publication state every one of them applies. Each field is already in the
// shape the query takes, so resolving a request into this value is also where
// a genre, a tag, a status, or a weekday the tenant does not have is refused.
type seriesFilters struct {
	// Keep only the series that have a free episode at the moment of the read.
	hasFreeEpisodes bool
	// The public ID of the one genre to keep. Invalid means no genre filter.
	genrePublicID sql.NullString
	// The slug of the one tag to keep. Invalid means no tag filter.
	tagSlug sql.NullString
	// The stored serialization status to keep. Invalid means no status filter.
	status sql.NullString
	// The EXTRACT(DOW) weekday a kept series expects an episode on. Invalid
	// means no weekday filter; 0 is Sunday, which is why this is not an int32
	// with a zero that could mean either.
	weekday sql.NullInt16
}

// resolveSeriesFilters turns the request's filter fields into what the query
// takes, and refuses the ones that name nothing.
//
// A genre or tag the tenant does not have is not_found rather than an empty
// list: the storefront asked for a page that does not exist, and answering with
// zero series would show the reader an empty genre instead of the 404 a deleted
// one deserves. Reading it through the tenant also keeps a foreign genre
// indistinguishable from one that was never there.
func (s *apiServer) resolveSeriesFilters(
	ctx context.Context,
	tenantID uuid.UUID,
	req *publirav1.ListPublishedSeriesRequest,
) (seriesFilters, error) {
	filters := seriesFilters{hasFreeEpisodes: req.HasFreeEpisodes}

	if req.GenrePublicId != "" {
		if _, err := s.queriesFor(ctx).GetGenreIDByPublicIDForTenant(ctx, dbmodels.GetGenreIDByPublicIDForTenantParams{
			TenantID: tenantID,
			PublicID: req.GenrePublicId,
		}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return seriesFilters{}, connect.NewError(connect.CodeNotFound, errors.New("genre not found"))
			}
			return seriesFilters{}, s.internalDBError(ctx, "failed to resolve the genre filter", err, "tenant_id", tenantID.String())
		}
		filters.genrePublicID = sql.NullString{String: req.GenrePublicId, Valid: true}
	}

	if req.TagSlug != "" {
		if _, err := s.queriesFor(ctx).GetTagBySlugForTenant(ctx, dbmodels.GetTagBySlugForTenantParams{
			TenantID: tenantID,
			Slug:     req.TagSlug,
		}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return seriesFilters{}, connect.NewError(connect.CodeNotFound, errors.New("tag not found"))
			}
			return seriesFilters{}, s.internalDBError(ctx, "failed to resolve the tag filter", err, "tenant_id", tenantID.String())
		}
		filters.tagSlug = sql.NullString{String: req.TagSlug, Valid: true}
	}

	// An unspecified status filters nothing. It is the one place the enum's
	// zero does not mean the column's default: a list nobody narrowed holds
	// every state, where a series nobody edited is running.
	if req.Status != publirattypesv1.SeriesStatus_SERIES_STATUS_UNSPECIFIED {
		status, err := protomapper.SeriesStatusToStored(req.Status)
		if err != nil {
			return seriesFilters{}, connect.NewError(connect.CodeInvalidArgument, errors.New("status is not supported"))
		}
		filters.status = sql.NullString{String: status, Valid: true}
	}

	if req.Weekday != nil {
		weekday := req.GetWeekday()
		if weekday < 0 || weekday > 6 {
			return seriesFilters{}, connect.NewError(connect.CodeInvalidArgument, errors.New("weekday must be an EXTRACT(DOW) number from 0 to 6"))
		}
		filters.weekday = sql.NullInt16{Int16: int16(weekday), Valid: true}
	}

	return filters, nil
}

// seriesListKey names the list a token points into. A boundary row sits at
// another position once the list is filtered differently, exactly as it does
// under another order, so the filters ride in the same key as the order name
// and a list with no filter keeps the plain order name it always carried.
//
// The filters are appended in a fixed order rather than in the order the
// request happened to carry them, so the same narrowed list always names
// itself the same way.
func seriesListKey(order seriesOrder, filters seriesFilters) string {
	key := order.name
	if filters.hasFreeEpisodes {
		key += "+has_free_episodes"
	}
	if filters.genrePublicID.Valid {
		key += "+genre:" + filters.genrePublicID.String
	}
	if filters.tagSlug.Valid {
		key += "+tag:" + filters.tagSlug.String
	}
	if filters.status.Valid {
		key += "+status:" + filters.status.String
	}
	if filters.weekday.Valid {
		key += "+weekday:" + strconv.FormatInt(int64(filters.weekday.Int16), 10)
	}
	return key
}

// seriesBoundary is the row a token is built from: the display row, plus the
// sort value the keyset scan computed for it when the order has no column of
// its own. A list whose order is a column of series leaves latestEpisodeAt
// zero, because nothing reads it.
type seriesBoundary struct {
	row             dbmodels.ListActiveSeriesByIDsRow
	latestEpisodeAt time.Time
}

// The ListPublishedSeries cursor carries the list it was built for, then the
// sort keys of the query in order: the sorted column, then the id that breaks
// its ties. Token rules: proto/README.md.
func encodeSeriesCursor(
	direction pagination.Direction,
	order seriesOrder,
	filters seriesFilters,
	boundary seriesBoundary,
) string {
	var sortValue string
	switch order.column {
	case seriesOrderColumnTitle:
		sortValue = boundary.row.Title
	case seriesOrderColumnLatestEpisodeAt:
		sortValue = boundary.latestEpisodeAt.UTC().Format(time.RFC3339Nano)
	default:
		sortValue = boundary.row.PublishedAt.Time.UTC().Format(time.RFC3339Nano)
	}
	return pagination.Encode(direction, seriesListKey(order, filters), sortValue, boundary.row.ID.String())
}

// A recovery token includes the boundary once. That keeps the boundary row in
// the page when rows beyond it were deleted after the original token was issued.
func encodeSeriesRecoveryToken(direction pagination.Direction, order seriesOrder, filters seriesFilters, keys seriesCursorKeys) string {
	var sortValue string
	switch order.column {
	case seriesOrderColumnTitle:
		sortValue = keys.title.String
	case seriesOrderColumnLatestEpisodeAt:
		sortValue = keys.latestEpisodeAt.Time.UTC().Format(time.RFC3339Nano)
	default:
		sortValue = keys.publishedAt.Time.UTC().Format(time.RFC3339Nano)
	}
	return pagination.Encode(direction, seriesListKey(order, filters), sortValue, keys.id.UUID.String(), seriesInclusiveKey)
}

// decodeSeriesCursorKeys reads a token into the keyset the query compares
// against. A token built for another order or another filter is rejected
// rather than reinterpreted: its keys point into a page that does not exist in
// the requested list.
func decodeSeriesCursorKeys(cursor pagination.Cursor, order seriesOrder, filters seriesFilters) (seriesCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 3 && len(cursor.Keys) != 4 {
		return seriesCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 4
	if inclusive && cursor.Keys[3] != seriesInclusiveKey {
		return seriesCursorKeys{}, invalid
	}
	if cursor.Keys[0] != seriesListKey(order, filters) {
		return seriesCursorKeys{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token was issued for another order or filter"))
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

	at, err := time.Parse(time.RFC3339Nano, cursor.Keys[1])
	if err != nil {
		return seriesCursorKeys{}, invalid
	}
	if order.column == seriesOrderColumnLatestEpisodeAt {
		keys.latestEpisodeAt = sql.NullTime{Time: at.UTC(), Valid: true}
		return keys, nil
	}
	keys.publishedAt = sql.NullTime{Time: at.UTC(), Valid: true}

	return keys, nil
}

// activeSeriesPageRow is one row of the keyset half of a page: the series, and
// the sort value the query computed for it when the order is not a column of
// series. latestEpisodeAt is set only under the latest-update order, which is
// also the only order whose cursor cannot be rebuilt from the display row.
type activeSeriesPageRow struct {
	id              uuid.UUID
	latestEpisodeAt time.Time
}

// activeSeriesPage runs the keyset half of the page. The sort order lives in
// the query rather than in a parameter so each one reads its index in order and
// stops at LIMIT; a CASE in ORDER BY would sort the whole tenant first.
// `descending` is the direction actually scanned: the sort order and the page
// direction folded together.
func (s *apiServer) activeSeriesPage(
	ctx context.Context,
	tenantID uuid.UUID,
	order seriesOrder,
	filters seriesFilters,
	descending bool,
	keys seriesCursorKeys,
	limit int32,
) ([]activeSeriesPageRow, error) {
	queries := s.queriesFor(ctx)

	switch {
	case order.column == seriesOrderColumnLatestEpisodeAt && descending:
		rows, err := queries.ListActiveSeriesIDsByLatestEpisodeAtDesc(ctx, dbmodels.ListActiveSeriesIDsByLatestEpisodeAtDescParams{
			TenantID:              tenantID,
			HasFreeEpisodes:       filters.hasFreeEpisodes,
			GenrePublicID:         filters.genrePublicID,
			TagSlug:               filters.tagSlug,
			Status:                filters.status,
			Weekday:               filters.weekday,
			CursorLatestEpisodeAt: keys.latestEpisodeAt,
			CursorID:              keys.id,
			CursorInclusive:       keys.inclusive,
			Limit:                 limit,
		})
		if err != nil {
			return nil, err
		}
		page := make([]activeSeriesPageRow, 0, len(rows))
		for _, row := range rows {
			page = append(page, activeSeriesPageRow{id: row.ID, latestEpisodeAt: row.LatestEpisodeAt})
		}
		return page, nil
	case order.column == seriesOrderColumnLatestEpisodeAt:
		rows, err := queries.ListActiveSeriesIDsByLatestEpisodeAtAsc(ctx, dbmodels.ListActiveSeriesIDsByLatestEpisodeAtAscParams{
			TenantID:              tenantID,
			HasFreeEpisodes:       filters.hasFreeEpisodes,
			GenrePublicID:         filters.genrePublicID,
			TagSlug:               filters.tagSlug,
			Status:                filters.status,
			Weekday:               filters.weekday,
			CursorLatestEpisodeAt: keys.latestEpisodeAt,
			CursorID:              keys.id,
			CursorInclusive:       keys.inclusive,
			Limit:                 limit,
		})
		if err != nil {
			return nil, err
		}
		page := make([]activeSeriesPageRow, 0, len(rows))
		for _, row := range rows {
			page = append(page, activeSeriesPageRow{id: row.ID, latestEpisodeAt: row.LatestEpisodeAt})
		}
		return page, nil
	case order.column == seriesOrderColumnTitle && descending:
		ids, err := queries.ListActiveSeriesIDsByTitleDesc(ctx, dbmodels.ListActiveSeriesIDsByTitleDescParams{
			TenantID:        tenantID,
			HasFreeEpisodes: filters.hasFreeEpisodes,
			GenrePublicID:   filters.genrePublicID,
			TagSlug:         filters.tagSlug,
			Status:          filters.status,
			Weekday:         filters.weekday,
			CursorTitle:     keys.title,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			Limit:           limit,
		})
		return activeSeriesPageRowsFromIDs(ids), err
	case order.column == seriesOrderColumnTitle:
		ids, err := queries.ListActiveSeriesIDsByTitleAsc(ctx, dbmodels.ListActiveSeriesIDsByTitleAscParams{
			TenantID:        tenantID,
			HasFreeEpisodes: filters.hasFreeEpisodes,
			GenrePublicID:   filters.genrePublicID,
			TagSlug:         filters.tagSlug,
			Status:          filters.status,
			Weekday:         filters.weekday,
			CursorTitle:     keys.title,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			Limit:           limit,
		})
		return activeSeriesPageRowsFromIDs(ids), err
	case descending:
		ids, err := queries.ListActiveSeriesIDsByPublishedAtDesc(ctx, dbmodels.ListActiveSeriesIDsByPublishedAtDescParams{
			TenantID:          tenantID,
			HasFreeEpisodes:   filters.hasFreeEpisodes,
			GenrePublicID:     filters.genrePublicID,
			TagSlug:           filters.tagSlug,
			Status:            filters.status,
			Weekday:           filters.weekday,
			CursorPublishedAt: keys.publishedAt,
			CursorID:          keys.id,
			CursorInclusive:   keys.inclusive,
			Limit:             limit,
		})
		return activeSeriesPageRowsFromIDs(ids), err
	default:
		ids, err := queries.ListActiveSeriesIDsByPublishedAtAsc(ctx, dbmodels.ListActiveSeriesIDsByPublishedAtAscParams{
			TenantID:          tenantID,
			HasFreeEpisodes:   filters.hasFreeEpisodes,
			GenrePublicID:     filters.genrePublicID,
			TagSlug:           filters.tagSlug,
			Status:            filters.status,
			Weekday:           filters.weekday,
			CursorPublishedAt: keys.publishedAt,
			CursorID:          keys.id,
			CursorInclusive:   keys.inclusive,
			Limit:             limit,
		})
		return activeSeriesPageRowsFromIDs(ids), err
	}
}

// activeSeriesPageRowsFromIDs wraps the orders whose sort value is a column of
// series: the cursor is rebuilt from the display row, so the keyset scan hands
// back nothing but ids.
func activeSeriesPageRowsFromIDs(ids []uuid.UUID) []activeSeriesPageRow {
	page := make([]activeSeriesPageRow, 0, len(ids))
	for _, id := range ids {
		page = append(page, activeSeriesPageRow{id: id})
	}
	return page
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
	RolePublicID           string `json:"role_public_id"`
	RoleName               string `json:"role_name"`
	ProfileText            string `json:"profile_text"`
	IconImageURL           string `json:"icon_image_url"`
	IconImageFileSizeBytes int64  `json:"icon_image_file_size_bytes"`
	IconImageUpdatedAt     string `json:"icon_image_updated_at"`
}

// creatorFromJSON rebuilds one credit of a series row. The credits arrive
// already in role priority order, so nothing here reorders them.
func creatorFromJSON(creator creatorJSON) *publirattypesv1.Creator {
	mapped := &publirattypesv1.Creator{
		PublicId:               creator.PublicID,
		Name:                   creator.Name,
		ProfileText:            creator.ProfileText,
		IconImageUrl:           creator.IconImageURL,
		IconImageFileSizeBytes: creator.IconImageFileSizeBytes,
		IconImageUpdatedAt:     creator.IconImageUpdatedAt,
	}
	// A credit written before roles existed carries none: the aggregate reads
	// null for both columns, and the field stays unset rather than naming an
	// empty role.
	if creator.RolePublicID != "" {
		mapped.Role = &publirattypesv1.CreatorRole{
			PublicId: creator.RolePublicID,
			Name:     creator.RoleName,
		}
	}
	return mapped
}

type genreJSON struct {
	PublicID string `json:"public_id"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
}

type tagJSON struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// seriesGenresFromJSON and seriesTagsFromJSON read the classification the
// catalog queries collect per series. Both arrive already ordered — genres in
// the tenant's own order, tags by name — so a series presents them the same way
// wherever it is read.
func seriesGenresFromJSON(raw []byte) ([]*publirattypesv1.Genre, error) {
	rows := make([]genreJSON, 0)
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, err
		}
	}
	genres := make([]*publirattypesv1.Genre, 0, len(rows))
	for _, row := range rows {
		genres = append(genres, &publirattypesv1.Genre{PublicId: row.PublicID, Name: row.Name, Slug: row.Slug})
	}
	return genres, nil
}

func seriesTagsFromJSON(raw []byte) ([]*publirattypesv1.Tag, error) {
	rows := make([]tagJSON, 0)
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, err
		}
	}
	tags := make([]*publirattypesv1.Tag, 0, len(rows))
	for _, row := range rows {
		tags = append(tags, &publirattypesv1.Tag{Name: row.Name, Slug: row.Slug})
	}
	return tags, nil
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
	item := &publirattypesv1.Series{
		PublicId:         row.PublicID,
		Title:            row.Title,
		ScheduleWeekdays: protomapper.ScheduleWeekdaysFromStored(row.ScheduleWeekdays),
		FreeEpisodeCount: row.FreeEpisodeCount,
	}
	if row.Synopsis.Valid {
		item.Synopsis = row.Synopsis.String
	}
	if row.Status.Valid {
		status, err := protomapper.SeriesStatusFromStored(row.Status.String)
		if err != nil {
			return nil, err
		}
		item.Status = status
	}
	if row.AgeRating.Valid {
		ageRating, err := protomapper.SeriesAgeRatingFromStored(row.AgeRating.String)
		if err != nil {
			return nil, err
		}
		item.AgeRating = ageRating
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
		item.Creators = append(item.Creators, creatorFromJSON(creator))
	}
	genres, err := seriesGenresFromJSON(row.Genres)
	if err != nil {
		return nil, err
	}
	item.Genres = genres
	tags, err := seriesTagsFromJSON(row.Tags)
	if err != nil {
		return nil, err
	}
	item.Tags = tags

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

// labelDisplay is the part of a label every public list puts on the wire.
// ListPublishedLabels and SearchPublishedLabels show a label the same way and
// differ only in what they sort and page by, so the display half is shared and
// the cursor half stays with each list.
type labelDisplay struct {
	publicID               string
	name                   string
	eyeCatchImageID        uuid.NullUUID
	eyeCatchImageUpdatedAt sql.NullTime
}

type labelPageRow struct {
	labelDisplay
	id        uuid.UUID
	createdAt time.Time
}

func labelPageFromDesc(row dbmodels.ListLabelsByTenantDescRow) labelPageRow {
	return labelPageRow{
		labelDisplay: labelDisplay{
			publicID:               row.PublicID,
			name:                   row.Name,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		},
		id:        row.ID,
		createdAt: row.CreatedAt,
	}
}

func labelPageFromAsc(row dbmodels.ListLabelsByTenantAscRow) labelPageRow {
	return labelPageRow{
		labelDisplay: labelDisplay{
			publicID:               row.PublicID,
			name:                   row.Name,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		},
		id:        row.ID,
		createdAt: row.CreatedAt,
	}
}

// labelItems maps label rows to the wire type and attaches every eye catch in
// one further query, so a page of labels costs two round trips whatever
// ordered it.
func (s *apiServer) labelItems(ctx context.Context, rows []labelDisplay) ([]*publirattypesv1.Label, error) {
	items := make([]*publirattypesv1.Label, 0, len(rows))
	imageIDs := make([]uuid.UUID, 0, len(rows))
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
	if len(imageIDs) == 0 {
		return items, nil
	}

	variantsByImageID, err := s.labelEyeCatchVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, err
	}
	for index, row := range rows {
		if !row.eyeCatchImageID.Valid {
			continue
		}
		if variants, ok := variantsByImageID[row.eyeCatchImageID.UUID]; ok {
			items[index].EyeCatchImageVariants = variants
		}
	}
	return items, nil
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

	displays := make([]labelDisplay, 0, len(rows))
	for _, row := range rows {
		displays = append(displays, row.labelDisplay)
	}
	items, err := s.labelItems(ctx, displays)
	if err != nil {
		return nil, err
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
	filters, err := s.resolveSeriesFilters(ctx, tenant.ID, req.Msg)
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
		keys, err = decodeSeriesCursorKeys(cursor, order, filters)
		if err != nil {
			return nil, err
		}
	}
	// Walking back through the list runs against the sort order.
	descending := order.descending != (cursor.Direction == pagination.Backward)
	// One id past the page: its presence is what says another page exists.
	pageRows, err := s.activeSeriesPage(ctx, tenant.ID, order, filters, descending, keys, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published series", err, "tenant_id", tenant.ID.String())
	}
	pageRows, hasMore := pagination.Page(pageRows, limit, cursor.Direction)
	ids := make([]uuid.UUID, 0, len(pageRows))
	latestEpisodeAtByID := make(map[uuid.UUID]time.Time, len(pageRows))
	for _, pageRow := range pageRows {
		ids = append(ids, pageRow.id)
		latestEpisodeAtByID[pageRow.id] = pageRow.latestEpisodeAt
	}
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
			first := rows[0]
			res.PreviousToken = encodeSeriesCursor(pagination.Backward, order, filters, seriesBoundary{row: first, latestEpisodeAt: latestEpisodeAtByID[first.ID]})
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = encodeSeriesCursor(pagination.Forward, order, filters, seriesBoundary{row: last, latestEpisodeAt: latestEpisodeAtByID[last.ID]})
		}
	// An empty page means the boundary row was removed after the token was
	// issued. Hand back a token to where the client came from, so the only way
	// out is not to start over from the first page. A recovery token that comes
	// back empty means the boundary row is gone too: recover once, then leave
	// both tokens empty rather than bouncing the client between empty pages.
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeSeriesRecoveryToken(pagination.Backward, order, filters, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeSeriesRecoveryToken(pagination.Forward, order, filters, keys)
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
	genres, err := seriesGenresFromJSON(row.Genres)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	tags, err := seriesTagsFromJSON(row.Tags)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	requiredMinimumAge, err := s.requiredMinimumAgeForSeries(ctx, tenant.ID, row.AgeRating)
	if err != nil {
		return nil, s.internalError(ctx, "failed to resolve the tenant age rule for a series", err, "tenant_id", tenant.ID.String(), "public_id", req.Msg.PublicId)
	}

	res := connect.NewResponse(&publirav1.GetSeriesDetailResponse{
		RequiredMinimumAge: int32(requiredMinimumAge),
		Series: &publirattypesv1.Series{
			PublicId:         row.PublicID,
			Title:            row.Title,
			ScheduleWeekdays: protomapper.ScheduleWeekdaysFromStored(row.ScheduleWeekdays),
			FreeEpisodeCount: row.FreeEpisodeCount,
			Genres:           genres,
			Tags:             tags,
		},
		Episodes: make([]*publirattypesv1.Episode, 0, len(episodes)),
	})
	if row.Synopsis.Valid {
		res.Msg.Series.Synopsis = row.Synopsis.String
	}
	if row.Status.Valid {
		status, statusErr := protomapper.SeriesStatusFromStored(row.Status.String)
		if statusErr != nil {
			return nil, s.internalError(ctx, "series listing holds a value this build does not know", statusErr, "tenant_id", tenant.ID.String(), "public_id", req.Msg.PublicId)
		}
		res.Msg.Series.Status = status
	}
	if row.AgeRating.Valid {
		ageRating, ageRatingErr := protomapper.SeriesAgeRatingFromStored(row.AgeRating.String)
		if ageRatingErr != nil {
			return nil, s.internalError(ctx, "series listing holds a value this build does not know", ageRatingErr, "tenant_id", tenant.ID.String(), "public_id", req.Msg.PublicId)
		}
		res.Msg.Series.AgeRating = ageRating
	}
	if row.EyeCatchImageUpdatedAt.Valid {
		res.Msg.Series.EyeCatchImageUpdatedAt = row.EyeCatchImageUpdatedAt.Time.UTC().Format(time.RFC3339)
	}

	// Fill in the label.
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
		res.Msg.Series.Creators = append(res.Msg.Series.Creators, creatorFromJSON(creator))
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

	// How old this series makes a reader be, decided before anything about the
	// reader in front of it is known. It is 0 for every series the tenant's
	// rule does not cover, which is the ordinary read and costs no extra query.
	requiredMinimumAge, err := s.requiredMinimumAgeForSeries(ctx, tenant.ID, row.SeriesAgeRating)
	if err != nil {
		return nil, s.internalError(ctx, "failed to resolve the tenant age rule for a series", err, "tenant_id", tenant.ID.String(), "episode_public_id", req.Msg.PublicId)
	}

	access := publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED
	includeImages := false
	mediaToken := ""
	// A priced episode whose free window is open is as public as one that costs
	// nothing: the same query answers both, so the body, the token, and the
	// access state below follow one condition.
	freeToEveryone := row.Price == 0 || row.FreeUntil.Valid

	// The session is resolved before any of that is acted on, because the age
	// rule reads the birth date off it even for a body that costs nothing.
	var reader dbmodels.User
	hasReader := false
	if _, hasBearer := auth.BearerTokenFromHeader(req.Header()); hasBearer {
		// Optional auth: an invalid session reads as a guest. The RPC fails on
		// Internal only where the session is what gates the body — a paid
		// episode, or one the tenant's age rule covers — because a body that is
		// free and unrated must stay readable when attribution breaks.
		session, authErr := s.authenticateAccessToken(ctx, req.Msg.Tenant, req.Header())
		if authErr != nil {
			if (!freeToEveryone || requiredMinimumAge > 0) && connect.CodeOf(authErr) == connect.CodeInternal {
				return nil, authErr
			}
			// A gated body stays closed and the view stays anonymous; log for operational tracing.
			slog.InfoContext(ctx, "episode detail: bearer session rejected, continuing without it",
				"tenant_id", tenant.ID,
				"episode_public_id", req.Msg.PublicId,
				"code", connect.CodeOf(authErr).String(),
			)
		} else {
			reader = session.User
			hasReader = true
		}
	}

	// The age rule outranks the price. A reader it stops is stopped whether the
	// body is free, priced, or already bought, so it is answered first and the
	// three states below are never reached.
	clearsAgeGate, err := s.readerClearsMinimumAge(ctx, tenant, requiredMinimumAge, reader.BirthDate)
	if err != nil {
		return nil, s.internalError(ctx, "failed to check the reader against the tenant age rule", err, "tenant_id", tenant.ID.String(), "episode_public_id", req.Msg.PublicId)
	}

	switch {
	case !clearsAgeGate:
		// Withheld the way a locked body is: no images, and no token to fetch
		// them with.
		access = publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED
	case freeToEveryone:
		access = publirav1.EpisodeAccess_EPISODE_ACCESS_FREE
		includeImages = true
		token, tokenErr := s.freeBodyMediaToken(tenant, row.ID, requiredMinimumAge, reader)
		if tokenErr != nil {
			s.logger.ErrorContext(ctx, "failed to issue free episode media token",
				"tenant_id", tenant.ID.String(),
				"episode_public_id", req.Msg.PublicId,
				"error", tokenErr,
			)
			return nil, connect.NewError(connect.CodeInternal, errors.New("internal server error"))
		}
		mediaToken = token
	case hasReader:
		hasAccess, accessErr := s.queriesFor(ctx).UserHasEpisodeContentAccess(ctx, dbmodels.UserHasEpisodeContentAccessParams{
			TenantID:  tenant.ID,
			UserID:    reader.ID,
			EpisodeID: row.ID,
		})
		if accessErr != nil {
			return nil, s.internalDBError(ctx, "failed to check episode content access", accessErr, "tenant_id", tenant.ID.String(), "episode_public_id", req.Msg.PublicId)
		}
		if hasAccess.Valid && hasAccess.Bool {
			access = publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED
			includeImages = true
			// The reader fetches these images from image-server with an
			// <img>, which cannot carry the bearer this RPC was called
			// with. The token below is what makes that request identify
			// the same reader; image-server still checks the grant.
			token, _, tokenErr := s.tokens.IssueMediaToken(
				reader.PublicID,
				tenant.ID.String(),
				row.ID.String(),
				reader.CredentialsVersion,
				time.Now(),
			)
			if tokenErr != nil {
				s.logger.ErrorContext(ctx, "failed to issue episode media token",
					"tenant_id", tenant.ID.String(),
					"episode_public_id", req.Msg.PublicId,
					"error", tokenErr,
				)
				return nil, connect.NewError(connect.CodeInternal, errors.New("internal server error"))
			}
			mediaToken = token
		}
	}

	series, err := protomapper.SeriesFromGetPublishedEpisodeByPublicIDForTenantRow(row)
	if err != nil {
		return nil, s.internalError(ctx, "series listing holds a value this build does not know", err, "tenant_id", tenant.ID.String(), "episode_public_id", req.Msg.PublicId)
	}
	neighborRows, err := s.publishedEpisodeNeighborRows(ctx, tenant.ID, row)
	if err != nil {
		return nil, err
	}
	// The episode and the two links either side of it are credited in one
	// read. Every episode carries its own credits, so a series whose artist
	// changed part way through credits the next episode differently from this
	// one, and a link that named this episode's team would be wrong.
	episodeIDs := make([]uuid.UUID, 0, len(neighborRows)+1)
	episodeIDs = append(episodeIDs, row.ID)
	for _, neighborRow := range neighborRows {
		episodeIDs = append(episodeIDs, neighborRow.ID)
	}
	creditsByEpisodeID, err := s.episodeCreditsByEpisodeIDs(ctx, tenant.ID, episodeIDs)
	if err != nil {
		return nil, err
	}
	previousEpisode, nextEpisode := episodeNeighborsFromRows(neighborRows, creditsByEpisodeID)

	episode := protomapper.EpisodeFromGetPublishedEpisodeByPublicIDForTenantRow(row)
	episode.Creators = creditsByEpisodeID[row.ID]
	res := connect.NewResponse(&publirav1.GetEpisodeDetailResponse{
		Episode:         episode,
		Series:          series,
		Images:          make([]*publirattypesv1.EpisodeImage, 0),
		Access:          access,
		PreviousEpisode: previousEpisode,
		NextEpisode:     nextEpisode,
	})
	if row.FreeUntil.Valid {
		res.Msg.FreeUntil = row.FreeUntil.Time.UTC().Format(time.RFC3339)
	}
	if includeImages {
		images, listErr := s.queriesFor(ctx).ListEpisodeImagesByEpisodeID(ctx, row.ID)
		if listErr != nil {
			return nil, s.internalDBError(ctx, "failed to list episode images", listErr, "tenant_id", tenant.ID.String(), "episode_public_id", req.Msg.PublicId)
		}
		res.Msg.Images = make([]*publirattypesv1.EpisodeImage, 0, len(images))
		for _, image := range images {
			mapped := protomapper.EpisodeImageFromEpisodeImage(image)
			mapped.ImageUrl = auth.WithMediaTokenQuery(mapped.ImageUrl, mediaToken)
			res.Msg.Images = append(res.Msg.Images, mapped)
		}
	}

	return res, nil
}

// publishedEpisodeNeighborRows reads the published episodes either side of the
// given one in its series. A missing side is a missing row, so the result
// holds none, one, or two.
//
// It is a read of its own rather than more columns on the episode row, because
// each side is found by comparing against that row's own (order_index, id):
// the episode has to be in hand before the episodes around it can be asked
// for.
func (s *apiServer) publishedEpisodeNeighborRows(
	ctx context.Context,
	tenantID uuid.UUID,
	row dbmodels.GetPublishedEpisodeByPublicIDForTenantRow,
) ([]dbmodels.ListPublishedEpisodeNeighborsForTenantRow, error) {
	rows, err := s.queriesFor(ctx).ListPublishedEpisodeNeighborsForTenant(ctx, dbmodels.ListPublishedEpisodeNeighborsForTenantParams{
		TenantID:   tenantID,
		SeriesID:   row.SeriesID,
		OrderIndex: row.OrderIndex,
		EpisodeID:  row.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode neighbors", err, "tenant_id", tenantID.String(), "episode_public_id", row.PublicID)
	}
	return rows, nil
}

// episodeNeighborsFromRows puts the neighbour rows into the shape the response
// carries them in: nil where the series ends.
func episodeNeighborsFromRows(
	rows []dbmodels.ListPublishedEpisodeNeighborsForTenantRow,
	creditsByEpisodeID map[uuid.UUID][]*publirattypesv1.Creator,
) (previous, next *publirav1.EpisodeNeighbor) {
	for _, neighbor := range rows {
		mapped := &publirav1.EpisodeNeighbor{
			PublicId:   neighbor.PublicID,
			Title:      neighbor.Title,
			OrderIndex: neighbor.OrderIndex,
			Price:      neighbor.Price,
			IsFree:     neighbor.IsFree.Valid && neighbor.IsFree.Bool,
			Creators:   creditsByEpisodeID[neighbor.ID],
		}
		if neighbor.Direction < 0 {
			previous = mapped
			continue
		}
		next = mapped
	}

	return previous, next
}

// episodeCreditsByEpisodeIDs reads the credits of the given episodes, grouped
// by the episode they are on. Nothing falls back to the series: an episode
// answers with the credits it carries, which is what the bake at creation
// writes and what an edit on the episode changes.
func (s *apiServer) episodeCreditsByEpisodeIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	episodeIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.Creator, error) {
	if len(episodeIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.Creator{}, nil
	}
	rows, err := s.queriesFor(ctx).ListEpisodeCreatorsByEpisodeIDs(ctx, episodeIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list episode credits", err, "tenant_id", tenantID.String())
	}
	return protomapper.EpisodeCreditsByEpisodeID(rows), nil
}

// labelEyeCatchVariantsByImageIDs fetches the variants of the given label
// images.
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
