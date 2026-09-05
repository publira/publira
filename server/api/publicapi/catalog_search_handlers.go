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

// The SearchPublishedSeries cursor carries the query it was built for, then
// the title + id sort keys. A token from another query is rejected rather than
// reinterpreted: its keys point into a page that does not exist under the new
// query. Token rules: proto/README.md.
func encodeSearchCursor(direction pagination.Direction, query string, row dbmodels.ListActiveSeriesByIDsRow) string {
	return pagination.Encode(direction, searchQueryKey(query), row.Title, row.ID.String())
}

func encodeSearchRecoveryToken(direction pagination.Direction, query string, keys seriesCursorKeys) string {
	return pagination.Encode(direction, searchQueryKey(query), keys.title.String, keys.id.UUID.String(), seriesInclusiveKey)
}

func decodeSearchCursorKeys(cursor pagination.Cursor, query string) (seriesCursorKeys, error) {
	invalid := connect.NewError(connect.CodeInvalidArgument, errors.New("token is invalid"))
	if len(cursor.Keys) != 3 && len(cursor.Keys) != 4 {
		return seriesCursorKeys{}, invalid
	}
	inclusive := len(cursor.Keys) == 4
	if inclusive && cursor.Keys[3] != seriesInclusiveKey {
		return seriesCursorKeys{}, invalid
	}
	if cursor.Keys[0] != searchQueryKey(query) {
		return seriesCursorKeys{}, connect.NewError(connect.CodeInvalidArgument, errors.New("token was issued for another query"))
	}
	seriesID, err := uuid.Parse(cursor.Keys[2])
	if err != nil {
		return seriesCursorKeys{}, invalid
	}
	return seriesCursorKeys{
		title:     sql.NullString{String: cursor.Keys[1], Valid: true},
		id:        uuid.NullUUID{UUID: seriesID, Valid: true},
		inclusive: inclusive,
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
