package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/publishepisodes"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/sqldb"
)

const (
	defaultPublishIntervalSeconds = 60
	defaultPublishMaxRetries      = 3
)

func runPublishEpisodes(ctx context.Context, logger *slog.Logger, cfg *config.Config) error {
	db, err := sqldb.Open(cfg.DB.URL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		return err
	}
	defer db.Close() //nolint:errcheck

	interval := resolvePublishInterval()
	maxRetries := resolvePublishMaxRetries()

	revalidateToken := strings.TrimSpace(os.Getenv("PUBLIRA_REVALIDATE_TOKEN"))
	reval, revalidateErr := revalidate.NewClient(revalidateToken, logger)
	if revalidateErr != nil {
		logger.Warn("next revalidate is disabled", "reason", revalidateErr.Error())
	} else if reval == nil {
		logger.Info("next revalidate is disabled", "reason", "PUBLIRA_REVALIDATE_TOKEN is empty")
	}

	runner := publishepisodes.New(db, dbmodels.New(db), reval, logger, maxRetries)

	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("publish-episodes worker started", "interval", interval, "max_retries", maxRetries)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately on startup, then on each tick.
	runner.RunOnce(ctx)

	for {
		select {
		case <-ctx.Done():
			logger.Info("shutting down publish-episodes worker")
			return nil
		case <-ticker.C:
			runner.RunOnce(ctx)
		}
	}
}

func resolvePublishInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_PUBLISH_INTERVAL_SECONDS"))
	if raw == "" {
		return defaultPublishIntervalSeconds * time.Second
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultPublishIntervalSeconds * time.Second
	}
	return time.Duration(n) * time.Second
}

func resolvePublishMaxRetries() int {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_PUBLISH_MAX_RETRIES"))
	if raw == "" {
		return defaultPublishMaxRetries
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return defaultPublishMaxRetries
	}
	return n
}
