package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/sqldb"
)

func runPurgeWithdrawnComments(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	job, err := maintenance.LoadWithdrawnCommentPurge()
	if err != nil {
		logger.Error("invalid withdrawn comment purge settings", "error", err)
		return err
	}
	if job.DryRun, err = resolveDryRun("PUBLIRA_COMMENT_PURGE_DRY_RUN"); err != nil {
		logger.Error("invalid dry-run flag", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveCommentPurgeDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	return job.Run(ctx, maintenance.Deps{DB: db, Logger: logger})
}

func resolveCommentPurgeDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_COMMENT_PURGE_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
	)
}
