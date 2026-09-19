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
	"github.com/publira/publira/server/internal/commentretention"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/retention"
	"github.com/publira/publira/server/internal/sqldb"
)

func runPurgeWithdrawnComments(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	chunkSize, err := resolveCommentPurgeChunkSize()
	if err != nil {
		logger.Error("invalid chunk size", "error", err)
		return err
	}
	dryRun, err := resolveCommentPurgeDryRun()
	if err != nil {
		logger.Error("invalid dry-run flag", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveCommentPurgeDBURL(cfg.DB.URL))
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
	result, err := commentretention.NewPurger(db).Run(ctx, commentretention.PurgeOptions{
		Now:       now,
		Retention: table,
		ChunkSize: chunkSize,
		DryRun:    dryRun,
	})
	if err != nil {
		logger.Error("withdrawn comment purge failed",
			"now", now.Format(time.RFC3339),
			"dry_run", dryRun,
			"tenant_count", result.TenantCount,
			"row_count", result.RowCount,
			"chunk_count", result.ChunkCount,
			"duration", time.Since(started),
			"error", err,
		)
		return err
	}
	logger.Info("withdrawn comment purge completed",
		"now", now.Format(time.RFC3339),
		"default_retention_days", table.Defaults().WithdrawnCommentDays,
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

func resolveCommentPurgeDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_COMMENT_PURGE_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
	)
}

func resolveCommentPurgeChunkSize() (int32, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_COMMENT_PURGE_CHUNK_SIZE"))
	if raw == "" {
		return commentretention.DefaultPurgeChunkSize, nil
	}
	size, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return 0, err
	}
	if size < 1 {
		return 0, fmt.Errorf("chunk size must be at least 1, got %d", size)
	}
	return int32(size), nil
}

func resolveCommentPurgeDryRun() (bool, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_COMMENT_PURGE_DRY_RUN"))
	if raw == "" {
		return false, nil
	}
	dryRun, err := strconv.ParseBool(raw)
	if err != nil {
		return false, errors.New("dry-run must be a boolean such as true or false")
	}
	return dryRun, nil
}
