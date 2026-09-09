package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strconv"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const (
	defaultGenrePageSize = int32(20)
	maxGenrePageSize     = int32(100)
	defaultTagPageSize   = int32(20)
	maxTagPageSize       = int32(100)
	tagInclusiveKey      = "inclusive"
)

// publishedGenreRow is one row of a genre page, shared by the ascending and
// descending keyset queries so the handler reads a single shape.
type publishedGenreRow struct {
	id                   uuid.UUID
	publicID             string
	name                 string
	slug                 string
	displayOrder         int32
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
	keys pagination.CountUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]publishedGenreRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListPublishedGenresByTenantDesc(ctx, dbmodels.ListPublishedGenresByTenantDescParams{
			TenantID:           tenantID,
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
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultGenrePageSize, maxGenrePageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
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
	rows, err := s.publishedGenrePage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list published genres", err, "tenant_id", tenant.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)

	genres := make([]*publirav1.PublishedGenre, 0, len(rows))
	for _, row := range rows {
		genres = append(genres, &publirav1.PublishedGenre{
			PublicId:             row.publicID,
			Name:                 row.name,
			Slug:                 row.slug,
			PublishedSeriesCount: row.publishedSeriesCount,
		})
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

	return connect.NewResponse(res), nil
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
	keys tagCursorKeys,
	direction pagination.Direction,
	limit int32,
) ([]publishedTagRow, error) {
	queries := s.queriesFor(ctx)
	if direction == pagination.Backward {
		rows, err := queries.ListPublishedTagsByTenantAsc(ctx, dbmodels.ListPublishedTagsByTenantAscParams{
			TenantID:                   tenantID,
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
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultTagPageSize, maxTagPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
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
	rows, err := s.publishedTagPage(ctx, tenant.ID, keys, cursor.Direction, limit+1)
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

	return connect.NewResponse(res), nil
}
