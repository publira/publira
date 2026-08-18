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
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/publishepisodes"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	serviceName = "publira-publish-episodes"

	defaultIntervalSeconds = 60
	defaultMaxRetries      = 3
	defaultWorkerDBURL     = "postgres://postgres:password@db:5432/publira?sslmode=disable"
)

func main() {
	logger := logging.New(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})
	slog.SetDefault(logger)

	shutdownTracing, err := tracing.Setup(context.Background(), serviceName)
	if err != nil {
		// Telemetry is not worth refusing to run the batch over.
		logger.Error("failed to initialize tracing", "error", err)
	}
	defer func() {
		if err := shutdownTracing(context.Background()); err != nil {
			logger.Error("failed to flush pending spans", "error", err)
		}
	}()

	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	dbURL := cfg.DB.URL
	if dbURL == "" {
		dbURL = defaultWorkerDBURL
	}

	db, err := sqldb.Open(dbURL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close() //nolint:errcheck

	interval := resolveInterval()
	maxRetries := resolveMaxRetries()

	revalidateToken := strings.TrimSpace(os.Getenv("PUBLIRA_REVALIDATE_TOKEN"))
	reval := revalidate.NewClient(revalidateToken, logger)
	if reval == nil {
		logger.Info("next revalidate is disabled", "reason", "PUBLIRA_REVALIDATE_TOKEN is empty")
	}

	runner := publishepisodes.New(db, dbmodels.New(db), reval, logger, maxRetries)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
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
			return
		case <-ticker.C:
			runner.RunOnce(ctx)
		}
	}
}

func resolveInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_PUBLISH_INTERVAL_SECONDS"))
	if raw == "" {
		return defaultIntervalSeconds * time.Second
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return defaultIntervalSeconds * time.Second
	}
	return time.Duration(n) * time.Second
}

func resolveMaxRetries() int {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_PUBLISH_MAX_RETRIES"))
	if raw == "" {
		return defaultMaxRetries
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return defaultMaxRetries
	}
	return n
}
