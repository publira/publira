package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/appstore"
	"github.com/publira/publira/server/internal/googleplay"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/paymentsettings"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/sqldb"
)

func runReconcilePayments(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	var secrets paymentsettings.SecretManager
	if len(cfg.Encryption.Keys) > 0 {
		manager, err := secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
		if err != nil {
			logger.Error("failed to initialize secret encryption manager", "error", err)
			return err
		}
		secrets = manager
	}
	paymentsConfig, err := providers.ConfigFromEnv()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveContentStatsDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	return maintenance.PaymentReconciliation{}.Run(ctx, maintenance.Deps{
		DB:               db,
		Secrets:          secrets,
		Payments:         providers.New(paymentsConfig),
		AppStore:         appstore.NewClient(appstore.Config{}),
		AppStoreVerifier: appstore.NewVerifier(),
		GooglePlay:       googleplay.NewClient(googleplay.Config{}),
		Logger:           logger,
	})
}
