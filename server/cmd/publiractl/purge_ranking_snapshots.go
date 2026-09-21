package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/sqldb"
)

func runPurgeRankingSnapshots(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	job, err := maintenance.LoadRankingSnapshotPurge()
	if err != nil {
		logger.Error("invalid ranking snapshot purge settings", "error", err)
		return err
	}
	if job.DryRun, err = resolveDryRun("PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN"); err != nil {
		logger.Error("invalid dry-run flag", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveRankingDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	return job.Run(ctx, maintenance.Deps{DB: db, Logger: logger})
}
