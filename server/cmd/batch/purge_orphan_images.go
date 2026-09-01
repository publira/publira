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
	"github.com/publira/publira/server/internal/orphanimages"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/storage/s3"
)

func runPurgeOrphanImages(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	minAge, err := resolveOrphanImagesMinAge()
	if err != nil {
		logger.Error("invalid minimum object age", "error", err)
		return err
	}
	pageSize, err := resolveOrphanImagesPageSize()
	if err != nil {
		logger.Error("invalid page size", "error", err)
		return err
	}
	dryRun, err := resolveOrphanImagesDryRun()
	if err != nil {
		logger.Error("invalid dry-run flag", "error", err)
		return err
	}
	if err := cfg.Storage.Validate(); err != nil {
		logger.Error("invalid storage configuration", "error", err)
		return err
	}

	store, err := s3.New(ctx, s3.Config{
		Bucket:         cfg.Storage.S3Bucket,
		Region:         cfg.Storage.S3Region,
		Endpoint:       cfg.Storage.S3Endpoint,
		PublicBaseURL:  cfg.Storage.S3PublicBaseURL,
		ForcePathStyle: cfg.Storage.S3ForcePathStyle,
	})
	if err != nil {
		logger.Error("failed to initialize object storage", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveOrphanImagesDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	cutoff := time.Now().UTC().Add(-minAge)
	started := time.Now()
	result, err := orphanimages.New(db, store).Run(ctx, orphanimages.Options{
		Cutoff:   cutoff,
		PageSize: pageSize,
		DryRun:   dryRun,
	})
	if err != nil {
		logger.Error("orphan image reclamation failed",
			"cutoff", cutoff.Format(time.RFC3339),
			"dry_run", dryRun,
			"bucket", cfg.Storage.S3Bucket,
			"row_count", result.RowCount,
			"scanned_count", result.ScannedCount,
			"deleted_count", result.DeletedCount,
			"error", err,
		)
		return err
	}
	logger.Info("orphan image reclamation completed",
		"cutoff", cutoff.Format(time.RFC3339),
		"min_age", minAge,
		"page_size", pageSize,
		"bucket", cfg.Storage.S3Bucket,
		"dry_run", result.DryRun,
		"row_count", result.RowCount,
		"scanned_count", result.ScannedCount,
		"deleted_count", result.DeletedCount,
		"page_count", result.PageCount,
		"duration", time.Since(started),
	)
	return nil
}

func resolveOrphanImagesDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_ORPHAN_IMAGES_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
		"PUBLIRA_WORKER_DB_URL",
	)
}

func resolveOrphanImagesMinAge() (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS"))
	if raw == "" {
		return orphanimages.DefaultMinAge, nil
	}
	hours, err := strconv.Atoi(raw)
	if err != nil {
		return 0, err
	}
	// A zero or negative age would put the cutoff at or after now and make
	// every upload in flight a candidate for deletion.
	if hours < 1 {
		return 0, fmt.Errorf("minimum object age must be at least 1 hour, got %d", hours)
	}
	return time.Duration(hours) * time.Hour, nil
}

func resolveOrphanImagesPageSize() (int32, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE"))
	if raw == "" {
		return orphanimages.DefaultPageSize, nil
	}
	// The value becomes an S3 MaxKeys and a PostgreSQL array parameter, so a
	// width that could wrap negative is rejected before either sees it.
	size, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return 0, err
	}
	if size < 1 {
		return 0, fmt.Errorf("page size must be at least 1, got %d", size)
	}
	return int32(size), nil
}

func resolveOrphanImagesDryRun() (bool, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_ORPHAN_IMAGES_PURGE_DRY_RUN"))
	if raw == "" {
		return false, nil
	}
	dryRun, err := strconv.ParseBool(raw)
	if err != nil {
		return false, errors.New("dry-run must be a boolean such as true or false")
	}
	return dryRun, nil
}
