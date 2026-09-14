package main

import (
	"context"
	"database/sql"
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
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/imageserver"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	serviceName = "publira-image-server"

	defaultImageServerAddr = ":8200"

	defaultPublicDBURL = "postgres://publira_public:publicpass@db:5432/publira?sslmode=disable"
	defaultAdminDBURL  = "postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable"
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

	// One pool per PostgreSQL login, because the login is what the database
	// enforces a site's reach with. Which pool a request lands on is decided
	// by the host it arrived on: a tenant's storefront is answered as
	// publira_public and its console as publira_admin.
	pools, err := openPools()
	if err != nil {
		logger.Error("failed to initialize db", "error", err)
		os.Exit(1)
	}
	defer pools.close() //nolint:errcheck

	objectStore, err := newObjectStore(context.Background(), cfg.Storage)
	if err != nil {
		logger.Error("failed to initialize object store", "error", err)
		os.Exit(1)
	}

	imageHandler, err := imageserver.NewHandler(
		dbmodels.New(pools.public),
		imageserver.SiteDB{Pool: pools.public, Tenants: imageserver.NewDBTenantScopedFactory(pools.public, logger)},
		imageserver.SiteDB{Pool: pools.admin, Tenants: imageserver.NewDBTenantScopedFactory(pools.admin, logger)},
		objectStore,
		logger,
		tokens,
	)
	if err != nil {
		logger.Error("failed to initialize image handler", "error", err)
		os.Exit(1)
	}

	addr := addrFromEnv("PUBLIRA_IMAGE_SERVER_ADDR", defaultImageServerAddr)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("starting image server", "addr", addr)
	if err := httpserver.Serve(ctx, logger, []*http.Server{
		httpserver.New(addr, tracing.HTTPMiddleware(imageHandler)),
	}, shutdownTracing, func(context.Context) error {
		return errors.Join(imageHandler.Close(), pools.close())
	}); err != nil {
		logger.Error("image server failed", "error", err)
		os.Exit(1)
	}
}

// dbPools is one pool per PostgreSQL login this process answers a site as.
type dbPools struct {
	public *sql.DB
	admin  *sql.DB
}

func openPools() (dbPools, error) {
	public, err := sqldb.Open(dbURLFromEnv("PUBLIRA_IMAGE_DB_URL", "PUBLIRA_PUBLIC_DB_URL", defaultPublicDBURL))
	if err != nil {
		return dbPools{}, err
	}
	admin, err := sqldb.Open(dbURLFromEnv("PUBLIRA_ADMIN_IMAGE_DB_URL", "PUBLIRA_ADMIN_DB_URL", defaultAdminDBURL))
	if err != nil {
		return dbPools{}, errors.Join(err, public.Close())
	}
	return dbPools{public: public, admin: admin}, nil
}

func (p dbPools) close() error {
	var errs []error
	for _, db := range []*sql.DB{p.public, p.admin} {
		if db != nil {
			errs = append(errs, db.Close())
		}
	}
	return errors.Join(errs...)
}

func dbURLFromEnv(name, sharedName, fallback string) string {
	if url := strings.TrimSpace(os.Getenv(name)); url != "" {
		return url
	}
	if url := strings.TrimSpace(os.Getenv(sharedName)); url != "" {
		return url
	}
	return fallback
}

func addrFromEnv(name, fallback string) string {
	if addr := strings.TrimSpace(os.Getenv(name)); addr != "" {
		return addr
	}
	return fallback
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
