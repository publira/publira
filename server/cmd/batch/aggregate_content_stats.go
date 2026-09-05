package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/contentstats"
	"github.com/publira/publira/server/internal/sqldb"
)

func runAggregateContentStats(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	statDate, err := resolveStatDate()
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

	started := time.Now()
	result, err := contentstats.New(db).Run(ctx, contentstats.Options{StatDate: statDate})
	if err != nil {
		logger.Error("content stats aggregation failed",
			"stat_date", batchDateLogValue(statDate),
			"tenant_count", result.TenantCount,
			"row_count", result.RowCount,
			"duration", time.Since(started),
			"error", err,
		)
		return err
	}
	logger.Info("content stats aggregation completed",
		"stat_date", batchDateLogValue(statDate),
		"tenant_count", result.TenantCount,
		"row_count", result.RowCount,
		"duration", time.Since(started),
	)
	return nil
}

func resolveContentStatsDBURL(fallback string) string {
	return resolveDBURL(fallback, "PUBLIRA_CONTENT_STATS_DB_URL", "PUBLIRA_WORKER_DB_URL")
}

func resolveStatDate() (time.Time, error) {
	return resolveTenantLocalDate("PUBLIRA_CONTENT_STATS_DATE")
}
