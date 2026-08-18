package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
)

const (
	defaultAdminServerURL     = ":8001"
	defaultAdminGrpcServerURL = ":8101"
	defaultAdminDBURL         = "postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

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

	db, err := openDB(resolveAdminDBURL())
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

	handler := adminapi.NewHandler(db, dbmodels.New(db), storageProvider, logger, encryptor, internalsmtp.NewClient(), tokens)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("starting admin api server (Connect)", "addr", addr)
	logger.Info("starting admin api server (gRPC)", "addr", grpcAddr)
	if err := httpserver.Serve(ctx, logger, []*http.Server{
		httpserver.New(addr, handler),
		httpserver.New(grpcAddr, handler),
	}, func(context.Context) error {
		return db.Close()
	}); err != nil {
		logger.Error("admin api server failed", "error", err)
		os.Exit(1)
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
