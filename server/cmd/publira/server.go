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
	"syscall"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/api/platformapi"
	"github.com/publira/publira/server/api/publicapi"
	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/imageserver"
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/redisurl"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/sqldb"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	defaultEdgeAddr     = ":8000"
	defaultInternalAddr = ":8100"

	defaultPublicDBURL   = "postgres://publira_public:publicpass@db:5432/publira?sslmode=disable"
	defaultAdminDBURL    = "postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable"
	defaultPlatformDBURL = "postgres://publira_platform:platformpass@db:5432/publira?sslmode=disable"
)

// runServer serves the API and image delivery from one process: the edge
// listener carries what the reverse proxy forwards, /api and /images alike,
// and the internal listener carries the three Connect namespaces the Next.js
// apps dial directly.
func runServer() int {
	logger := logging.New(os.Stdout, nil)
	slog.SetDefault(logger)

	// One service.name per Connect namespace, and one for the image routes,
	// so the four stay apart in a trace UI now that they share a process.
	shutdownTracing, err := tracing.Setup(
		context.Background(),
		publicapi.ServiceName,
		adminapi.ServiceName,
		platformapi.ServiceName,
		imageserver.ServiceName,
	)
	if err != nil {
		// Telemetry is not worth refusing to serve traffic over.
		logger.Error("failed to initialize tracing", "error", err)
	}

	cfg, err := config.New()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		return 1
	}

	// Refused here rather than where Redis is dialled, which falls back to
	// in-process state and would leave the misconfiguration running.
	if _, err := redisurl.FromEnv(); err != nil {
		logger.Error("failed to load config", "error", err)
		return 1
	}

	tokens, err := auth.NewTokenManagerFromEnv()
	if err != nil {
		logger.Error("failed to initialize access token manager", "error", err)
		return 1
	}

	// One client for the whole process, shared by the two namespaces whose
	// writes leave a cache entry stale.
	revalidateClient, err := newRevalidateClient(logger)
	if err != nil {
		logger.Error("failed to initialize next revalidate", "error", err)
		return 1
	}

	// One pool per PostgreSQL login, because the login is what the database
	// enforces a namespace's reach with: publira_public and publira_admin are
	// subject to row-level security and publira_platform bypasses it. Which
	// pool a request lands on is decided by the namespace its procedure path
	// names, or for an image by the host it arrived on — a tenant's storefront
	// is answered as publira_public and its console as publira_admin — so a
	// mux entry is also a database role, and image delivery shares the pool of
	// the login it answers as rather than opening a second one for it.
	pools, err := openServerPools()
	if err != nil {
		logger.Error("failed to initialize db", "error", err)
		return 1
	}
	defer pools.close() //nolint:errcheck

	// Declared as the interface, never as *secretcrypto.Manager: a typed nil
	// assigned to an interface is not nil, and it would slip past the guard in
	// emailsettings.DecryptPassword into a nil-receiver method call. A process
	// started without keys has to report an unusable manager, so a handler can
	// retry once an operator restarts it with them.
	var encryptor emailsettings.SecretManager
	if len(cfg.Encryption.Keys) > 0 {
		manager, managerErr := secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
		if managerErr != nil {
			logger.Error("failed to initialize secret encryption manager", "error", managerErr)
			return 1
		}
		encryptor = manager
	}

	// The object store is read from the platform's settings on the platform
	// pool, the one login here that may read them, so this process starts
	// before an operator has saved one and an upload until then is refused.
	storageProvider := platformstorage.Provider{Resolver: platformstorage.New(platformstorage.Config{
		Queries: dbmodels.New(pools.platform),
		Secrets: encryptor,
		Logger:  logger,
	}, platformstorage.NewStorage)}

	publicAPI, err := publicapi.New(pools.public, dbmodels.New(pools.public), encryptor, tokens, revalidateClient)
	if err != nil {
		logger.Error("failed to initialize public api handler", "error", err)
		return 1
	}

	smtpTester := internalsmtp.NewClient()

	adminRecorder := auditlog.NewAsync(dbmodels.New(pools.admin), pools.admin, logger)
	adminAPI, err := adminapi.NewWithAsyncRecorder(pools.admin, dbmodels.New(pools.admin), storageProvider, logger, encryptor, smtpTester, tokens, revalidateClient, adminRecorder)
	if err != nil {
		logger.Error("failed to initialize admin api handler", "error", err)
		return 1
	}

	platformRecorder := auditlog.NewAsync(dbmodels.New(pools.platform), nil, logger)
	platformAPI := platformapi.NewWithAsyncRecorder(pools.platform, dbmodels.New(pools.platform), logger, encryptor, smtpTester, tokens, platformRecorder)

	imageHandler, err := imageserver.NewHandler(
		dbmodels.New(pools.public),
		imageserver.SiteDB{Pool: pools.public, Tenants: imageserver.NewDBTenantScopedFactory(pools.public, logger)},
		imageserver.SiteDB{Pool: pools.admin, Tenants: imageserver.NewDBTenantScopedFactory(pools.admin, logger)},
		newImageObjectStore(encryptor, pools.admin, logger),
		logger,
		tokens,
	)
	if err != nil {
		logger.Error("failed to initialize image handler", "error", err)
		return 1
	}

	edgeAddr := addrFromEnv("PUBLIRA_PUBLIC_API_ADDR", defaultEdgeAddr)
	internalAddr := addrFromEnv("PUBLIRA_PUBLIC_API_GRPC_ADDR", defaultInternalAddr)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("starting server (edge)", "addr", edgeAddr)
	logger.Info("starting server (internal)", "addr", internalAddr)
	if err := httpserver.Serve(ctx, logger, []*http.Server{
		httpserver.New(edgeAddr, edgeHandler(publicAPI, imageHandler, pools)),
		httpserver.New(internalAddr, internalHandler(publicAPI, adminAPI, platformAPI, pools)),
	}, adminRecorder.Shutdown, platformRecorder.Shutdown, shutdownTracing, func(context.Context) error {
		return errors.Join(imageHandler.Close(), pools.close())
	}); err != nil {
		logger.Error("server failed", "error", err)
		return 1
	}
	return 0
}

