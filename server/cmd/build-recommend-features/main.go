// build-recommend-features rebuilds the daily user and item feature snapshots.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/recommendfeatures"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/tracing"
)

const serviceName = "publira-build-recommend-features"

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

	referenceDate, err := resolveReferenceDate()
	if err != nil {
		logger.Error("invalid reference date", "error", err)
		os.Exit(1)
	}
	windowDays, err := resolveWindowDays()
	if err != nil {
		logger.Error("invalid feature window", "error", err)
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
	result, err := recommendfeatures.New(db).Run(context.Background(), recommendfeatures.Options{
		ReferenceDate: referenceDate,
		WindowDays:    windowDays,
	})
	if err != nil {
		logger.Error("recommend feature build failed",
			"reference_date", referenceDate.Format(time.DateOnly),
			"window_days", windowDays,
			"error", err,
		)
		os.Exit(1)
	}
	logger.Info("recommend feature build completed",
		"reference_date", referenceDate.Format(time.DateOnly),
		"window_days", windowDays,
		"feature_version", recommendfeatures.FeatureVersion,
		"tenant_count", result.TenantCount,
		"user_row_count", result.UserRowCount,
		"item_row_count", result.ItemRowCount,
		"duration", time.Since(started),
	)
}

func resolveDBURL(fallback string) string {
	for _, name := range []string{
		"PUBLIRA_RECOMMEND_FEATURES_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
		"PUBLIRA_WORKER_DB_URL",
	} {
		if url := strings.TrimSpace(os.Getenv(name)); url != "" {
			return url
		}
	}
	return fallback
}

func resolveReferenceDate() (time.Time, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_RECOMMEND_FEATURES_DATE"))
	if raw == "" {
		return time.Now().UTC().AddDate(0, 0, -1).Truncate(24 * time.Hour), nil
	}
	return time.Parse(time.DateOnly, raw)
}

func resolveWindowDays() (int, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS"))
	if raw == "" {
		return recommendfeatures.DefaultWindowDays, nil
	}
	days, err := strconv.Atoi(raw)
	if err != nil {
		return 0, err
	}
	// A zero or negative window would put the window start after its end and
	// build every snapshot from nothing, silently emptying both tables.
	if days < 1 {
		return 0, fmt.Errorf("window days must be at least 1, got %d", days)
	}
	return days, nil
}
