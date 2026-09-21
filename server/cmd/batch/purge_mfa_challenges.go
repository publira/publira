package main

import (
	"context"
	"log/slog"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/sqldb"
)

func runPurgeMfaChallenges(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	job, err := maintenance.LoadMfaChallengePurge()
	if err != nil {
		logger.Error("invalid mfa challenge purge settings", "error", err)
		return err
	}
	if job.DryRun, err = resolveDryRun("PUBLIRA_MFA_CHALLENGE_PURGE_DRY_RUN"); err != nil {
		logger.Error("invalid dry-run flag", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveMfaChallengeDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	return job.Run(ctx, maintenance.Deps{DB: db, Logger: logger})
}

func resolveMfaChallengeDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_MFA_CHALLENGE_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
	)
}
