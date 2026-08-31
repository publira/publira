package main

import (
	"context"
	"errors"
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

// The retention windows, per ranking key. A daily snapshot is kept long enough
// to read a quarter's worth of day-over-day movement; a weekly one long enough
// to compare a week against the same week a year earlier, which is what the
// extra weeks past the year are for. Both are far longer than the public site
// needs, because only trend analysis reads anything but the newest period.
const (
	defaultRankingDailyRetentionDays  = 90
	defaultRankingWeeklyRetentionDays = 400
)

func runPurgeRankingSnapshots(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	dailyRetentionDays, err := resolveRankingRetentionDays(
		"PUBLIRA_CONTENT_RANKING_DAILY_RETENTION_DAYS", defaultRankingDailyRetentionDays)
	if err != nil {
		logger.Error("invalid daily retention window", "error", err)
		return err
	}
	weeklyRetentionDays, err := resolveRankingRetentionDays(
		"PUBLIRA_CONTENT_RANKING_WEEKLY_RETENTION_DAYS", defaultRankingWeeklyRetentionDays)
	if err != nil {
		logger.Error("invalid weekly retention window", "error", err)
		return err
	}
	chunkSize, err := resolveRankingPurgeChunkSize()
	if err != nil {
		logger.Error("invalid chunk size", "error", err)
		return err
	}
	dryRun, err := resolveRankingPurgeDryRun()
	if err != nil {
		logger.Error("invalid dry-run flag", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveRankingDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	// Snapshots are identified by calendar dates, so the cutoffs are dates
	// too: a run at any hour of the day expires the same periods.
	today := time.Now().UTC().Truncate(24 * time.Hour)
	dailyCutoff := today.AddDate(0, 0, -dailyRetentionDays)
	weeklyCutoff := today.AddDate(0, 0, -weeklyRetentionDays)

	started := time.Now()
	result, err := contentranking.NewPurger(db).Run(ctx, contentranking.PurgeOptions{
		Cutoffs: map[string]time.Time{
			contentranking.DailyRankingKey:  dailyCutoff,
			contentranking.WeeklyRankingKey: weeklyCutoff,
		},
		ChunkSize: chunkSize,
		DryRun:    dryRun,
	})
	if err != nil {
		logger.Error("ranking snapshot purge failed",
			"daily_cutoff", dailyCutoff.Format(time.DateOnly),
			"weekly_cutoff", weeklyCutoff.Format(time.DateOnly),
			"dry_run", dryRun,
			"row_count", result.RowCount,
			"chunk_count", result.ChunkCount,
			"duration", time.Since(started),
			"error", err,
		)
		return err
	}
	logger.Info("ranking snapshot purge completed",
		"daily_cutoff", dailyCutoff.Format(time.DateOnly),
		"weekly_cutoff", weeklyCutoff.Format(time.DateOnly),
		"daily_retention_days", dailyRetentionDays,
		"weekly_retention_days", weeklyRetentionDays,
		"chunk_size", chunkSize,
		"dry_run", result.DryRun,
		"row_count", result.RowCount,
		"chunk_count", result.ChunkCount,
		"duration", time.Since(started),
	)
	return nil
}

func resolveRankingRetentionDays(name string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	days, err := strconv.Atoi(raw)
	if err != nil {
		return 0, err
	}
	// A zero or negative window would expire every period the newest one does
	// not protect, which is never what a retention setting means.
	if days < 1 {
		return 0, fmt.Errorf("%s must be at least 1, got %d", name, days)
	}
	return days, nil
}

func resolveRankingPurgeChunkSize() (int, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_CONTENT_RANKING_PURGE_CHUNK_SIZE"))
	if raw == "" {
		return contentranking.DefaultPurgeChunkSize, nil
	}
	size, err := strconv.Atoi(raw)
	if err != nil {
		return 0, err
	}
	if size < 1 {
		return 0, fmt.Errorf("chunk size must be at least 1, got %d", size)
	}
	return size, nil
}

func resolveRankingPurgeDryRun() (bool, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN"))
	if raw == "" {
		return false, nil
	}
	dryRun, err := strconv.ParseBool(raw)
	if err != nil {
		return false, errors.New("dry-run must be a boolean such as true or false")
	}
	return dryRun, nil
}
