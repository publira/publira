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
)

// ErrInvalidToken is returned for a cursor the backend did not issue.
var ErrInvalidToken = errors.New("catalogsearch: token is invalid")

// ErrTokenForAnotherQuery is returned for a cursor issued for a different
// query: its boundary points into a page that does not exist under this one.
var ErrTokenForAnotherQuery = errors.New("catalogsearch: token was issued for another query")

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

// Page is the hits of one page in display order, with the pagination.Encode
// tokens of the pages on either side. An empty token means there is none.
type Page struct {
	IDs           []uuid.UUID
	PreviousToken string
	NextToken     string
}

// Backend answers the three catalog searches for a tenant.
type Backend interface {
	SearchSeries(ctx context.Context, req Request) (Page, error)
	SearchCreators(ctx context.Context, req Request) (Page, error)
	SearchLabels(ctx context.Context, req Request) (Page, error)
}
