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
	"github.com/publira/publira/server/internal/mfachallenges"
	"github.com/publira/publira/server/internal/sqldb"
)

// The purge has no retention window of its own: a spent challenge is kept
// only to refuse the token it names, and that token expires five minutes
// after login. The cutoff is therefore the current time.
func runPurgeMfaChallenges(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	chunkSize, err := resolveMfaChallengePurgeChunkSize()
	if err != nil {
		logger.Error("invalid chunk size", "error", err)
		return err
	}
	dryRun, err := resolveMfaChallengePurgeDryRun()
	if err != nil {
		logger.Error("invalid dry-run flag", "error", err)
		return err
	}

	db, err := sqldb.Open(resolveMfaChallengeDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	cutoff := time.Now().UTC()
	started := time.Now()
	result, err := mfachallenges.New(db).Run(ctx, mfachallenges.Options{
		Cutoff:    cutoff,
		ChunkSize: chunkSize,
		DryRun:    dryRun,
	})
	if err != nil {
		logger.Error("mfa challenge purge failed",
			"cutoff", cutoff.Format(time.RFC3339),
			"dry_run", dryRun,
			"row_count", result.RowCount,
			"error", err,
		)
		return err
	}
	logger.Info("mfa challenge purge completed",
		"cutoff", cutoff.Format(time.RFC3339),
		"chunk_size", chunkSize,
		"dry_run", result.DryRun,
		"row_count", result.RowCount,
		"chunk_count", result.ChunkCount,
		"duration", time.Since(started),
	)
	return nil
}

func resolveMfaChallengeDBURL(fallback string) string {
	return resolveDBURL(fallback,
		"PUBLIRA_MFA_CHALLENGE_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
		"PUBLIRA_WORKER_DB_URL",
	)
}

func resolveMfaChallengePurgeChunkSize() (int, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE"))
	if raw == "" {
		return mfachallenges.DefaultChunkSize, nil
	}
	size, err := strconv.Atoi(raw)
	if err != nil {
		return 0, err
	}
	if size < 1 {
		return 0, fmt.Errorf("chunk size must be at least 1, got %d", size)
	}
	return size, nil
}

func resolveMfaChallengePurgeDryRun() (bool, error) {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_MFA_CHALLENGE_PURGE_DRY_RUN"))
	if raw == "" {
		return false, nil
	}
	dryRun, err := strconv.ParseBool(raw)
	if err != nil {
		return false, errors.New("dry-run must be a boolean such as true or false")
	}
	return dryRun, nil
}
