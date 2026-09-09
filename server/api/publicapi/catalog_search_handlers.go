package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

const maxSearchQueryRunes = 100

// normalizeSearchQuery trims the keyword and rejects empty / oversized input
// before it reaches SQL. 100 runes is enough for a storefront search box and
// keeps the token (which carries the query) from growing without bound.
func normalizeSearchQuery(raw string) (string, error) {
	query := strings.TrimSpace(raw)
	if query == "" {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("query is required"))
	}
	if utf8.RuneCountInString(query) > maxSearchQueryRunes {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("query is too long"))
	}
	return query, nil
}

// searchQueryKey is the identity of a search for both the cursor token and
// the ILIKE pattern. A token issued for "Seed" must still work with "seed"
// because both become the same key and the same '%seed%' pattern.
// strings.ToLower is that shared identity. It is not PostgreSQL's locale-
// aware ILIKE folding, and the API does not restrict queries to ASCII.
func searchQueryKey(query string) string {
	return strings.ToLower(query)
}

// ilikeContainsPattern wraps the keyword as '%q%' and escapes ILIKE
// metacharacters so a user typing % or _ cannot widen the match. The escape
// character is '!', matching ESCAPE '!' on ListPublishedSeriesIDsBySearch*.
func ilikeContainsPattern(query string) string {
	escaped := strings.NewReplacer(
		"!", "!!",
		"%", "!%",
		"_", "!_",
	).Replace(query)
	return "%" + escaped + "%"
}

// searchBoundary is the row a search token names: the query it was issued for,
// then the text its list is ordered by and the UUID tiebreaker. Every search
// token has this shape, so the searches decode it once and differ only in the
// keys struct they fill.
type searchBoundary struct {
	sortKey   string
	id        uuid.UUID
	inclusive bool
}

// A token from another query is rejected rather than reinterpreted: its keys
// point into a page that does not exist under the new query. Token rules:
// proto/README.md.
func decodeSearchBoundary(cursor pagination.Cursor, query string, inclusiveKey string) (searchBoundary, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 3 && len(cursor.Keys) != 4 {
		return searchBoundary{}, invalid
	}
	inclusive := len(cursor.Keys) == 4
	if inclusive && cursor.Keys[3] != inclusiveKey {
		return searchBoundary{}, invalid
	}
	if cursor.Keys[0] != searchQueryKey(query) {
		return searchBoundary{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token was issued for another query"))
	}
	id, err := uuid.Parse(cursor.Keys[2])
	if err != nil {
		return searchBoundary{}, invalid
	}
	return searchBoundary{sortKey: cursor.Keys[1], id: id, inclusive: inclusive}, nil
}

// The SearchPublishedSeries cursor carries the query it was built for, then
// the title + id sort keys.
func encodeSearchCursor(direction pagination.Direction, query string, row dbmodels.ListActiveSeriesByIDsRow) string {
	return pagination.Encode(direction, searchQueryKey(query), row.Title, row.ID.String())
}

func encodeSearchRecoveryToken(direction pagination.Direction, query string, keys seriesCursorKeys) string {
	return pagination.Encode(direction, searchQueryKey(query), keys.title.String, keys.id.UUID.String(), seriesInclusiveKey)
}

func decodeSearchCursorKeys(cursor pagination.Cursor, query string) (seriesCursorKeys, error) {
	boundary, err := decodeSearchBoundary(cursor, query, seriesInclusiveKey)
	if err != nil {
		return seriesCursorKeys{}, err
	}
	return seriesCursorKeys{
		title:     sql.NullString{String: boundary.sortKey, Valid: true},
		id:        uuid.NullUUID{UUID: boundary.id, Valid: true},
		inclusive: boundary.inclusive,
	}, nil
}

func (s *apiServer) publishedSearchSeriesPageIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	queryPattern string,
	descending bool,
	keys seriesCursorKeys,
	limit int32,
) ([]uuid.UUID, error) {
	queries := s.queriesFor(ctx)
	if descending {
		return queries.ListPublishedSeriesIDsBySearchTitleDesc(ctx, dbmodels.ListPublishedSeriesIDsBySearchTitleDescParams{
			TenantID:        tenantID,
			QueryPattern:    queryPattern,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			CursorTitle:     keys.title,
			Limit:           limit,
		})
	}
	return queries.ListPublishedSeriesIDsBySearchTitleAsc(ctx, dbmodels.ListPublishedSeriesIDsBySearchTitleAscParams{
		TenantID:        tenantID,
		QueryPattern:    queryPattern,
		CursorID:        keys.id,
		CursorInclusive: keys.inclusive,
		CursorTitle:     keys.title,
		Limit:           limit,
	})
}

