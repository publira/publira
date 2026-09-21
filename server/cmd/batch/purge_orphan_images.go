package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/storage/s3"
)

func runPurgeOrphanImages(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	job, err := maintenance.LoadOrphanImagePurge()
	if err != nil {
		logger.Error("invalid orphan image purge settings", "error", err)
		return err
	}
	if job.DryRun, err = resolveDryRun("PUBLIRA_ORPHAN_IMAGES_PURGE_DRY_RUN"); err != nil {
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

	return job.Run(ctx, maintenance.Deps{
		DB:      db,
		Storage: store,
		Bucket:  cfg.Storage.S3Bucket,
		Logger:  logger,
	})
}

func resolveOrphanImagesDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_ORPHAN_IMAGES_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
	)
}
