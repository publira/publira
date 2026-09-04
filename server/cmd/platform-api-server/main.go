package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/publira/publira/server/api/platformapi"
	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	serviceName = "publira-platform-api-server"

	defaultPlatformServerURL     = ":8002"
	defaultPlatformGrpcServerURL = ":8102"
	defaultPlatformDBURL         = "postgres://publira_platform:platformpass@db:5432/publira?sslmode=disable"
)

func main() {
	logger := logging.New(os.Stdout, nil)
	slog.SetDefault(logger)

	shutdownTracing, err := tracing.Setup(context.Background(), serviceName)
	if err != nil {
		// Telemetry is not worth refusing to serve traffic over.
		logger.Error("failed to initialize tracing", "error", err)
	}

	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	tokens, err := auth.NewTokenManagerFromEnv()
	if err != nil {
		logger.Error("failed to initialize access token manager", "error", err)
		os.Exit(1)
	}

	db, err := sqldb.Open(resolvePlatformDBURL())
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

	addr := strings.TrimSpace(os.Getenv("PUBLIRA_PLATFORM_API_ADDR"))
	if addr == "" {
		addr = defaultPlatformServerURL
	}

	grpcAddr := strings.TrimSpace(os.Getenv("PUBLIRA_PLATFORM_API_GRPC_ADDR"))
	if grpcAddr == "" {
		grpcAddr = defaultPlatformGrpcServerURL
	}

	recorder := auditlog.NewAsync(dbmodels.New(db), nil, logger)
	handler := platformapi.NewHandlerWithAsyncRecorder(db, dbmodels.New(db), logger, encryptor, internalsmtp.NewClient(), tokens, recorder)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("starting platform api server (Connect)", "addr", addr)
	logger.Info("starting platform api server (gRPC)", "addr", grpcAddr)
	if err := httpserver.Serve(ctx, logger, []*http.Server{
		httpserver.New(addr, handler),
		httpserver.New(grpcAddr, handler),
	}, recorder.Shutdown, shutdownTracing, func(context.Context) error {
		return db.Close()
	}); err != nil {
		logger.Error("platform api server failed", "error", err)
		os.Exit(1)
	}
}

func resolvePlatformDBURL() string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_PLATFORM_DB_URL")); url != "" {
		return url
	}
	return defaultPlatformDBURL
}
