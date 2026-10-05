// Package catalogsearch is the seam between the public catalog search RPCs and
// the engine that answers them. A backend finds and orders the hits and owns
// the tokens that page through them; the handlers read the rows they show by
// id, so the hits of every backend are displayed, and checked for visibility,
// the same way.
package catalogsearch

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/publishedseries"
)

// ErrInvalidToken is returned for a cursor the backend did not issue.
var ErrInvalidToken = errors.New("catalogsearch: token is invalid")

// ErrTokenForAnotherQuery is returned for a cursor issued for a different
// query: its boundary points into a page that does not exist under this one.
var ErrTokenForAnotherQuery = errors.New("catalogsearch: token was issued for another query")

// ErrTokenForAnotherNarrowing is returned for a series cursor issued under
// another order or filter: its boundary sits somewhere else in the list this
// request asks for, the same way a list's token does.
var ErrTokenForAnotherNarrowing = errors.New("catalogsearch: token was issued for another order or filter")

// Request is one page of a search.
type Request struct {
	TenantID uuid.UUID
	// Surface is the stored value of the calling surface. A hit has to be
	// published on it.
	Surface string
	// Query is the trimmed, non-empty keyword the reader typed.
	Query string
	// Limit is the page size.
	Limit int32
	// Cursor is the request's token with the surface already taken off. The
	// zero value asks for the first page.
	Cursor pagination.Cursor
}

// SeriesRequest is one page of a series search, narrowed and sorted the way the
// published series list is.
type SeriesRequest struct {
	Request
	// Order sorts the hits as the list sorts the catalogue. The zero value is
	// the backend's own order: by relevance where it ranks its hits, by title
	// where it does not.
	Order publishedseries.Order
	// Filter keeps only the hits the list would keep under it.
	Filter publishedseries.Filter
}

// Page is the hits of one page in display order, with the pagination.Encode
// tokens of the pages on either side. An empty token means there is none.
type Page struct {
	IDs           []uuid.UUID
	PreviousToken string
	NextToken     string
}

// Backend answers the three catalog searches for a tenant.
type Backend interface {
	SearchSeries(ctx context.Context, req SeriesRequest) (Page, error)
	SearchCreators(ctx context.Context, req Request) (Page, error)
	SearchLabels(ctx context.Context, req Request) (Page, error)
}
