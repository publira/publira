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
	"github.com/publira/publira/server/internal/contentevents"
	"github.com/publira/publira/server/internal/sqldb"
)

func runProjectEpisodeReads(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	batchSize, err := resolveProjectionBatchSize()
	if err != nil {
		logger.Error("invalid projection batch size", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveEpisodeReadProjectionDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	started := time.Now()
	result, err := contentevents.NewProjector(db).Run(ctx, contentevents.ProjectionOptions{
		BatchSize: batchSize,
	})
	if err != nil {
		logger.Error("episode read projection failed",
			"batch_size", batchSize,
			"row_count", result.RowCount,
			"error", err,
		)
		return err
	}
	logger.Info("episode read projection completed",
		"batch_size", batchSize,
		"row_count", result.RowCount,
		"batch_count", result.BatchCount,
		"duration", time.Since(started),
	)
	return nil
}

func resolveEpisodeReadProjectionDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_EPISODE_READ_PROJECTION_DB_URL",
		"PUBLIRA_CONTENT_EVENTS_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
		"PUBLIRA_WORKER_DB_URL",
	)
}

// resolveProjectionBatchSize parses into 32 bits, so a value the PostgreSQL
// LIMIT could not hold is rejected here rather than wrapping into a negative
// limit on the way to the database.
func resolveProjectionBatchSize() (int32, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_EPISODE_READ_PROJECTION_BATCH_SIZE"))
	if raw == "" {
		return contentevents.DefaultProjectionBatchSize, nil
	}
	size, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return 0, err
	}
	if size < 1 {
		return 0, fmt.Errorf("batch size must be at least 1, got %d", size)
	}
	return int32(size), nil
}
