package platformsearch

import (
	"context"
	"database/sql"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/catalogsearch/opensearchbackend"
	"github.com/publira/publira/server/internal/outbox"
)

// Searcher is the [catalogsearch.Backend] the public search RPCs answer
// through: the engine the search answers from, resolved for each search.
type Searcher struct {
	Resolver *Resolver
	// SQL answers while the search is on the SQL engine.
	SQL catalogsearch.Backend
}

var _ catalogsearch.Backend = Searcher{}

func (s Searcher) backend(ctx context.Context) (catalogsearch.Backend, error) {
	serving, err := s.Resolver.Serving(ctx)
	if err != nil {
		return nil, err
	}
	// Compared as the pointer it is: a nil *Backend in the interface would not
	// be nil.
	if serving == nil {
		return s.SQL, nil
	}
	return serving, nil
}

// SearchSeries implements catalogsearch.Backend.
func (s Searcher) SearchSeries(ctx context.Context, req catalogsearch.SeriesRequest) (catalogsearch.Page, error) {
	backend, err := s.backend(ctx)
	if err != nil {
		return catalogsearch.Page{}, err
	}
	return backend.SearchSeries(ctx, req)
}

// SearchCreators implements catalogsearch.Backend.
func (s Searcher) SearchCreators(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	backend, err := s.backend(ctx)
	if err != nil {
		return catalogsearch.Page{}, err
	}
	return backend.SearchCreators(ctx, req)
}

// SearchLabels implements catalogsearch.Backend.
func (s Searcher) SearchLabels(ctx context.Context, req catalogsearch.Request) (catalogsearch.Page, error) {
	backend, err := s.backend(ctx)
	if err != nil {
		return catalogsearch.Page{}, err
	}
	return backend.SearchLabels(ctx, req)
}

// Indexer is the [outbox.CatalogIndexer] the worker writes catalog_index_sync
// events through: into the index the search answers from, and into the one
// being built, so the build is not missing a write that committed after it
// read the row. On the SQL engine with no build due there is nothing to write
// and the event is done as it is claimed.
type Indexer struct {
	// DB is the pool the rows are read on, one whose role sees every tenant.
	DB       *sql.DB
	Resolver *Resolver
}

var _ outbox.CatalogIndexer = Indexer{}

// Sync implements outbox.CatalogIndexer. It reports a write to the index the
// search answers from only once a search can find it, so the cache drop the
// handler sends next cannot be answered from the index as it was.
func (i Indexer) Sync(ctx context.Context, tenantID uuid.UUID, kind string, id uuid.UUID) (bool, error) {
	targets, err := i.Resolver.Targets(ctx)
	if err != nil {
		return false, err
	}
	var writers catalogindex.Writers
	if targets.Serving != nil {
		writers = append(writers, searchable{targets.Serving})
	}
	if targets.Building != nil {
		writers = append(writers, targets.Building)
	}
	if len(writers) == 0 {
		return false, nil
	}
	if err := catalogindex.NewSyncer(i.DB, writers).Sync(ctx, tenantID, kind, id); err != nil {
		return false, err
	}
	return targets.Serving != nil, nil
}

// searchable writes into the index the search answers from and returns once a
// search can find what it wrote.
type searchable struct {
	backend *opensearchbackend.Backend
}

// PutAll implements catalogindex.Writer.
func (s searchable) PutAll(ctx context.Context, docs []opensearchbackend.Document) error {
	return s.backend.PutAllSearchable(ctx, docs)
}
