package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/publira/publira/server/api/publicapi"
	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage"
	localstorage "github.com/publira/publira/server/internal/storage/local"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
)

const (
	defaultPublicServerURL     = ":8000"
	defaultPublicGrpcServerURL = ":8100"
	defaultPublicDBURL         = "postgres://publira_public:publicpass@db:5432/publira?sslmode=disable"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}
	db, err := openDB(resolvePublicDBURL())
	if err != nil {
		logger.Error("failed to initialize db", "error", err)
		os.Exit(1)
	}
	defer db.Close() //nolint:errcheck
	storageProvider, err := newStorageProvider(context.Background(), cfg.Storage)
	if err != nil {
		logger.Error("failed to initialize storage provider", "error", err)
		os.Exit(1)
	}

	var encryptor *secretcrypto.Manager
	if len(cfg.Encryption.Keys) > 0 {
		encryptor, err = secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
		if err != nil {
			logger.Error("failed to initialize secret encryption manager", "error", err)
			os.Exit(1)
		}
	}

	addr := strings.TrimSpace(os.Getenv("PUBLIC_API_ADDR"))
	if addr == "" {
		addr = defaultPublicServerURL
	}

	grpcAddr := strings.TrimSpace(os.Getenv("PUBLIC_API_GRPC_ADDR"))
	if grpcAddr == "" {
		grpcAddr = defaultPublicGrpcServerURL
	}

	handler := publicapi.NewHandler(db, dbmodels.New(db), storageProvider, encryptor, internalsmtp.NewClient())

	// Start Connect server on public port
	logger.Info("starting public api server (Connect)", "addr", addr)
	connectServer := httpserver.New(addr, handler)

	// Start gRPC server on internal port
	logger.Info("starting public api server (gRPC)", "addr", grpcAddr)
	grpcServer := httpserver.New(grpcAddr, handler)

	// Run servers concurrently
	var wg sync.WaitGroup
	var connectErr, grpcErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		if err := connectServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			connectErr = err
			logger.Error("connect server failed", "error", err)
		}
	}()

	go func() {
		defer wg.Done()
		if err := grpcServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			grpcErr = err
			logger.Error("grpc server failed", "error", err)
		}
	}()

	wg.Wait()

	if connectErr != nil {
		os.Exit(1)
	}
	if grpcErr != nil {
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

func resolvePublicDBURL() string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_PUBLIC_DB_URL")); url != "" {
		return url
	}
	return defaultPublicDBURL
}

func newStorageProvider(ctx context.Context, cfg config.Storage) (storage.Provider, error) {
	switch cfg.Backend {
	case "local":
		return localstorage.New(cfg.LocalDir, cfg.LocalBaseURL)
	case "s3":
		if cfg.S3Bucket == "" {
			return nil, errors.New("S3_BUCKET is required when STORAGE_BACKEND=s3")
		}
		return s3storage.New(ctx, s3storage.Config{
			Bucket:         cfg.S3Bucket,
			Region:         cfg.S3Region,
			Endpoint:       cfg.S3Endpoint,
			PublicBaseURL:  cfg.S3PublicBaseURL,
			ForcePathStyle: cfg.S3ForcePathStyle,
		})
	default:
		return nil, fmt.Errorf("unsupported STORAGE_BACKEND: %s", cfg.Backend)
	}
}
