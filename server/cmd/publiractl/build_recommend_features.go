package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/sqldb"
)

func runBuildRecommendFeatures(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	job, err := maintenance.LoadRecommendFeatureBuild()
	if err != nil {
		logger.Error("invalid recommend feature settings", "error", err)
		return err
	}
	if job.Date, err = resolveTenantLocalDate("PUBLIRA_RECOMMEND_FEATURES_DATE"); err != nil {
		logger.Error("invalid reference date", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveRecommendFeaturesDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	return job.Run(ctx, maintenance.Deps{DB: db, Logger: logger})
}

func resolveRecommendFeaturesDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_RECOMMEND_FEATURES_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
	)
}
