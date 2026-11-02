package maintenance

import (
	"context"
	"time"

	"github.com/publira/publira/server/internal/dataexport"
)

// DataExportBuild builds the archives readers asked for and no worker has
// built, stores each in the bucket, and tells its reader it is ready. A pass
// with none waiting does nothing. It has no tunables, and therefore no Load
// function.
type DataExportBuild struct{}

// Run builds every archive waiting.
func (DataExportBuild) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()
	started := time.Now()
	summary, err := dataexport.RunPending(ctx, dataexport.Deps{
		DB:         deps.DB,
		Storage:    deps.Uploads,
		Reclaimers: deps.Storage,
		Logger:     logger,
	})
	attrs := []any{
		"built_count", summary.Built,
		"failed_count", summary.Failed,
		"duration", time.Since(started),
	}
	if err != nil {
		logger.ErrorContext(ctx, "data export pass failed", append(attrs, "error", err)...)
		return err
	}
	if summary.Built+summary.Failed > 0 {
		logger.InfoContext(ctx, "data export pass completed", attrs...)
	}
	return nil
}

// DataExportPurge deletes the archives and the requests whose time is up, and
// those of deleted accounts. Its one setting is the dry run, which only the
// command line sets, so it has no Load function.
type DataExportPurge struct {
	DryRun bool
}

// Run deletes every archive and request due.
func (j DataExportPurge) Run(ctx context.Context, deps Deps) error {
	if deps.DB == nil {
		return errNoDB
	}
	logger := deps.logger()
	started := time.Now()
	result, err := dataexport.Purge(ctx, dataexport.Deps{
		DB:         deps.DB,
		Reclaimers: deps.Storage,
		Logger:     logger,
	}, j.DryRun)
	attrs := []any{
		"requests_deleted", result.Requests,
		"archives_deleted", result.Archives,
		"dry_run", j.DryRun,
		"duration", time.Since(started),
	}
	if err != nil {
		logger.ErrorContext(ctx, "data export purge failed", append(attrs, "error", err)...)
		return err
	}
	logger.InfoContext(ctx, "data export purge completed", attrs...)
	return nil
}
