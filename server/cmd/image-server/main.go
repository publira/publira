package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/imageserver"
)

const (
	defaultImageServerAddr = ":8200"
	defaultPublicDBURL     = "postgres://publira_public:publicpass@db:5432/publira?sslmode=disable"
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

	db, err := openDB(resolveImageDBURL())
	if err != nil {
		logger.Error("failed to initialize db", "error", err)
		os.Exit(1)
	}
	defer db.Close() //nolint:errcheck

	objectStore, err := newObjectStore(context.Background(), cfg.Storage)
	if err != nil {
		logger.Error("failed to initialize object store", "error", err)
		os.Exit(1)
	}

	resolverQueries := dbmodels.New(db)
	tenantFactory := imageserver.NewDBTenantScopedFactory(db, logger)

	imageHandler := imageserver.NewHandler(
		resolverQueries,
		tenantFactory,
		objectStore,
		logger,
		db,
		tokens,
	)

	addr := strings.TrimSpace(os.Getenv("PUBLIRA_IMAGE_SERVER_ADDR"))
	if addr == "" {
		addr = defaultImageServerAddr
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("starting image server", "addr", addr)
	if err := httpserver.Serve(ctx, logger, []*http.Server{httpserver.New(addr, imageHandler)}); err != nil {
		logger.Error("image server failed", "error", err)
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

func resolveImageDBURL() string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_IMAGE_DB_URL")); url != "" {
		return url
	}
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_PUBLIC_DB_URL")); url != "" {
		return url
	}
	return defaultPublicDBURL
}

func newObjectStore(ctx context.Context, cfg config.Storage) (imageserver.ObjectStore, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	loadOptions := make([]func(*awsconfig.LoadOptions) error, 0, 1)
	if cfg.S3Region != "" {
		loadOptions = append(loadOptions, awsconfig.WithRegion(cfg.S3Region))
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, loadOptions...)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = cfg.S3ForcePathStyle
		if cfg.S3Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.S3Endpoint)
		}
	})

	return imageserver.NewS3Store(client, cfg.S3Bucket), nil
}
