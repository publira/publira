package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strconv"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/contentranking"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	defaultGenrePageSize = int32(20)
	maxGenrePageSize     = int32(100)
	defaultTagPageSize   = int32(20)
	maxTagPageSize       = int32(100)
	tagInclusiveKey      = "inclusive"
	// genreFeaturedSeriesLimit fills the 2×2 mosaic a genre's tile draws.
	genreFeaturedSeriesLimit = int32(4)
)

// publishedGenreRow is one row of a genre page, shared by the ascending and
// descending keyset queries so the handler reads a single shape.
type publishedGenreRow struct {
	id                   uuid.UUID
	publicID             string
	name                 string
	slug                 string
	displayOrder         int32
	eyeCatchImageID      uuid.NullUUID
	publishedSeriesCount int32
}

func mapPublishedGenreAscRows(rows []dbmodels.ListPublishedGenresByTenantAscRow) []publishedGenreRow {
	mapped := make([]publishedGenreRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, publishedGenreRow{
			id:                   row.ID,
			publicID:             row.PublicID,
			name:                 row.Name,
			slug:                 row.Slug,
			displayOrder:         row.DisplayOrder,
			eyeCatchImageID:      row.EyeCatchImageID,
			publishedSeriesCount: row.PublishedSeriesCount,
		})
	}
	return mapped
}

func mapPublishedGenreDescRows(rows []dbmodels.ListPublishedGenresByTenantDescRow) []publishedGenreRow {
	mapped := make([]publishedGenreRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, publishedGenreRow{
			id:                   row.ID,
			publicID:             row.PublicID,
			name:                 row.Name,
			slug:                 row.Slug,
			displayOrder:         row.DisplayOrder,
			eyeCatchImageID:      row.EyeCatchImageID,
			publishedSeriesCount: row.PublishedSeriesCount,
		})
	}
	return mapped
}

// publishedGenrePage runs the keyset query for one page. The list reads in the
// tenant's own order, so a backward page is scanned by the descending query and
// put back into display order by pagination.Page.
func (s *apiServer) publishedGenrePage(
	ctx context.Context,
	tenantID uuid.UUID,
	surface string,
	keys pagination.CountUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]publishedGenreRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListPublishedGenresByTenantDesc(ctx, dbmodels.ListPublishedGenresByTenantDescParams{
			TenantID:           tenantID,
			Surface:            surface,
			CursorID:           uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
			CursorInclusive:    keys.Inclusive,
			CursorDisplayOrder: sql.NullInt32{Int32: int32(keys.Count), Valid: keys.Valid},
			Limit:              limit,
		})
		if err != nil {
			return nil, err
		}
		return mapPublishedGenreDescRows(rows), nil
	}

	rows, err := queries.ListPublishedGenresByTenantAsc(ctx, dbmodels.ListPublishedGenresByTenantAscParams{
		TenantID:           tenantID,
		Surface:            surface,
		CursorID:           uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		CursorInclusive:    keys.Inclusive,
		CursorDisplayOrder: sql.NullInt32{Int32: int32(keys.Count), Valid: keys.Valid},
		Limit:              limit,
	})
	if err != nil {
		return nil, err
	}
	return mapPublishedGenreAscRows(rows), nil
}

// genreFeaturedSeries reads the covers of a whole page of genres in one query.
// The weekly leaderboard orders them, since a daily one cut per genre is
// mostly empty and would reshuffle the tiles every day.
func (s *apiServer) genreFeaturedSeries(
	ctx context.Context,
	tenantID uuid.UUID,
	surface string,
	genres []publishedGenreRow,
) (map[uuid.UUID][]*publirav1.PublishedGenreFeaturedSeries, error) {
	if len(genres) == 0 {
		return nil, nil
	}
	genreIDs := make([]uuid.UUID, 0, len(genres))
	for _, genre := range genres {
		genreIDs = append(genreIDs, genre.id)
	}

	rows, err := s.queriesFor(ctx).ListGenreFeaturedSeries(ctx, dbmodels.ListGenreFeaturedSeriesParams{
		GenreIds:    genreIDs,
		TenantID:    tenantID,
		Surface:     surface,
		SeriesLimit: genreFeaturedSeriesLimit,
		RankingKey:  contentranking.WeeklyRankingKey,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list genre featured series", err, "tenant_id", tenantID.String())
	}

	imageIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		if row.EyeCatchImageID.Valid {
			imageIDs = append(imageIDs, row.EyeCatchImageID.UUID)
		}
	}
	variantsByImageID, err := s.seriesEyeCatchVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		// Variants decorate the tiles; a frame without them shows the title.
		slog.WarnContext(ctx, "eye catch variants unavailable", "error", err)
	}

	featured := make(map[uuid.UUID][]*publirav1.PublishedGenreFeaturedSeries, len(genres))
	for _, row := range rows {
		series := &publirav1.PublishedGenreFeaturedSeries{PublicId: row.PublicID, Title: row.Title}
		if row.EyeCatchImageID.Valid {
			series.EyeCatchImageVariants = variantsByImageID[row.EyeCatchImageID.UUID]
		}
		featured[row.GenreID] = append(featured[row.GenreID], series)
	}
	return featured, nil
}