func (s *apiServer) SearchPublishedSeries(
	ctx context.Context,
	req *connect.Request[publirav1.SearchPublishedSeriesRequest],
) (*connect.Response[publirav1.SearchPublishedSeriesResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	query, err := normalizeSearchQuery(req.Msg.Query)
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
		keys, err = decodeSearchCursorKeys(cursor, query)
		if err != nil {
			return nil, err
		}
	}
	descending := cursor.Direction == pagination.Backward
	ids, err := s.publishedSearchSeriesPageIDs(ctx, tenant.ID, ilikeContainsPattern(searchQueryKey(query)), descending, keys, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to search published series", err, "tenant_id", tenant.ID.String())
	}
	ids, hasMore := pagination.Page(ids, limit, cursor.Direction)
	rows, err := s.activeSeriesRowsInOrder(ctx, tenant.ID, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to search published series", err, "tenant_id", tenant.ID.String())
	}
	items, err := s.publishedSeriesItems(ctx, rows)
	if err != nil {
		return nil, err
	}

	res := &publirav1.SearchPublishedSeriesResponse{Series: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeSearchCursor(pagination.Backward, query, rows[0])
		}
		if hasNext {
			res.NextToken = encodeSearchCursor(pagination.Forward, query, rows[len(rows)-1])
		}
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeSearchRecoveryToken(pagination.Backward, query, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeSearchRecoveryToken(pagination.Forward, query, keys)
	}
	return connect.NewResponse(res), nil
}

// The SearchPublishedAuthors cursor carries the query it was built for, then
// the name + id sort keys ListPublishedAuthors orders by.
func encodeSearchAuthorCursor(direction pagination.Direction, query string, row dbmodels.ListPublishedAuthorsByIDsRow) string {
	return pagination.Encode(direction, searchQueryKey(query), row.Name, row.ID.String())
}

func encodeSearchAuthorRecoveryToken(direction pagination.Direction, query string, keys authorCursorKeys) string {
	return pagination.Encode(direction, searchQueryKey(query), keys.name.String, keys.id.UUID.String(), authorInclusiveKey)
}

func decodeSearchAuthorCursorKeys(cursor pagination.Cursor, query string) (authorCursorKeys, error) {
	boundary, err := decodeSearchBoundary(cursor, query, authorInclusiveKey)
	if err != nil {
		return authorCursorKeys{}, err
	}
	return authorCursorKeys{
		name:      sql.NullString{String: boundary.sortKey, Valid: true},
		id:        uuid.NullUUID{UUID: boundary.id, Valid: true},
		inclusive: boundary.inclusive,
	}, nil
}

func (s *apiServer) publishedSearchAuthorPageIDs(
	ctx context.Context,
	tenantID uuid.UUID,
	queryPattern string,
	descending bool,
	keys authorCursorKeys,
	limit int32,
) ([]uuid.UUID, error) {
	queries := s.queriesFor(ctx)
	if descending {
		return queries.ListPublishedAuthorIDsBySearchNameDesc(ctx, dbmodels.ListPublishedAuthorIDsBySearchNameDescParams{
			TenantID:        tenantID,
			QueryPattern:    queryPattern,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			CursorName:      keys.name,
			Limit:           limit,
		})
	}
	return queries.ListPublishedAuthorIDsBySearchNameAsc(ctx, dbmodels.ListPublishedAuthorIDsBySearchNameAscParams{
		TenantID:        tenantID,
		QueryPattern:    queryPattern,
		CursorID:        keys.id,
		CursorInclusive: keys.inclusive,
		CursorName:      keys.name,
		Limit:           limit,
	})
}

func (s *apiServer) SearchPublishedAuthors(
	ctx context.Context,
	req *connect.Request[publirav1.SearchPublishedAuthorsRequest],
) (*connect.Response[publirav1.SearchPublishedAuthorsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	query, err := normalizeSearchQuery(req.Msg.Query)
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
		keys, err = decodeSearchAuthorCursorKeys(cursor, query)
		if err != nil {
			return nil, err
		}
	}
	descending := cursor.Direction == pagination.Backward
	ids, err := s.publishedSearchAuthorPageIDs(ctx, tenant.ID, ilikeContainsPattern(searchQueryKey(query)), descending, keys, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to search published authors", err, "tenant_id", tenant.ID.String())
	}
	ids, hasMore := pagination.Page(ids, limit, cursor.Direction)
	rows, err := s.publishedAuthorRowsInOrder(ctx, tenant.ID, ids)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to search published authors", err, "tenant_id", tenant.ID.String())
	}

	items := make([]*publirav1.PublishedAuthor, 0, len(rows))
	for _, row := range rows {
		items = append(items, publishedAuthorFromListRow(row))
	}

	res := &publirav1.SearchPublishedAuthorsResponse{Authors: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeSearchAuthorCursor(pagination.Backward, query, rows[0])
		}
		if hasNext {
			res.NextToken = encodeSearchAuthorCursor(pagination.Forward, query, rows[len(rows)-1])
		}
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeSearchAuthorRecoveryToken(pagination.Backward, query, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeSearchAuthorRecoveryToken(pagination.Forward, query, keys)
	}
	return connect.NewResponse(res), nil
}

// labelCursorKeys is the decoded cursor for SearchPublishedLabels. Only the
// search orders labels by name; ListPublishedLabels is newest first and keeps
// pagination.TimeUUIDKeys.
type labelCursorKeys struct {
	name      sql.NullString
	id        uuid.NullUUID
	inclusive bool
}

