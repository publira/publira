package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/sqldb"
)

func runProjectEpisodeReads(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	job, err := maintenance.LoadEpisodeReadProjection()
	if err != nil {
		logger.Error("invalid episode read projection settings", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveEpisodeReadProjectionDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	return job.Run(ctx, maintenance.Deps{DB: db, Logger: logger})
}

func resolveEpisodeReadProjectionDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_EPISODE_READ_PROJECTION_DB_URL",
		"PUBLIRA_CONTENT_EVENTS_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
	)
}
