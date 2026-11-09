package tenanterasure

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/publira/publira/server/internal/dataexport"
	"github.com/publira/publira/server/internal/orphanimages"
	"github.com/publira/publira/server/internal/storage"
)

// objectPageSize is one listing page and one batch delete, S3's own ceiling.
const objectPageSize = 1000

// eraseObjects deletes every object under prefix in the bucket source names,
// a page at a time. A listing is taken from the start each time, so a page
// deleted is a page the next listing no longer holds, and a pass cut short is
// resumed by the next one from whatever is left.
//
// A platform with no object store saved has nowhere an object could have been
// stored since, and every upload is refused on it, so it has nothing to
// delete: holding the deletion back until an operator saves one would only
// keep the tenant's rows a while longer.
func eraseObjects(ctx context.Context, source storage.ReclaimerSource, logger *slog.Logger, prefix string) error {
	if source == nil {
		return nil
	}
	bucket, name, err := source.Reclaimer(ctx)
	if errors.Is(err, storage.ErrNotConfigured) {
		logger.WarnContext(ctx, "no object store to erase the tenant's objects from", "prefix", prefix)
		return nil
	}
	if err != nil {
		return fmt.Errorf("resolve the bucket to erase %s from: %w", prefix, err)
	}
	var total int
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		page, err := bucket.List(ctx, storage.ListRequest{Prefix: prefix, Limit: objectPageSize})
		if err != nil {
			return fmt.Errorf("list %s in %s: %w", prefix, name, err)
		}
		if len(page.Objects) == 0 {
			break
		}
		keys := make([]string, len(page.Objects))
		for i, object := range page.Objects {
			keys[i] = object.ObjectKey
		}
		if err := bucket.Delete(ctx, keys); err != nil {
			return fmt.Errorf("delete objects under %s in %s: %w", prefix, name, err)
		}
		total += len(keys)
	}
	if total > 0 {
		logger.InfoContext(ctx, "tenant objects erased", "bucket", name, "prefix", prefix, "objects", total)
	}
	return nil
}

// imagePrefix and archivePrefix are where the tenant's images and its readers'
// archives are stored, each behind its public ID.
func imagePrefix(publicID string) string {
	return orphanimages.DefaultPrefix + publicID + "/"
}

func archivePrefix(publicID string) string {
	return dataexport.ObjectPrefix + publicID + "/"
}
