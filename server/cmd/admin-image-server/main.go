package main

import (
	"context"
	"errors"
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

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/imageserver"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	serviceName = "publira-admin-image-server"

	defaultAdminImageServerAddr = ":8201"
	defaultAdminDBURL           = "postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable"
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

	db, err := sqldb.Open(resolveAdminImageDBURL())
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

	imageHandler, err := imageserver.NewAdminHandler(
		resolverQueries,
		tenantFactory,
		objectStore,
		logger,
		db,
		tokens,
	)
	if err != nil {
		logger.Error("failed to initialize image handler", "error", err)
		os.Exit(1)
	}

	addr := strings.TrimSpace(os.Getenv("PUBLIRA_ADMIN_IMAGE_SERVER_ADDR"))
	if addr == "" {
		addr = defaultAdminImageServerAddr
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("starting admin image server", "addr", addr)
	if err := httpserver.Serve(ctx, logger, []*http.Server{
		httpserver.New(addr, tracing.HTTPMiddleware(imageHandler)),
	}, shutdownTracing, func(context.Context) error {
		return errors.Join(imageHandler.Close(), db.Close())
	}); err != nil {
		logger.Error("admin image server failed", "error", err)
		os.Exit(1)
	}
}

func resolveAdminImageDBURL() string {
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_ADMIN_IMAGE_DB_URL")); url != "" {
		return url
	}
	if url := strings.TrimSpace(os.Getenv("PUBLIRA_ADMIN_DB_URL")); url != "" {
		return url
	}
	return defaultAdminDBURL
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
