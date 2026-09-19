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
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/retention"
	"github.com/publira/publira/server/internal/sqldb"
)

func runPurgeContentEvents(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
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

	table, err := retention.LoadTable(ctx, dbmodels.New(db))
	if err != nil {
		logger.Error("failed to read retention periods", "error", err)
		return err
	}

	now := time.Now().UTC()
	started := time.Now()
	result, err := contentevents.New(db).Run(ctx, contentevents.Options{
		Now:       now,
		Retention: table,
		ChunkSize: chunkSize,
		DryRun:    dryRun,
	})
	if err != nil {
		logger.Error("content events purge failed",
			"now", now.Format(time.RFC3339),
			"dry_run", dryRun,
			"tenant_count", result.TenantCount,
			"row_count", result.RowCount,
			"error", err,
		)
		return err
	}
	logger.Info("content events purge completed",
		"now", now.Format(time.RFC3339),
		"default_retention_days", table.Defaults().ContentEventDays,
		"tenant_override_count", table.OverrideCount(),
		"chunk_size", chunkSize,
		"dry_run", result.DryRun,
		"tenant_count", result.TenantCount,
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
	)
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
