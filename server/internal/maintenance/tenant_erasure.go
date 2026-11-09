package maintenance

import (
	"context"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformsearch"
	"github.com/publira/publira/server/internal/tenanterasure"
)

// TenantErasure erases the tenants operators asked to delete, as
// tenanterasure describes. A pass with none waiting does nothing. It has no
// tunables, and therefore no Load function.
type TenantErasure struct{}

// Run erases every tenant waiting.
func (TenantErasure) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()
	started := time.Now()
	summary, err := tenanterasure.RunPending(ctx, tenanterasure.Deps{
		DB:       deps.DB,
		Images:   deps.Storage,
		Archives: deps.DataExportBucket,
		Search: platformsearch.TenantEraser{
			DB:      deps.DB,
			Queries: dbmodels.New(deps.DB),
			Secrets: deps.Secrets,
			Logger:  logger,
		},
		Cache:  deps.TenantCache,
		Logger: logger,
	})
	attrs := []any{
		"erased_count", summary.Erased,
		"failed_count", summary.Failed,
		"deferred_count", summary.Deferred,
		"duration", time.Since(started),
	}
	if err != nil {
		logger.ErrorContext(ctx, "tenant erasure pass failed", append(attrs, "error", err)...)
		return err
	}
	if summary.Erased > 0 || summary.Deferred > 0 {
		logger.InfoContext(ctx, "tenant erasure pass completed", attrs...)
	}
	return nil
}
