package dataexport

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dbroles"
	"github.com/publira/publira/server/internal/storage"
)

// purgeChunkSize is how many requests one purge statement takes. A tenant's
// requests are a reader's at most once a day each, so a pass rarely needs a
// second chunk.
const purgeChunkSize = 500

// PurgeResult is what Purge took, or would have taken on a dry run.
type PurgeResult struct {
	Requests int
	Archives int
}

// Purge deletes every request whose time is up or whose account is gone, the
// archive first and the row after it: a row whose archive could not be
// deleted is kept, so the next pass tries again rather than leaving an object
// nothing names. A dry run counts the first chunk and deletes nothing.
func Purge(ctx context.Context, deps Deps, dryRun bool) (PurgeResult, error) {
	var result PurgeResult
	if deps.DB == nil {
		return result, errors.New("dataexport: db is nil")
	}
	if err := dbroles.RequireEveryTenant(ctx, deps.DB, "data export purge"); err != nil {
		return result, err
	}
	queries := dbmodels.New(deps.DB)
	var reclaimer storage.Reclaimer
	for {
		rows, err := queries.ListPurgeableUserDataExports(ctx, dbmodels.ListPurgeableUserDataExportsParams{
			Now:   deps.now(),
			Limit: purgeChunkSize,
		})
		if err != nil {
			return result, fmt.Errorf("list the data exports to purge: %w", err)
		}
		if len(rows) == 0 {
			return result, nil
		}
		ids := make([]uuid.UUID, 0, len(rows))
		keys := make([]string, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ID)
			if row.ObjectKey.Valid {
				keys = append(keys, row.ObjectKey.String)
			}
		}
		if dryRun {
			result.Requests += len(ids)
			result.Archives += len(keys)
			return result, nil
		}
		if len(keys) > 0 {
			if reclaimer == nil {
				if deps.Reclaimers == nil {
					return result, storage.ErrNotConfigured
				}
				if reclaimer, _, err = deps.Reclaimers.Reclaimer(ctx); err != nil {
					return result, fmt.Errorf("resolve the bucket to purge data exports from: %w", err)
				}
			}
			if err := reclaimer.Delete(ctx, keys); err != nil {
				return result, fmt.Errorf("delete data export archives: %w", err)
			}
		}
		deleted, err := queries.DeleteUserDataExports(ctx, ids)
		if err != nil {
			return result, fmt.Errorf("delete data export requests: %w", err)
		}
		result.Requests += int(deleted)
		result.Archives += len(keys)
		if len(rows) < purgeChunkSize {
			return result, nil
		}
	}
}
