package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	serviceName = "publira-outbox-worker"

	defaultWorkerAddr  = ":8003"
	defaultWorkerDBURL = "postgres://postgres:password@db:5432/publira?sslmode=disable"
)

func main() {
	logger := logging.New(os.Stdout, nil)
	slog.SetDefault(logger)

	shutdownTracing, err := tracing.Setup(context.Background(), serviceName)
	if err != nil {
		logger.Error("failed to initialize tracing", "error", err)
	}

	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	db, err := sqldb.Open(resolveWorkerDBURL(cfg.DB.URL))
	if err != nil {
		logger.Error("failed to initialize db", "error", err)
		os.Exit(1)
	}
	defer db.Close() //nolint:errcheck

	var encryptor *secretcrypto.Manager
	if len(cfg.Encryption.Keys) > 0 {
		encryptor, err = secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
		if err != nil {
			logger.Error("failed to initialize secret encryption manager", "error", err)
			os.Exit(1)
		}
	}

	worker, err := outbox.Start(context.Background(), db, workerConfig(logger, outbox.TenantAdminInvitationHandlerConfig{
		DB:        db,
		Encryptor: encryptor,
		Mailer:    internalsmtp.NewClient(),
		Renderer:  emailrenderer.NewClient(resolveEmailRendererURL()),
	}))
	if err != nil {
		logger.Error("failed to start outbox worker", "error", err)
		os.Exit(1)
	}

	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(db), health.WithReady(worker.Ready))

	addr := strings.TrimSpace(os.Getenv("PUBLIRA_WORKER_ADDR"))
	if addr == "" {
		addr = defaultWorkerAddr
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("starting outbox worker", "addr", addr)
	if err := httpserver.Serve(ctx, logger, []*http.Server{
		httpserver.New(addr, mux),
	}, func(ctx context.Context) error {
		return worker.Stop(ctx)
	}, shutdownTracing, func(context.Context) error {
		return db.Close()
	}); err != nil {
		logger.Error("outbox worker failed", "error", err)
		os.Exit(1)
	}
}

func resolveWorkerDBURL(fallback string) string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_WORKER_DB_URL")); url != "" {
		return url
	}
	if strings.TrimSpace(fallback) != "" {
		return fallback
	}
	return defaultWorkerDBURL
}

func workerConfig(logger *slog.Logger, invitationHandler outbox.TenantAdminInvitationHandlerConfig) outbox.Config {
	handlers := outbox.DefaultRegistry()
	handlers.Register(outbox.EventTypeTenantAdminInvitationEmail, outbox.NewTenantAdminInvitationHandler(invitationHandler))
	return outbox.Config{
		Logger:            logger,
		Handlers:          handlers,
		DrainInterval:     envDuration("PUBLIRA_OUTBOX_DRAIN_INTERVAL", 0),
		ClaimLimit:        envInt32("PUBLIRA_OUTBOX_CLAIM_LIMIT", 0),
		MaxAttempts:       envInt("PUBLIRA_OUTBOX_MAX_ATTEMPTS", 0),
		StaleProcessing:   envDuration("PUBLIRA_OUTBOX_STALE_PROCESSING", 0),
		MaxWorkers:        envInt("PUBLIRA_OUTBOX_MAX_WORKERS", 0),
		FetchCooldown:     envDuration("PUBLIRA_OUTBOX_FETCH_COOLDOWN", 0),
		FetchPollInterval: envDuration("PUBLIRA_OUTBOX_FETCH_POLL_INTERVAL", 0),
	}
}

func resolveEmailRendererURL() string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_EMAIL_RENDERER_URL")); url != "" {
		return url
	}
	return emailrenderer.DefaultURL
}

func envDuration(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		return fallback
	}
	return d
}

func envInt(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return fallback
	}
	return n
}

func envInt32(name string, fallback int32) int32 {
	n := envInt(name, int(fallback))
	return int32(n)
}
