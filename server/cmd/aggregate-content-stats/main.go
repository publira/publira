// aggregate-content-stats rebuilds one UTC day's content_daily_stats snapshot.
package main

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/contentstats"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/tracing"
)

const serviceName = "publira-aggregate-content-stats"

func main() {
	logger := logging.New(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	slog.SetDefault(logger)

	shutdownTracing, err := tracing.Setup(context.Background(), serviceName)
	if err != nil {
		logger.Error("failed to initialize tracing", "error", err)
	}
	defer func() {
		if err := shutdownTracing(context.Background()); err != nil {
			logger.Error("failed to flush pending spans", "error", err)
		}
	}()

	statDate, err := resolveStatDate()
	if err != nil {
		logger.Error("invalid aggregate date", "error", err)
		os.Exit(1)
	}
	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	db, err := sqldb.Open(resolveDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close() //nolint:errcheck

	started := time.Now()
	result, err := contentstats.New(db).Run(context.Background(), statDate)
	if err != nil {
		logger.Error("content stats aggregation failed", "stat_date", statDate.Format(time.DateOnly), "error", err)
		os.Exit(1)
	}
	logger.Info("content stats aggregation completed",
		"stat_date", statDate.Format(time.DateOnly),
		"tenant_count", result.TenantCount,
		"row_count", result.RowCount,
		"duration", time.Since(started),
	)
}

func resolveDBURL(fallback string) string {
	for _, name := range []string{"PUBLIRA_CONTENT_STATS_DB_URL", "PUBLIRA_WORKER_DB_URL"} {
		if url := strings.TrimSpace(os.Getenv(name)); url != "" {
			return url
		}
	}
	return fallback
}

func resolveStatDate() (time.Time, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_CONTENT_STATS_DATE"))
	if raw == "" {
		return time.Now().UTC().AddDate(0, 0, -1).Truncate(24 * time.Hour), nil
	}
	return time.Parse(time.DateOnly, raw)
}
