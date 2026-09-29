package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/sqldb"
)

func runAggregateRankings(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	job, err := maintenance.LoadRankingAggregation()
	if err != nil {
		logger.Error("invalid ranking settings", "error", err)
		return err
	}
	if job.Date, err = resolveTenantLocalDate("PUBLIRA_CONTENT_RANKING_DATE"); err != nil {
		logger.Error("invalid ranking date", "error", err)
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

func resolveRankingDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_CONTENT_RANKING_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
	)
}
