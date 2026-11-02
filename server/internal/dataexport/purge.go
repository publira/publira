package dataexport

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dbroles"
	"github.com/publira/publira/server/internal/storage"
)

// purgeChunkSize is how many requests one purge statement takes. A tenant's
// requests are a reader's at most once a day each, so a pass rarely needs a
// second chunk.
const purgeChunkSize = 500

// unrecordedMinAge is how old an archive no row names has to be before Purge
// deletes it. A build stores its archive and then records it, so a younger one
// may be a build that has not recorded it yet.
const unrecordedMinAge = 24 * time.Hour

// sweepPageSize bounds one listing page of ObjectPrefix, and with it the keys
// one reference lookup and one batch delete carry.
const sweepPageSize = 1000

// PurgeResult is what Purge took, or would have taken on a dry run.
type PurgeResult struct {
	Requests int
	Archives int
	// Unrecorded is the archives a day old that no row names: one a build
	// stored and could neither record nor delete, as a build cut off between
	// the two leaves.
	Unrecorded int
}

// Purge deletes every request whose time is up or whose account is gone, the
// archive first and the row after it: a row whose archive could not be
// deleted is kept, so the next pass tries again rather than leaving an object
// nothing names. It then sweeps ObjectPrefix for the archives a day old that
// no row names, which no other sweep reaches. A dry run counts the first
// chunk of requests and the archives the sweep would delete, and deletes
// nothing.
func Purge(ctx context.Context, deps Deps, dryRun bool) (PurgeResult, error) {
	var result PurgeResult
	if deps.DB == nil {
		return result, errors.New("dataexport: db is nil")
	}
	if err := dbroles.RequireEveryTenant(ctx, deps.DB, "data export purge"); err != nil {
		return result, err
	}
	pass := &purgePass{deps: deps, queries: dbmodels.New(deps.DB), dryRun: dryRun}
	if err := pass.requests(ctx, &result); err != nil {
		return result, err
	}
	bucket, err := pass.bucket(ctx)
	// An archive is stored only while there is an object store, so a platform
	// with none has nothing to sweep.
	if errors.Is(err, storage.ErrNotConfigured) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	result.Unrecorded, err = pass.sweep(ctx, bucket, deps.now().Add(-unrecordedMinAge))
	return result, err
}

// purgePass is one Purge, holding the bucket once it has resolved it.
type purgePass struct {
	deps      Deps
	queries   *dbmodels.Queries
	dryRun    bool
	reclaimer storage.Reclaimer
}

// bucket resolves the bucket the pass deletes from, once.
func (p *purgePass) bucket(ctx context.Context) (storage.Reclaimer, error) {
	if p.reclaimer != nil {
		return p.reclaimer, nil
	}
	if p.deps.Reclaimers == nil {
		return nil, storage.ErrNotConfigured
	}
	reclaimer, _, err := p.deps.Reclaimers.Reclaimer(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve the bucket to purge data exports from: %w", err)
	}
	p.reclaimer = reclaimer
	return reclaimer, nil
}

// requests deletes the requests due, chunk by chunk, each one's archive before
// its row.
func (p *purgePass) requests(ctx context.Context, result *PurgeResult) error {
	for {
		rows, err := p.queries.ListPurgeableUserDataExports(ctx, dbmodels.ListPurgeableUserDataExportsParams{
			Now:   p.deps.now(),
			Limit: purgeChunkSize,
		})
		if err != nil {
			return fmt.Errorf("list the data exports to purge: %w", err)
		}
		if len(rows) == 0 {
			return nil
		}
		ids := make([]uuid.UUID, 0, len(rows))
		keys := make([]string, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ID)
			if row.ObjectKey.Valid {
				keys = append(keys, row.ObjectKey.String)
			}
		}
		if p.dryRun {
			result.Requests += len(ids)
			result.Archives += len(keys)
			return nil
		}
		if len(keys) > 0 {
			bucket, err := p.bucket(ctx)
			if err != nil {
				return err
			}
			if err := bucket.Delete(ctx, keys); err != nil {
				return fmt.Errorf("delete data export archives: %w", err)
			}
		}
		deleted, err := p.queries.DeleteUserDataExports(ctx, ids)
		if err != nil {
			return fmt.Errorf("delete data export requests: %w", err)
		}
		result.Requests += int(deleted)
		result.Archives += len(keys)
		if len(rows) < purgeChunkSize {
			return nil
		}
	}
}

// sweep deletes, a page at a time, every archive under ObjectPrefix last
// modified before cutoff that no row names, and answers how many it deleted,
// or would have on a dry run.
func (p *purgePass) sweep(ctx context.Context, bucket storage.Reclaimer, cutoff time.Time) (int, error) {
	swept := 0
	cursor := ""
	for {
		page, err := bucket.List(ctx, storage.ListRequest{Prefix: ObjectPrefix, Cursor: cursor, Limit: sweepPageSize})
		if err != nil {
			return swept, fmt.Errorf("list the stored data exports: %w", err)
		}
		candidates := make([]string, 0, len(page.Objects))
		for _, object := range page.Objects {
			if object.LastModified.Before(cutoff) {
				candidates = append(candidates, object.ObjectKey)
			}
		}
		if len(candidates) > 0 {
			referenced, err := p.queries.ListReferencedObjectKeys(ctx, candidates)
			if err != nil {
				return swept, fmt.Errorf("look up the stored data exports' rows: %w", err)
			}
			unreferenced := slices.DeleteFunc(candidates, func(key string) bool { return slices.Contains(referenced, key) })
			if len(unreferenced) > 0 && !p.dryRun {
				if err := bucket.Delete(ctx, unreferenced); err != nil {
					return swept, fmt.Errorf("delete unrecorded data exports: %w", err)
				}
			}
			swept += len(unreferenced)
		}
		if page.NextCursor == "" {
			return swept, nil
		}
		cursor = page.NextCursor
	}
}
