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

	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/config"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/storage"
	localstorage "github.com/publira/publira/server/internal/storage/local"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
)

const (
	defaultAdminServerURL = ":8001"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}
	db, err := openDB(cfg.DB.URL)
	if err != nil {
		logger.Error("failed to initialize db", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	storageProvider, err := newStorageProvider(context.Background(), cfg.Storage)
	if err != nil {
		logger.Error("failed to initialize storage provider", "error", err)
		os.Exit(1)
	}

	addr := strings.TrimSpace(os.Getenv("ADMIN_API_ADDR"))
	if addr == "" {
		addr = defaultAdminServerURL
	}

	handler := adminapi.NewHandler(dbmodels.New(db), storageProvider, logger)
	logger.Info("starting admin api server", "addr", addr)
	if err := http.ListenAndServe(addr, h2c.NewHandler(handler, &http2.Server{})); err != nil {
		logger.Error("server failed", "error", err)
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
