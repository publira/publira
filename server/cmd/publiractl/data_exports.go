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

func runBuildDataExports(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	return runDataExportJob(ctx, logger, cfg, maintenance.DataExportBuild{}.Run)
}

func runPurgeDataExports(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	dryRun, err := resolveDryRun("PUBLIRA_DATA_EXPORT_PURGE_DRY_RUN")
	if err != nil {
		logger.Error("invalid dry-run flag", "error", err)
		return err
	}
	return runDataExportJob(ctx, logger, cfg, maintenance.DataExportPurge{DryRun: dryRun}.Run)
}

// runDataExportJob runs a pass over the readers' archives, against the bucket
// saved in the platform's settings and read on the same connection.
func runDataExportJob(ctx context.Context, logger *slog.Logger, cfg *config.Config, run func(context.Context, maintenance.Deps) error) error {
	var secrets platformstorage.SecretManager
	if len(cfg.Encryption.Keys) > 0 {
		manager, err := secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
		if err != nil {
			logger.Error("failed to initialize secret encryption manager", "error", err)
			return err
		}
		secrets = manager
	}

	db, err := sqldb.Open(resolveContentStatsDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	bucket := platformstorage.New(platformstorage.Config{
		Queries: dbmodels.New(db),
		Secrets: secrets,
		Logger:  logger,
	}, platformstorage.NewStorage)
	return run(ctx, maintenance.Deps{
		DB:               db,
		DataExports:      platformstorage.Provider{Resolver: bucket},
		DataExportBucket: platformstorage.Reclaimers{Resolver: bucket},
		Logger:           logger,
	})
}
