package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/storage"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	serviceName = "publira-admin-api-server"

	defaultAdminServerURL     = ":8001"
	defaultAdminGrpcServerURL = ":8101"
	defaultAdminDBURL         = "postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable"
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

	db, err := sqldb.Open(resolveAdminDBURL())
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
	storageProvider, err := newStorageProvider(context.Background(), cfg.Storage)
	if err != nil {
		logger.Error("failed to initialize storage provider", "error", err)
		os.Exit(1)
	}

	addr := strings.TrimSpace(os.Getenv("PUBLIRA_ADMIN_API_ADDR"))
	if addr == "" {
		addr = defaultAdminServerURL
	}

	grpcAddr := strings.TrimSpace(os.Getenv("PUBLIRA_ADMIN_API_GRPC_ADDR"))
	if grpcAddr == "" {
		grpcAddr = defaultAdminGrpcServerURL
	}

	recorder := auditlog.NewAsync(dbmodels.New(db), db, logger)
	handler := adminapi.NewHandlerWithAsyncRecorder(db, dbmodels.New(db), storageProvider, logger, encryptor, internalsmtp.NewClient(), tokens, recorder)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("starting admin api server (Connect)", "addr", addr)
	logger.Info("starting admin api server (gRPC)", "addr", grpcAddr)
	if err := httpserver.Serve(ctx, logger, []*http.Server{
		httpserver.New(addr, handler),
		httpserver.New(grpcAddr, handler),
	}, recorder.Shutdown, shutdownTracing, func(context.Context) error {
		return db.Close()
	}); err != nil {
		logger.Error("admin api server failed", "error", err)
		os.Exit(1)
	}
}

func resolveAdminDBURL() string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_ADMIN_DB_URL")); url != "" {
		return url
	}
	return defaultAdminDBURL
}

func newStorageProvider(ctx context.Context, cfg config.Storage) (storage.Provider, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return s3storage.New(ctx, s3storage.Config{
		Bucket:         cfg.S3Bucket,
		Region:         cfg.S3Region,
		Endpoint:       cfg.S3Endpoint,
		PublicBaseURL:  cfg.S3PublicBaseURL,
		ForcePathStyle: cfg.S3ForcePathStyle,
	})
}
