package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
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
	"github.com/publira/publira/server/internal/logging"
	"github.com/publira/publira/server/internal/secretcrypto"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/sqldb"
	"github.com/publira/publira/server/internal/storage"
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

func main() {
	logger := logging.New(os.Stdout, nil)
	slog.SetDefault(logger)

	shutdownTracing, err := tracing.Setup(
		context.Background(),
		publicapi.ServiceName,
		adminapi.ServiceName,
		platformapi.ServiceName,
	)
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
	// enforces the namespace's reach with: publira_public and publira_admin
	// are subject to row-level security and publira_platform bypasses it.
	// Which pool a request lands on is decided by the namespace its procedure
	// path names, so a mux entry is also a database role.
	pools, err := openPools()
	if err != nil {
		logger.Error("failed to initialize db", "error", err)
		os.Exit(1)
	}
	defer pools.close() //nolint:errcheck

	storageProvider, err := newStorageProvider(context.Background(), cfg.Storage)
	if err != nil {
		logger.Error("failed to initialize storage provider", "error", err)
		os.Exit(1)
	}

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
			os.Exit(1)
		}
		encryptor = manager
	}

	publicAPI, err := publicapi.New(pools.public, dbmodels.New(pools.public), storageProvider, encryptor, tokens)
	if err != nil {
		logger.Error("failed to initialize public api handler", "error", err)
		os.Exit(1)
	}

	smtpTester := internalsmtp.NewClient()

	adminRecorder := auditlog.NewAsync(dbmodels.New(pools.admin), pools.admin, logger)
	adminAPI, err := adminapi.NewWithAsyncRecorder(pools.admin, dbmodels.New(pools.admin), storageProvider, logger, encryptor, smtpTester, tokens, adminRecorder)
	if err != nil {
		logger.Error("failed to initialize admin api handler", "error", err)
		os.Exit(1)
	}

	platformRecorder := auditlog.NewAsync(dbmodels.New(pools.platform), nil, logger)
	platformAPI := platformapi.NewWithAsyncRecorder(pools.platform, dbmodels.New(pools.platform), logger, encryptor, smtpTester, tokens, platformRecorder)

	edgeAddr := addrFromEnv("PUBLIRA_PUBLIC_API_ADDR", defaultEdgeAddr)
	internalAddr := addrFromEnv("PUBLIRA_PUBLIC_API_GRPC_ADDR", defaultInternalAddr)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("starting api server (edge)", "addr", edgeAddr)
	logger.Info("starting api server (internal)", "addr", internalAddr)
	if err := httpserver.Serve(ctx, logger, []*http.Server{
		httpserver.New(edgeAddr, edgeHandler(publicAPI, pools)),
		httpserver.New(internalAddr, internalHandler(publicAPI, adminAPI, platformAPI, pools)),
	}, adminRecorder.Shutdown, platformRecorder.Shutdown, shutdownTracing, func(context.Context) error {
		return pools.close()
	}); err != nil {
		logger.Error("api server failed", "error", err)
		os.Exit(1)
	}
}

// edgeHandler serves what the internet may reach. The edge forwards /api to
// this listener host-agnostically, so registering either console namespace
// here would publish its RPCs on every tenant site — a Connect handler answers
// gRPC, gRPC-Web and the Connect protocol on one route, so the port and the
// protocol bound nothing. Its readiness names only the pool the public API
// uses, both because that is the only one it serves and because the state of
// the two consoles' pools is not an outsider's to read.
func edgeHandler(publicAPI *publicapi.API, pools dbPools) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(pools.public))
	publicAPI.Register(mux)
	return mux
}

// internalHandler serves all three namespaces to the Next.js apps, which dial
// it directly over the private network. Readiness names one check per pool:
// with three logins behind one listener, a single "db" could not say which of
// them stopped answering.
func internalHandler(publicAPI *publicapi.API, adminAPI *adminapi.API, platformAPI *platformapi.API, pools dbPools) http.Handler {
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

// dbPools is one pool per PostgreSQL login this process serves a namespace as.
type dbPools struct {
	public   *sql.DB
	admin    *sql.DB
	platform *sql.DB
}

func openPools() (dbPools, error) {
	public, err := sqldb.Open(dbURLFromEnv("PUBLIRA_PUBLIC_DB_URL", defaultPublicDBURL))
	if err != nil {
		return dbPools{}, err
	}
	admin, err := sqldb.Open(dbURLFromEnv("PUBLIRA_ADMIN_DB_URL", defaultAdminDBURL))
	if err != nil {
		return dbPools{}, errors.Join(err, public.Close())
	}
	platform, err := sqldb.Open(dbURLFromEnv("PUBLIRA_PLATFORM_DB_URL", defaultPlatformDBURL))
	if err != nil {
		return dbPools{}, errors.Join(err, public.Close(), admin.Close())
	}
	return dbPools{public: public, admin: admin, platform: platform}, nil
}

func (p dbPools) close() error {
	var errs []error
	for _, db := range []*sql.DB{p.public, p.admin, p.platform} {
		if db != nil {
			errs = append(errs, db.Close())
		}
	}
	return errors.Join(errs...)
}

func dbURLFromEnv(name, fallback string) string {
	if url := strings.TrimSpace(os.Getenv(name)); url != "" {
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
