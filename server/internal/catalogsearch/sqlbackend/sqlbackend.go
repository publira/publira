// Package sqlbackend is the default catalog search backend: an ILIKE substring
// match in PostgreSQL, ordered by title or name unless a series search asks
// for another order. It needs nothing the database
// does not already have.
package sqlbackend

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogsearch"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publishedseries"
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
// fetching by one row. backward is the direction of the page, which the
// order of the search folds into the direction actually scanned.
type fetchFunc func(ctx context.Context, queries dbmodels.Querier, backward bool, pattern string, keys boundary, limit int32) ([]hit, error)

// Every token carries the identity of the search it was issued for, then the
// sort key and the id. The identity is the query key, and for a series search
// the list key of its order and filters after it. A token from another query
// or another narrowing is rejected rather than reinterpreted. Token rules:
// proto/README.md.
func decodeBoundary(cursor pagination.Cursor, identity []string) (boundary, error) {
	n := len(identity)
	if len(cursor.Keys) != n+2 && len(cursor.Keys) != n+3 {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	inclusive := len(cursor.Keys) == n+3
	if inclusive && cursor.Keys[n+2] != inclusiveKey {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	if cursor.Keys[0] != identity[0] {
		return boundary{}, catalogsearch.ErrTokenForAnotherQuery
	}
	for index := 1; index < n; index++ {
		if cursor.Keys[index] != identity[index] {
			return boundary{}, catalogsearch.ErrTokenForAnotherNarrowing
		}
	}
	id, err := uuid.Parse(cursor.Keys[n+1])
	if err != nil {
		return boundary{}, catalogsearch.ErrInvalidToken
	}
	return boundary{
		sortKey:   sql.NullString{String: cursor.Keys[n], Valid: true},
		id:        uuid.NullUUID{UUID: id, Valid: true},
		inclusive: inclusive,
	}, nil
}

func encodeBoundary(direction pagination.Direction, identity []string, sortKey string, id uuid.UUID, recovery bool) string {
	keys := make([]string, 0, len(identity)+3)
	keys = append(keys, identity...)
	keys = append(keys, sortKey, id.String())
	if recovery {
		keys = append(keys, inclusiveKey)
	}
	return pagination.Encode(direction, keys...)
}

func (b *Backend) search(ctx context.Context, req catalogsearch.Request, identity []string, fetch fetchFunc) (catalogsearch.Page, error) {
	var keys boundary
	if !req.Cursor.IsZero() {
		var err error
		keys, err = decodeBoundary(req.Cursor, identity)
		if err != nil {
			return catalogsearch.Page{}, err
		}
	}
	backward := req.Cursor.Direction == pagination.Backward
	hits, err := fetch(ctx, b.queriesFor(ctx), backward, ilikeContainsPattern(queryKey(req.Query)), keys, req.Limit+1)
	if err != nil {
		return catalogsearch.Page{}, err
	}
	hits, hasMore := pagination.Page(hits, req.Limit, req.Cursor.Direction)

	page := catalogsearch.Page{IDs: make([]uuid.UUID, 0, len(hits))}
	for _, hit := range hits {
		page.IDs = append(page.IDs, hit.id)
	}
	switch {
	case len(hits) > 0:
		hasPrevious, hasNext := pagination.Neighbors(req.Cursor, hasMore)
		if hasPrevious {
			page.PreviousToken = encodeBoundary(pagination.Backward, identity, hits[0].sortKey, hits[0].id, false)
		}
		if hasNext {
			last := hits[len(hits)-1]
			page.NextToken = encodeBoundary(pagination.Forward, identity, last.sortKey, last.id, false)
		}
	// An empty page past the boundary still hands back a token that includes
	// the boundary row, so the reader has a way back to where they came from.
	case req.Cursor.Direction == pagination.Forward && !keys.inclusive:
		page.PreviousToken = encodeBoundary(pagination.Backward, identity, keys.sortKey.String, keys.id.UUID, true)
	case req.Cursor.Direction == pagination.Backward && !keys.inclusive:
		page.NextToken = encodeBoundary(pagination.Forward, identity, keys.sortKey.String, keys.id.UUID, true)
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

// SearchSeries matches the title or the synopsis, narrowed and sorted by the
// scans of the published series list, which take the keyword as one more
// filter. Its own order, which it cannot rank by, is the title.
func (b *Backend) SearchSeries(ctx context.Context, req catalogsearch.SeriesRequest) (catalogsearch.Page, error) {
	order := req.Order
	if order == (publishedseries.Order{}) {
		order = publishedseries.TitleAsc
	}
	identity := []string{queryKey(req.Query), publishedseries.ListKey(order, req.Filter)}
	return b.search(ctx, req.Request, identity, func(ctx context.Context, queries dbmodels.Querier, backward bool, pattern string, keys boundary, limit int32) ([]hit, error) {
		scanKeys, err := seriesKeys(order, keys)
		if err != nil {
			return nil, err
		}
		rows, err := publishedseries.Page(ctx, queries, publishedseries.Scan{
			TenantID:     req.TenantID,
			Surface:      req.Surface,
			Order:        order,
			Filter:       req.Filter,
			QueryPattern: sql.NullString{String: pattern, Valid: true},
			Descending:   order.Descending != backward,
			Keys:         scanKeys,
			Limit:        limit,
		})
		if err != nil {
			return nil, err
		}
		hits := make([]hit, len(rows))
		for index, row := range rows {
			hits[index] = hit{id: row.ID, sortKey: seriesSortKey(order, row)}
		}
		return hits, nil
	})
}

// seriesSortKey is the text a token carries for the value a series was sorted
// by: the title as it is, and an instant in RFC 3339 with its fraction, the
// shape the list's own tokens give it.
func seriesSortKey(order publishedseries.Order, row publishedseries.Row) string {
	switch order.Column {
	case publishedseries.ColumnTitle:
		return row.Title
	case publishedseries.ColumnLatestEpisodeAt:
		return row.LatestEpisodeAt.UTC().Format(time.RFC3339Nano)
	default:
		return row.PublishedAt.UTC().Format(time.RFC3339Nano)
	}
}

// seriesKeys reads a boundary into the keyset the scans compare against.
func seriesKeys(order publishedseries.Order, at boundary) (publishedseries.Keys, error) {
	if !at.id.Valid {
		return publishedseries.Keys{}, nil
	}
	keys := publishedseries.Keys{ID: at.id, Inclusive: at.inclusive}
	if order.Column == publishedseries.ColumnTitle {
		keys.Title = at.sortKey
		return keys, nil
	}
	instant, err := time.Parse(time.RFC3339Nano, at.sortKey.String)
	if err != nil {
		return publishedseries.Keys{}, catalogsearch.ErrInvalidToken
	}
	value := sql.NullTime{Time: instant.UTC(), Valid: true}
	if order.Column == publishedseries.ColumnLatestEpisodeAt {
		keys.LatestEpisodeAt = value
	} else {
		keys.PublishedAt = value
	}
	return keys, nil
}

// SearchCreators matches the name alone and orders by it.
func (b *Backend) SearchCreators(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	return b.search(ctx, req, []string{queryKey(req.Query)}, func(ctx context.Context, queries dbmodels.Querier, backward bool, pattern string, keys boundary, limit int32) ([]hit, error) {
		if backward {
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
	return b.search(ctx, req, []string{queryKey(req.Query)}, func(ctx context.Context, queries dbmodels.Querier, backward bool, pattern string, keys boundary, limit int32) ([]hit, error) {
		if backward {
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