// searchLabelRow is one label search hit: what the wire type shows, plus the id
// its token is built from. The search reads both in one query instead of
// resolving ids first, because a label row is a name and its eye catch.
type searchLabelRow struct {
	labelDisplay
	id uuid.UUID
}

func encodeSearchLabelCursor(direction pagination.Direction, query string, row searchLabelRow) string {
	return pagination.Encode(direction, searchQueryKey(query), row.name, row.id.String())
}

func encodeSearchLabelRecoveryToken(direction pagination.Direction, query string, keys labelCursorKeys) string {
	return pagination.Encode(direction, searchQueryKey(query), keys.name.String, keys.id.UUID.String(), labelInclusiveKey)
}

func decodeSearchLabelCursorKeys(cursor pagination.Cursor, query string) (labelCursorKeys, error) {
	boundary, err := decodeSearchBoundary(cursor, query, labelInclusiveKey)
	if err != nil {
		return labelCursorKeys{}, err
	}
	return labelCursorKeys{
		name:      sql.NullString{String: boundary.sortKey, Valid: true},
		id:        uuid.NullUUID{UUID: boundary.id, Valid: true},
		inclusive: boundary.inclusive,
	}, nil
}

func searchLabelPage[T any](rows []T, convert func(T) searchLabelRow) []searchLabelRow {
	page := make([]searchLabelRow, len(rows))
	for index, row := range rows {
		page[index] = convert(row)
	}
	return page
}

func searchLabelRowFromAsc(row dbmodels.ListPublishedLabelsBySearchNameAscRow) searchLabelRow {
	return searchLabelRow{
		labelDisplay: labelDisplay{
			publicID:               row.PublicID,
			name:                   row.Name,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		},
		id: row.ID,
	}
}

func searchLabelRowFromDesc(row dbmodels.ListPublishedLabelsBySearchNameDescRow) searchLabelRow {
	return searchLabelRow{
		labelDisplay: labelDisplay{
			publicID:               row.PublicID,
			name:                   row.Name,
			eyeCatchImageID:        row.EyeCatchImageID,
			eyeCatchImageUpdatedAt: row.EyeCatchImageUpdatedAt,
		},
		id: row.ID,
	}
}

func (s *apiServer) searchPublishedLabelPage(
	ctx context.Context,
	tenantID uuid.UUID,
	queryPattern string,
	descending bool,
	keys labelCursorKeys,
	limit int32,
) ([]searchLabelRow, error) {
	queries := s.queriesFor(ctx)
	if descending {
		rows, err := queries.ListPublishedLabelsBySearchNameDesc(ctx, dbmodels.ListPublishedLabelsBySearchNameDescParams{
			TenantID:        tenantID,
			QueryPattern:    queryPattern,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			CursorName:      keys.name,
			Limit:           limit,
		})
		if err != nil {
			return nil, err
		}
		return searchLabelPage(rows, searchLabelRowFromDesc), nil
	}

	rows, err := queries.ListPublishedLabelsBySearchNameAsc(ctx, dbmodels.ListPublishedLabelsBySearchNameAscParams{
		TenantID:        tenantID,
		QueryPattern:    queryPattern,
		CursorID:        keys.id,
		CursorInclusive: keys.inclusive,
		CursorName:      keys.name,
		Limit:           limit,
	})
	if err != nil {
		return nil, err
	}
	return searchLabelPage(rows, searchLabelRowFromAsc), nil
}

func (s *apiServer) SearchPublishedLabels(
	ctx context.Context,
	req *connect.Request[publirav1.SearchPublishedLabelsRequest],
) (*connect.Response[publirav1.SearchPublishedLabelsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	query, err := normalizeSearchQuery(req.Msg.Query)
	if err != nil {
		return nil, err
	}
	limit := pagination.NormalizeLimit(req.Msg.Limit, defaultLabelPageSize, maxLabelPageSize)
	cursor, err := pagination.Decode(req.Msg.Token)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	}
	var keys labelCursorKeys
	if !cursor.IsZero() {
		keys, err = decodeSearchLabelCursorKeys(cursor, query)
		if err != nil {
			return nil, err
		}
	}
	descending := cursor.Direction == pagination.Backward
	rows, err := s.searchPublishedLabelPage(ctx, tenant.ID, ilikeContainsPattern(searchQueryKey(query)), descending, keys, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to search published labels", err, "tenant_id", tenant.ID.String())
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

	res := &publirav1.SearchPublishedLabelsResponse{Labels: items}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = encodeSearchLabelCursor(pagination.Backward, query, rows[0])
		}
		if hasNext {
			res.NextToken = encodeSearchLabelCursor(pagination.Forward, query, rows[len(rows)-1])
		}
	case cursor.Direction == pagination.Forward && !keys.inclusive:
		res.PreviousToken = encodeSearchLabelRecoveryToken(pagination.Backward, query, keys)
	case cursor.Direction == pagination.Backward && !keys.inclusive:
		res.NextToken = encodeSearchLabelRecoveryToken(pagination.Forward, query, keys)
	}
	return connect.NewResponse(res), nil
}