// ListPublishedGenres hands the storefront the classification a reader browses
// by: the tenant's genres, in the order the console put them in, each with how
// many of its series are published right now.
func (s *apiServer) ListPublishedGenres(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedGenresRequest],
) (*connect.Response[publirav1.ListPublishedGenresResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	surface, err := callingSurface(req.Msg.Surface)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultGenrePageSize, maxGenrePageSize)
	cursor, err := decodeSurfaceToken(req.Msg.Token, surface)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys pagination.CountUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeCountUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
		// The count a token carries is the display_order it was built from, and
		// display_order is an int4. A client-supplied value outside that range
		// would silently wrap on the way into the query and compare against a
		// position no genre holds, so it is refused instead.
		if keys.Count < math.MinInt32 || keys.Count > math.MaxInt32 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.publishedGenrePage(ctx, tenant.ID, surface, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published genres", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	featured, err := s.genreFeaturedSeries(ctx, tenant.ID, surface, rows)
	if err != nil {
		return nil, err
	}
	imageIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		if row.eyeCatchImageID.Valid {
			imageIDs = append(imageIDs, row.eyeCatchImageID.UUID)
		}
	}
	eyeCatches, err := s.genreEyeCatchVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, err
	}

	genres := make([]*publirav1.PublishedGenre, 0, len(rows))
	for _, row := range rows {
		genre := &publirav1.PublishedGenre{
			PublicId:             row.publicID,
			Name:                 row.name,
			Slug:                 row.slug,
			PublishedSeriesCount: row.publishedSeriesCount,
			FeaturedSeries:       featured[row.id],
		}
		if row.eyeCatchImageID.Valid {
			genre.EyeCatchImageVariants = eyeCatches[row.eyeCatchImageID.UUID]
		}
		genres = append(genres, genre)
	}

	res := &publirav1.ListPublishedGenresResponse{Genres: genres}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeCountUUID(pagination.Backward, int64(rows[0].displayOrder), rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeCountUUID(pagination.Forward, int64(last.displayOrder), last.id)
		}
	// An empty page means the boundary genre was deleted, or moved by a
	// reorder, after the token was issued. Hand back a token to where the
	// client came from, and recover only once: a recovery token that also comes
	// back empty leaves both tokens empty so the client falls back to the first
	// page instead of bouncing between empty ones.
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeCountUUIDRecovery(pagination.Backward, keys.Count, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeCountUUIDRecovery(pagination.Forward, keys.Count, keys.ID)
	}

	bindSurfaceTokens(surface, &res.PreviousToken, &res.NextToken)
	return connect.NewResponse(res), nil
}

