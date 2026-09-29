package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/sqldb"
)

func runCloseRoyaltyStatements(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	db, err := sqldb.Open(resolveContentStatsDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	return maintenance.RoyaltyStatementClose{}.Run(ctx, maintenance.Deps{DB: db, Logger: logger})
}
