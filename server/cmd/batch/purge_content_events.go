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
	"github.com/publira/publira/server/internal/contentevents"
	"github.com/publira/publira/server/internal/sqldb"
)

const defaultRetentionDays = 90

func runPurgeContentEvents(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	retentionDays, err := resolveRetentionDays()
	if err != nil {
		logger.Error("invalid retention window", "error", err)
		return err
	}
	chunkSize, err := resolveChunkSize()
	if err != nil {
		logger.Error("invalid chunk size", "error", err)
		return err
	}
	dryRun, err := resolveDryRun()
	if err != nil {
		logger.Error("invalid dry-run flag", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveContentEventsDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	cutoff := time.Now().UTC().AddDate(0, 0, -retentionDays)
	started := time.Now()
	result, err := contentevents.New(db).Run(ctx, contentevents.Options{
		Cutoff:    cutoff,
		ChunkSize: chunkSize,
		DryRun:    dryRun,
	})
	if err != nil {
		logger.Error("content events purge failed",
			"cutoff", cutoff.Format(time.RFC3339),
			"dry_run", dryRun,
			"row_count", result.RowCount,
			"error", err,
		)
		return err
	}
	logger.Info("content events purge completed",
		"cutoff", cutoff.Format(time.RFC3339),
		"retention_days", retentionDays,
		"chunk_size", chunkSize,
		"dry_run", result.DryRun,
		"row_count", result.RowCount,
		"chunk_count", result.ChunkCount,
		"duration", time.Since(started),
	)
	return nil
}

func resolveContentEventsDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_CONTENT_EVENTS_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
		"PUBLIRA_WORKER_DB_URL",
	)
}

func resolveRetentionDays() (int, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_CONTENT_EVENTS_RETENTION_DAYS"))
	if raw == "" {
		return defaultRetentionDays, nil
	}
	days, err := strconv.Atoi(raw)
	if err != nil {
		return 0, err
	}
	// A zero or negative window would put the cutoff at or after now and take
	// the whole table with it, which is never what a retention setting means.
	if days < 1 {
		return 0, fmt.Errorf("retention days must be at least 1, got %d", days)
	}
	return days, nil
}

func resolveChunkSize() (int, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE"))
	if raw == "" {
		return contentevents.DefaultChunkSize, nil
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

func resolveDryRun() (bool, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN"))
	if raw == "" {
		return false, nil
	}
	dryRun, err := strconv.ParseBool(raw)
	if err != nil {
		return false, errors.New("dry-run must be a boolean such as true or false")
	}
	return dryRun, nil
}
