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
	"github.com/publira/publira/server/internal/recommendfeatures"
	"github.com/publira/publira/server/internal/sqldb"
)

func runBuildRecommendFeatures(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	referenceDate, err := resolveReferenceDate()
	if err != nil {
		logger.Error("invalid reference date", "error", err)
		return err
	}
	windowDays, err := resolveWindowDays()
	if err != nil {
		logger.Error("invalid feature window", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveRecommendFeaturesDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	started := time.Now()
	result, err := recommendfeatures.New(db).Run(ctx, recommendfeatures.Options{
		ReferenceDate: referenceDate,
		WindowDays:    windowDays,
	})
	if err != nil {
		logger.Error("recommend feature build failed",
			"reference_date", batchDateLogValue(referenceDate),
			"window_days", windowDays,
			"tenant_count", result.TenantCount,
			"user_row_count", result.UserRowCount,
			"item_row_count", result.ItemRowCount,
			"error", err,
		)
		return err
	}
	logger.Info("recommend feature build completed",
		"reference_date", batchDateLogValue(referenceDate),
		"window_days", windowDays,
		"feature_version", recommendfeatures.FeatureVersion,
		"tenant_count", result.TenantCount,
		"user_row_count", result.UserRowCount,
		"item_row_count", result.ItemRowCount,
		"duration", time.Since(started),
	)
	return nil
}

func resolveRecommendFeaturesDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_RECOMMEND_FEATURES_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
		"PUBLIRA_WORKER_DB_URL",
	)
}

func resolveReferenceDate() (time.Time, error) {
	return resolveTenantLocalDate("PUBLIRA_RECOMMEND_FEATURES_DATE")
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