// genreEyeCatchVariantsByImageIDs fetches the variants of the given genre
// images.
func (s *apiServer) genreEyeCatchVariantsByImageIDs(
	ctx context.Context,
	imageIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	if len(imageIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}, nil
	}

	rows, err := s.queriesFor(ctx).ListGenreImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list genre image variants", err, "image_count", len(imageIDs))
	}

	mapped := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, len(imageIDs))
	for _, row := range rows {
		mapped[row.GenreImageID] = append(mapped[row.GenreImageID], &publirattypesv1.SeriesEyeCatchVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           fmt.Sprintf("/images/genres/%s/%s/%d", row.GenreImageID.String(), row.VariantType, row.Width),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
	return mapped, nil
}

// tagCursorKeys is the decoded tag cursor. A tag has no id of its own in the
// list — the slug is unique within the tenant and is what breaks a tie on the
// count — so this keyset is (count, slug) rather than the (count, uuid) pair
// pagination.CountUUIDKeys carries.
type tagCursorKeys struct {
	publishedSeriesCount sql.NullInt32
	slug                 sql.NullString
	inclusive            bool
}

func encodeTagCursor(direction pagination.Direction, count int32, slug string) string {
	return pagination.Encode(direction, strconv.FormatInt(int64(count), 10), slug)
}

// A recovery token includes the boundary once, so a tag whose neighbours were
// all let go of still comes back on the way out of an empty page.
func encodeTagRecoveryToken(direction pagination.Direction, keys tagCursorKeys) string {
	return pagination.Encode(
		direction,
		strconv.FormatInt(int64(keys.publishedSeriesCount.Int32), 10),
		keys.slug.String,
		tagInclusiveKey,
	)
}

func decodeTagCursorKeys(cursor pagination.Cursor) (tagCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 2 && len(cursor.Keys) != 3 {
		return tagCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 3
	if inclusive && cursor.Keys[2] != tagInclusiveKey {
		return tagCursorKeys{}, invalid
	}
	count, err := strconv.ParseInt(cursor.Keys[0], 10, 32)
	if err != nil {
		return tagCursorKeys{}, invalid
	}
	return tagCursorKeys{
		publishedSeriesCount: sql.NullInt32{Int32: int32(count), Valid: true},
		slug:                 sql.NullString{String: cursor.Keys[1], Valid: true},
		inclusive:            inclusive,
	}, nil
}

// publishedTagRow is one row of a tag page, shared by the two keyset queries.
type publishedTagRow struct {
	name                 string
	slug                 string
	publishedSeriesCount int32
}

// publishedTagPage runs the keyset query for one page. The list is ordered by
// how many published series carry each tag, so a backward page is scanned by
// the ascending query and put back into that order by pagination.Page.
func (s *apiServer) publishedTagPage(
	ctx context.Context,
	tenantID uuid.UUID,
	surface string,
	keys tagCursorKeys,
	direction pagination.Direction,
	limit int32,
) ([]publishedTagRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListPublishedTagsByTenantAsc(ctx, dbmodels.ListPublishedTagsByTenantAscParams{
			TenantID:                   tenantID,
			Surface:                    surface,
			CursorSlug:                 keys.slug,
			CursorPublishedSeriesCount: keys.publishedSeriesCount,
			CursorInclusive:            keys.inclusive,
			Limit:                      limit,
		})
		if err != nil {
			return nil, err
		}
		page := make([]publishedTagRow, 0, len(rows))
		for _, row := range rows {
			page = append(page, publishedTagRow{name: row.Name, slug: row.Slug, publishedSeriesCount: row.PublishedSeriesCount})
		}
		return page, nil
	}

	rows, err := queries.ListPublishedTagsByTenantDesc(ctx, dbmodels.ListPublishedTagsByTenantDescParams{
		TenantID:                   tenantID,
		Surface:                    surface,
		CursorSlug:                 keys.slug,
		CursorPublishedSeriesCount: keys.publishedSeriesCount,
		CursorInclusive:            keys.inclusive,
		Limit:                      limit,
	})
	if err != nil {
		return nil, err
	}
	page := make([]publishedTagRow, 0, len(rows))
	for _, row := range rows {
		page = append(page, publishedTagRow{name: row.Name, slug: row.Slug, publishedSeriesCount: row.PublishedSeriesCount})
	}
	return page, nil
}

// ListPublishedTags hands the storefront the tags at least one published series
// carries, the most-carried first. A tag nothing published carries is not in
// the list: it exists because a series carries it, so it has no page of its own
// to keep working.
func (s *apiServer) ListPublishedTags(
	ctx context.Context,
	req *connect.Request[publirav1.ListPublishedTagsRequest],
) (*connect.Response[publirav1.ListPublishedTagsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	surface, err := callingSurface(req.Msg.Surface)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultTagPageSize, maxTagPageSize)
	cursor, err := decodeSurfaceToken(req.Msg.Token, surface)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys tagCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeTagCursorKeys(cursor)
		if err != nil {
			return nil, err
		}
	}

	// One row past the page: its presence is what says another page exists.
	rows, err := s.publishedTagPage(ctx, tenant.ID, surface, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published tags", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	tags := make([]*publirav1.PublishedTag, 0, len(rows))
	for _, row := range rows {
		tags = append(tags, &publirav1.PublishedTag{
			Name:                 row.name,
			Slug:                 row.slug,
			PublishedSeriesCount: row.publishedSeriesCount,
		})
	}

	res := &publirav1.ListPublishedTagsResponse{Tags: tags}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeTagCursor(pagination.Backward, rows[0].publishedSeriesCount, rows[0].slug)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = encodeTagCursor(pagination.Forward, last.publishedSeriesCount, last.slug)
		}
	// An empty page means the boundary tag was let go of, or moved by a series
	// taking it up, after the token was issued. Recover once, the way the genre
	// list does.
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeTagRecoveryToken(pagination.Backward, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeTagRecoveryToken(pagination.Forward, keys)
	}

	bindSurfaceTokens(surface, &res.PreviousToken, &res.NextToken)
	return connect.NewResponse(res), nil
}