// edgeHandler serves what the internet may reach: the public API under /api
// and image delivery under /images, which the edge forwards with their
// prefixes kept. Registering either console namespace here would publish its
// RPCs on every tenant site, and readiness names only the public pool, the one
// whose state an outsider may read.
func edgeHandler(publicAPI *publicapi.API, images *imageserver.Server, pools serverPools) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(pools.public))
	api := http.NewServeMux()
	publicAPI.Register(api)
	mux.Handle("/api/", http.StripPrefix("/api", api))
	images.Register(mux)
	return mux
}

// internalHandler serves all three namespaces to the Next.js apps, which dial
// it directly over the private network. Readiness names one check per pool:
// with three logins behind one listener, a single "db" could not say which of
// them stopped answering.
func internalHandler(publicAPI *publicapi.API, adminAPI *adminapi.API, platformAPI *platformapi.API, pools serverPools) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux,
		health.WithDBNamed("db.public", pools.public),
		health.WithDBNamed("db.admin", pools.admin),
		health.WithDBNamed("db.platform", pools.platform),
	)
	publicAPI.Register(mux)
	adminAPI.Register(mux)
	platformAPI.Register(mux)
	return mux
}

// serverPools is one pool per PostgreSQL login this process serves as.
type serverPools struct {
	public   *sql.DB
	admin    *sql.DB
	platform *sql.DB
}

func openServerPools() (serverPools, error) {
	public, err := sqldb.Open(dbURLFromEnv("PUBLIRA_PUBLIC_DB_URL", defaultPublicDBURL))
	if err != nil {
		return serverPools{}, err
	}
	admin, err := sqldb.Open(dbURLFromEnv("PUBLIRA_ADMIN_DB_URL", defaultAdminDBURL))
	if err != nil {
		return serverPools{}, errors.Join(err, public.Close())
	}
	platform, err := sqldb.Open(dbURLFromEnv("PUBLIRA_PLATFORM_DB_URL", defaultPlatformDBURL))
	if err != nil {
		return serverPools{}, errors.Join(err, public.Close(), admin.Close())
	}
	return serverPools{public: public, admin: admin, platform: platform}, nil
}

func (p serverPools) close() error {
	var errs []error
	for _, db := range []*sql.DB{p.public, p.admin, p.platform} {
		if db != nil {
			errs = append(errs, db.Close())
		}
	}
	return errors.Join(errs...)
}

// newImageObjectStore reads every image from the store the platform's
// settings name. They are read on the admin pool, whose login is granted that
// one platform table and nothing else of the platform's: image delivery
// answers a console host as that login already, and the storefront pool is
// not granted the table at all.
func newImageObjectStore(secrets platformstorage.SecretManager, admin *sql.DB, logger *slog.Logger) imageserver.ObjectStore {
	resolver := platformstorage.New(platformstorage.Config{
		Queries: dbmodels.New(admin),
		Secrets: secrets,
		Logger:  logger,
	}, func(ctx context.Context, snapshot platformstorage.Snapshot) (imageserver.ObjectStore, error) {
		client, err := s3storage.NewClient(ctx, snapshot.S3Config())
		if err != nil {
			return nil, fmt.Errorf("initialize s3 client: %w", err)
		}
		return imageserver.NewS3Store(client, snapshot.Settings.Bucket), nil
	})
	return imageserver.ResolvingStore{Resolve: func(ctx context.Context) (imageserver.ObjectStore, string, error) {
		resolved, err := resolver.Resolve(ctx)
		return resolved.Value, resolved.Version, err
	}}
}
