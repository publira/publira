// Package sqlbackend is the default catalog search backend: an ILIKE substring
// match in PostgreSQL, ordered by title or name. It needs nothing the database
// does not already have.
package sqlbackend

import (
	"context"
	"database/sql"
	"strings"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogsearch"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// inclusiveKey marks a recovery token, which includes its boundary row once.
const inclusiveKey = "inclusive"

// Backend runs the searches on the tenant-scoped connection of the request,
// and on queries only where the request has none, which is a test without the
// interceptor: any other connection has never set app.current_tenant_id, so
// row-level security would hide every row.
type Backend struct {
	queries dbmodels.Querier
}

var _ catalogsearch.Backend = (*Backend)(nil)

func New(queries dbmodels.Querier) *Backend {
	return &Backend{queries: queries}
}

func (b *Backend) queriesFor(ctx context.Context) dbmodels.Querier {
	if queries, ok := rpcmiddleware.TenantQueriesFromContext(ctx); ok {
		return queries
	}
	return b.queries
}

// queryKey is the identity of a search for both the token and the ILIKE
// pattern. A token issued for "Seed" must still work with "seed" because both
// become the same key and the same '%seed%' pattern. strings.ToLower is that
// shared identity. It is not PostgreSQL's locale-aware ILIKE folding, and the
// API does not restrict queries to ASCII.
func queryKey(query string) string {
	return strings.ToLower(query)
}

// ilikeContainsPattern wraps the keyword as '%q%' and escapes ILIKE
// metacharacters so a user typing % or _ cannot widen the match. The escape
// character is '!', matching ESCAPE '!' on the search queries.
func ilikeContainsPattern(query string) string {
	escaped := strings.NewReplacer(
		"!", "!!",
		"%", "!%",
		"_", "!_",
	).Replace(query)
	return "%" + escaped + "%"
}

// boundary is the row a token names: the text the search is ordered by and the
// UUID tiebreaker. Its zero value is the first page.
type boundary struct {
	sortKey   sql.NullString
	id        uuid.NullUUID
	inclusive bool
}

// hit is one row of a search query: its id, and the text it is ordered by,
// which the tokens are built from.
type hit struct {
	id      uuid.UUID
	sortKey string
}

// fetchFunc runs one direction of a search query from the boundary, over-
// fetching by one row.
type fetchFunc func(ctx context.Context, queries dbmodels.Querier, descending bool, pattern string, keys boundary, limit int32) ([]hit, error)

// Every token carries the query it was issued for, then the sort key and the
// id. A token from another query is rejected rather than reinterpreted. Token
// rules: proto/README.md.
func decodeBoundary(cursor pagination.Cursor, query string) (boundary, error) {
	if len(cursor.Keys) != 3 && len(cursor.Keys) != 4 {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	inclusive := len(cursor.Keys) == 4
	if inclusive && cursor.Keys[3] != inclusiveKey {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	if cursor.Keys[0] != queryKey(query) {
		return boundary{}, catalogsearch.ErrTokenForAnotherQuery
	}
	id, err := uuid.Parse(cursor.Keys[2])
	if err != nil {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	return boundary{
		sortKey:   sql.NullString{String: cursor.Keys[1], Valid: true},
		id:        uuid.NullUUID{UUID: id, Valid: true},
		inclusive: inclusive,
	}, nil
}

func (b *Backend) search(ctx context.Context, req catalogsearch.Request, fetch fetchFunc) (catalogsearch.Page, error) {
	var keys boundary
	if !req.Cursor.IsZero() {
		var err error
		keys, err = decodeBoundary(req.Cursor, req.Query)
		if err != nil {
			return catalogsearch.Page{}, err
		}
	}
	descending := req.Cursor.Direction == pagination.Backward
	hits, err := fetch(ctx, b.queriesFor(ctx), descending, ilikeContainsPattern(queryKey(req.Query)), keys, req.Limit+1)
	if err != nil {
		return catalogsearch.Page{}, err
	}
	hits, hasMore := pagination.Page(hits, req.Limit, req.Cursor.Direction)

	page := catalogsearch.Page{IDs: make([]uuid.UUID, 0, len(hits))}
	for _, hit := range hits {
		page.IDs = append(page.IDs, hit.id)
	}
	key := queryKey(req.Query)
	switch {
	case len(hits) > 0:
		hasPrevious, hasNext := pagination.Neighbors(req.Cursor, hasMore)
		if hasPrevious {
			page.PreviousToken = pagination.Encode(pagination.Backward, key, hits[0].sortKey, hits[0].id.String())
		}
		if hasNext {
			last := hits[len(hits)-1]
			page.NextToken = pagination.Encode(pagination.Forward, key, last.sortKey, last.id.String())
		}
	// An empty page past the boundary still hands back a token that includes
	// the boundary row, so the reader has a way back to where they came from.
	case req.Cursor.Direction == pagination.Forward && !keys.inclusive:
		page.PreviousToken = pagination.Encode(pagination.Backward, key, keys.sortKey.String, keys.id.UUID.String(), inclusiveKey)
	case req.Cursor.Direction == pagination.Backward && !keys.inclusive:
		page.NextToken = pagination.Encode(pagination.Forward, key, keys.sortKey.String, keys.id.UUID.String(), inclusiveKey)
	}
	return page, nil
}

func hitsOf[T any](rows []T, convert func(T) hit) []hit {
	hits := make([]hit, len(rows))
	for index, row := range rows {
		hits[index] = convert(row)
	}
	return hits
}

// SearchSeries matches the title or the synopsis and orders by title.
func (b *Backend) SearchSeries(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	return b.search(ctx, req, func(ctx context.Context, queries dbmodels.Querier, descending bool, pattern string, keys boundary, limit int32) ([]hit, error) {
		if descending {
			rows, err := queries.ListPublishedSeriesBySearchTitleDesc(ctx, dbmodels.ListPublishedSeriesBySearchTitleDescParams{
				TenantID:        req.TenantID,
				Surface:         req.Surface,
				QueryPattern:    pattern,
				CursorID:        keys.id,
				CursorInclusive: keys.inclusive,
				CursorTitle:     keys.sortKey,
				Limit:           limit,
			})
			return hitsOf(rows, func(row dbmodels.ListPublishedSeriesBySearchTitleDescRow) hit {
				return hit{id: row.ID, sortKey: row.Title}
			}), err
		}
		rows, err := queries.ListPublishedSeriesBySearchTitleAsc(ctx, dbmodels.ListPublishedSeriesBySearchTitleAscParams{
			TenantID:        req.TenantID,
			Surface:         req.Surface,
			QueryPattern:    pattern,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			CursorTitle:     keys.sortKey,
			Limit:           limit,
		})
		return hitsOf(rows, func(row dbmodels.ListPublishedSeriesBySearchTitleAscRow) hit {
			return hit{id: row.ID, sortKey: row.Title}
		}), err
	})
}

// SearchCreators matches the name alone and orders by it.
func (b *Backend) SearchCreators(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	return b.search(ctx, req, func(ctx context.Context, queries dbmodels.Querier, descending bool, pattern string, keys boundary, limit int32) ([]hit, error) {
		if descending {
			rows, err := queries.ListPublishedCreatorsBySearchNameDesc(ctx, dbmodels.ListPublishedCreatorsBySearchNameDescParams{
				TenantID:        req.TenantID,
				Surface:         req.Surface,
				QueryPattern:    pattern,
				CursorID:        keys.id,
				CursorInclusive: keys.inclusive,
				CursorName:      keys.sortKey,
				Limit:           limit,
			})
			return hitsOf(rows, func(row dbmodels.ListPublishedCreatorsBySearchNameDescRow) hit {
				return hit{id: row.ID, sortKey: row.Name}
			}), err
		}
		rows, err := queries.ListPublishedCreatorsBySearchNameAsc(ctx, dbmodels.ListPublishedCreatorsBySearchNameAscParams{
			TenantID:        req.TenantID,
			Surface:         req.Surface,
			QueryPattern:    pattern,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			CursorName:      keys.sortKey,
			Limit:           limit,
		})
		return hitsOf(rows, func(row dbmodels.ListPublishedCreatorsBySearchNameAscRow) hit {
			return hit{id: row.ID, sortKey: row.Name}
		}), err
	})
}

// SearchLabels matches the name and orders by it.
func (b *Backend) SearchLabels(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	return b.search(ctx, req, func(ctx context.Context, queries dbmodels.Querier, descending bool, pattern string, keys boundary, limit int32) ([]hit, error) {
		if descending {
			rows, err := queries.ListPublishedLabelsBySearchNameDesc(ctx, dbmodels.ListPublishedLabelsBySearchNameDescParams{
				TenantID:        req.TenantID,
				Surface:         req.Surface,
				QueryPattern:    pattern,
				CursorID:        keys.id,
				CursorInclusive: keys.inclusive,
				CursorName:      keys.sortKey,
				Limit:           limit,
			})
			return hitsOf(rows, func(row dbmodels.ListPublishedLabelsBySearchNameDescRow) hit {
				return hit{id: row.ID, sortKey: row.Name}
			}), err
		}
		rows, err := queries.ListPublishedLabelsBySearchNameAsc(ctx, dbmodels.ListPublishedLabelsBySearchNameAscParams{
			TenantID:        req.TenantID,
			Surface:         req.Surface,
			QueryPattern:    pattern,
			CursorID:        keys.id,
			CursorInclusive: keys.inclusive,
			CursorName:      keys.sortKey,
			Limit:           limit,
		})
		return hitsOf(rows, func(row dbmodels.ListPublishedLabelsBySearchNameAscRow) hit {
			return hit{id: row.ID, sortKey: row.Name}
		}), err
	})
}
