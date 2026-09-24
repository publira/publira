package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/sqldb"
)

func runSyncGooglePlayVoidedPurchases(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	var secrets paymentsettings.SecretManager
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

	return maintenance.GooglePlayVoidedPurchaseSync{}.Run(ctx, maintenance.Deps{
		DB:         db,
		Secrets:    secrets,
		GooglePlay: googleplay.NewClient(googleplay.Config{}),
		Logger:     logger,
	})
}
