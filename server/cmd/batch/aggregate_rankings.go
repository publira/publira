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
	"github.com/publira/publira/server/internal/contentranking"
	"github.com/publira/publira/server/internal/sqldb"
)

func runAggregateRankings(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	referenceDate, err := resolveRankingDate()
	if err != nil {
		logger.Error("invalid ranking date", "error", err)
		return err
	}
	itemLimit, err := resolveRankingItemLimit()
	if err != nil {
		logger.Error("invalid ranking item limit", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveRankingDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	started := time.Now()
	result, err := contentranking.New(db).Run(ctx, contentranking.Options{
		ReferenceDate: referenceDate,
		ItemLimit:     itemLimit,
	})
	if err != nil {
		logger.Error("ranking aggregation failed",
			"reference_date", referenceDate.Format(time.DateOnly),
			"item_limit", itemLimit,
			"tenant_count", result.TenantCount,
			"snapshot_count", result.SnapshotCount,
			"item_count", result.ItemCount,
			"error", err,
		)
		return err
	}
	logger.Info("ranking aggregation completed",
		"reference_date", referenceDate.Format(time.DateOnly),
		"item_limit", itemLimit,
		"algorithm_version", contentranking.AlgorithmVersion,
		"tenant_count", result.TenantCount,
		"snapshot_count", result.SnapshotCount,
		"item_count", result.ItemCount,
		"duration", time.Since(started),
	)
	return nil
}

func resolveRankingDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_CONTENT_RANKING_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
		"PUBLIRA_WORKER_DB_URL",
	)
}

func resolveRankingDate() (time.Time, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_CONTENT_RANKING_DATE"))
	if raw == "" {
		return time.Now().UTC().AddDate(0, 0, -1).Truncate(24 * time.Hour), nil
	}
	return time.Parse(time.DateOnly, raw)
}

func resolveRankingItemLimit() (int, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_CONTENT_RANKING_ITEM_LIMIT"))
	if raw == "" {
		return contentranking.DefaultItemLimit, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil {
		return 0, err
	}
	// A zero or negative limit would write every snapshot as an empty
	// leaderboard, which reads exactly like a tenant with no activity.
	if limit < 1 {
		return 0, fmt.Errorf("item limit must be at least 1, got %d", limit)
	}
	return limit, nil
}
