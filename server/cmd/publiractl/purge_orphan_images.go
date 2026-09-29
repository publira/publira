package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/sqldb"
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
	var secrets platformstorage.SecretManager
	if len(cfg.Encryption.Keys) > 0 {
		manager, managerErr := secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
		if managerErr != nil {
			logger.Error("failed to initialize secret encryption manager", "error", managerErr)
			return managerErr
		}
		secrets = manager
	}

	db, err := sqldb.Open(resolveOrphanImagesDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	// A platform with no object store saved fails the run with
	// storage.ErrNotConfigured before any row is deleted.
	return job.Run(ctx, maintenance.Deps{
		DB: db,
		Storage: platformstorage.Reclaimers{Resolver: platformstorage.New(platformstorage.Config{
			Queries: dbmodels.New(db),
			Secrets: secrets,
			Logger:  logger,
		}, platformstorage.NewStorage)},
		Logger: logger,
	})
}

func resolveOrphanImagesDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_ORPHAN_IMAGES_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
	)
}
