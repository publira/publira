package main

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/publishepisodes"
	"github.com/publira/publira/server/internal/revalidate"
)

const (
	defaultIntervalSeconds = 60
	defaultMaxRetries      = 3
	defaultWorkerDBURL     = "postgres://postgres:password@db:5432/publira?sslmode=disable"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	dbURL := cfg.DB.URL
	if dbURL == "" {
		dbURL = defaultWorkerDBURL
	}

	db, err := openDB(dbURL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close() //nolint:errcheck

	interval := resolveInterval()
	maxRetries := resolveMaxRetries()

	revalidateToken := strings.TrimSpace(os.Getenv("NEXT_REVALIDATE_TOKEN"))
	reval := revalidate.NewClient(revalidateToken, logger)
	if reval == nil {
		logger.Info("next revalidate is disabled", "reason", "NEXT_REVALIDATE_TOKEN is empty")
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

func openDB(url string) (*sql.DB, error) {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func resolveInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("PUBLISH_INTERVAL_SECONDS"))
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
	raw := strings.TrimSpace(os.Getenv("PUBLISH_MAX_RETRIES"))
	if raw == "" {
		return defaultMaxRetries
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return defaultMaxRetries
	}
	return n
}
