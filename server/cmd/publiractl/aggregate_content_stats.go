package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/sqldb"
)

func runAggregateContentStats(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	statDate, err := resolveTenantLocalDate("PUBLIRA_CONTENT_STATS_DATE")
	if err != nil {
		logger.Error("invalid aggregate date", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveContentStatsDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	job := maintenance.ContentStatsAggregation{Date: statDate}
	return job.Run(ctx, maintenance.Deps{DB: db, Logger: logger})
}

func resolveContentStatsDBURL(fallback string) string {
	return resolveDBURL(fallback, "PUBLIRA_CONTENT_STATS_DB_URL")
}
