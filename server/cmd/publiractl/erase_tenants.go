package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/redisurl"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/tenanterasure"
)

// runEraseTenants erases the tenants operators asked to delete, against the
// bucket and the search engine saved in the platform's settings and the Redis
// PUBLIRA_REDIS_URL names, the one the API processes share.
func runEraseTenants(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	var secrets *secretcrypto.Manager
	if len(cfg.Encryption.Keys) > 0 {
		manager, err := secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
		if err != nil {
			logger.Error("failed to initialize secret encryption manager", "error", err)
			return err
		}
		secrets = manager
	}

	redisURL, err := redisurl.FromEnv()
	if err != nil {
		logger.Error("invalid redis url", "error", err)
		return err
	}
	deps := maintenance.Deps{Logger: logger}
	if redisURL != "" {
		cache, err := tenanterasure.NewRedisCache(redisURL)
		if err != nil {
			logger.Error("invalid redis url", "error", fmt.Errorf("%s: %w", redisurl.Env, err))
			return err
		}
		defer cache.Close() //nolint:errcheck
		deps.TenantCache = cache
	}

	db, err := sqldb.Open(resolveContentStatsDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck
	deps.DB = db

	storageConfig := platformstorage.Config{Queries: dbmodels.New(db), Logger: logger}
	if secrets != nil {
		storageConfig.Secrets = secrets
		deps.Secrets = secrets
	}
	reclaimers := platformstorage.Reclaimers{Resolver: platformstorage.New(storageConfig, platformstorage.NewStorage)}
	deps.Storage = reclaimers
	deps.DataExportBucket = reclaimers
	return maintenance.TenantErasure{}.Run(ctx, deps)
}
