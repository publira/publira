package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"

	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/publira/publira/server/internal/apiserver"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/storage"
	localstorage "github.com/publira/publira/server/internal/storage/local"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
)

const defaultDBURL = "postgres://postgres:password@db:5432/publira?sslmode=disable"

func newStorageProvider(ctx context.Context) (storage.Provider, error) {
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("STORAGE_BACKEND")))
	if backend == "" {
		backend = "local"
	}

	switch backend {
	case "local":
		rootDir := strings.TrimSpace(os.Getenv("LOCAL_STORAGE_DIR"))
		if rootDir == "" {
			rootDir = "/tmp/publira-storage"
		}
		baseURL := strings.TrimSpace(os.Getenv("LOCAL_STORAGE_BASE_URL"))
		return localstorage.New(rootDir, baseURL)
	case "s3":
		bucket := strings.TrimSpace(os.Getenv("S3_BUCKET"))
		if bucket == "" {
			return nil, errors.New("S3_BUCKET is required when STORAGE_BACKEND=s3")
		}
		forcePathStyle := false
		if raw := strings.TrimSpace(os.Getenv("S3_FORCE_PATH_STYLE")); raw != "" {
			parsed, err := strconv.ParseBool(raw)
			if err != nil {
				return nil, fmt.Errorf("invalid S3_FORCE_PATH_STYLE: %w", err)
			}
			forcePathStyle = parsed
		}
		return s3storage.New(ctx, s3storage.Config{
			Bucket:         bucket,
			Region:         strings.TrimSpace(os.Getenv("AWS_REGION")),
			Endpoint:       strings.TrimSpace(os.Getenv("S3_ENDPOINT")),
			PublicBaseURL:  strings.TrimSpace(os.Getenv("S3_PUBLIC_BASE_URL")),
			ForcePathStyle: forcePathStyle,
		})
	default:
		return nil, fmt.Errorf("unsupported STORAGE_BACKEND: %s", backend)
	}
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	dbURL := strings.TrimSpace(os.Getenv("DB_URL"))
	if dbURL == "" {
		dbURL = defaultDBURL
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		logger.Error("failed to open db", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		logger.Error("failed to ping db", "error", err)
		os.Exit(1)
	}
	storageProvider, err := newStorageProvider(context.Background())
	if err != nil {
		logger.Error("failed to initialize storage provider", "error", err)
		os.Exit(1)
	}
	handler := apiserver.NewHandler(dbmodels.New(db), storageProvider)
	logger.Info("starting api server", "addr", ":8080")
	if err := http.ListenAndServe(":8080", h2c.NewHandler(handler, &http2.Server{})); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}
