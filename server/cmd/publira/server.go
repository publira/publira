package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/publira/publira/server/api/adminapi"
	"github.com/publira/publira/server/api/platformapi"
	"github.com/publira/publira/server/api/publicapi"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/catalogsearch/sqlbackend"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/httpserver"
	"github.com/publira/publira/server/internal/imageserver"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/platformsearch"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/redisurl"
	"github.com/publira/publira/server/internal/signin"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/sqldb"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
)

const (
	defaultAddr = ":8000"

	defaultPublicDBURL   = "postgres://publira_public:publicpass@db:5432/publira?sslmode=disable"
	defaultAdminDBURL    = "postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable"
	defaultPlatformDBURL = "postgres://publira_platform:platformpass@db:5432/publira?sslmode=disable"
)

// serverServiceNames is one service.name per Connect namespace the server
// serves, and one for the image routes, so they stay apart in a trace UI now
// that they share a process. The public namespace's comes first: it is the
// process default.
func serverServiceNames() []string {
	return []string{publicapi.ServiceName, adminapi.ServiceName, platformapi.ServiceName, imageserver.ServiceName}
}

// buildServer builds the three Connect namespaces and image delivery on one
// listener: the reverse proxy forwards /api and /images to it as they are, and
// the Next.js apps dial the same /api directly.
func buildServer(deps shared) (_ half, err error) {
	logger := deps.logger

	// Refused here rather than where Redis is dialled, which falls back to
	// in-process state and would leave the misconfiguration running.
	if _, err := redisurl.FromEnv(); err != nil {
		return half{}, failed("failed to load config", err)
	}
	idTokens, err := signin.VerifierConfigFromEnv()
	if err != nil {
		return half{}, failed("failed to load config", err)
	}
	clientIPs, err := clientip.FromEnv()
	if err != nil {
		return half{}, failed("failed to load config", err)
	}

	tokens, err := auth.NewTokenManagerFromEnv()
	if err != nil {
		return half{}, failed("failed to initialize access token manager", err)
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
		return half{}, failed("failed to initialize db", err)
	}
	defer func() {
		if err != nil {
			_ = pools.close()
		}
	}()

	encryptor := deps.encryptor

	// The search engine is read from the platform's settings on the admin pool,
	// whose login is granted that row and none of the platform's other
	// credentials, so the storefront's role holds neither the engine's password
	// nor a way to read it. The searches themselves run on the public pool when
	// the engine is SQL.
	searcher := platformsearch.Searcher{
		Resolver: platformsearch.NewResolver(platformsearch.ResolverConfig{
			Queries: dbmodels.New(pools.admin),
			Secrets: encryptor,
			Logger:  logger,
		}),
		SQL: sqlbackend.New(dbmodels.New(pools.public)),
	}

	// One sign-in limit and one mail limit for the three namespaces. The
	// storefront and the tenant console sign in and mail the same accounts, and
	// one source may reach all three, so counters kept in this process when no
	// Redis is named have to be one set rather than one per namespace. The
	// policy is read as publira_public, the least of the logins that may read
	// it.
	policy := platformpolicy.NewResolver(dbmodels.New(pools.public), platformpolicy.CacheTTL, logger)
	login := loginguard.NewShared(policy, logger)
	mail := mailguard.NewShared(policy, logger)

	// The revalidate client is shared by the two namespaces whose writes leave
	// a cache entry stale.
	publicAPI, err := publicapi.New(pools.public, dbmodels.New(pools.public), encryptor, tokens, deps.revalidate, searcher, idTokens, login, mail)
	if err != nil {
		return half{}, failed("failed to initialize public api handler", err)
	}

	// The object store is read from the platform's settings on the platform
	// pool, so this process starts before an operator has saved one and an
	// upload until then is refused.
	storageProvider := platformstorage.Provider{Resolver: platformstorage.New(platformstorage.Config{
		Queries: dbmodels.New(pools.platform),
		Secrets: encryptor,
		Logger:  logger,
	}, platformstorage.NewStorage)}

	smtpTester := internalsmtp.NewClient()

	webServiceToken := newWebServiceToken(logger)

	adminRecorder := auditlog.NewAsync(dbmodels.New(pools.admin), pools.admin, logger)
	adminAPI, err := adminapi.NewWithAsyncRecorder(pools.admin, dbmodels.New(pools.admin), storageProvider, logger, encryptor, smtpTester, tokens, deps.revalidate, adminRecorder, webServiceToken, login, mail)
	if err != nil {
		return half{}, failed("failed to initialize admin api handler", err)
	}

	platformRecorder := auditlog.NewAsync(dbmodels.New(pools.platform), nil, logger)
	platformAPI := platformapi.NewWithAsyncRecorder(pools.platform, dbmodels.New(pools.platform), logger, encryptor, smtpTester, tokens, platformRecorder, webServiceToken, login, mail)

	// Image delivery is built last: nothing after it can fail and leave its
	// conversion server running.
	imageHandler, err := imageserver.NewHandler(
		dbmodels.New(pools.public),
		imageserver.SiteDB{Pool: pools.public, Tenants: imageserver.NewDBTenantScopedFactory(pools.public, logger)},
		imageserver.SiteDB{Pool: pools.admin, Tenants: imageserver.NewDBTenantScopedFactory(pools.admin, logger)},
		newImageObjectStore(encryptor, pools.admin, logger),
		logger,
		tokens,
	)
	if err != nil {
		return half{}, failed("failed to initialize image handler", err)
	}

	addr := addrFromEnv("PUBLIRA_PUBLIC_API_ADDR", defaultAddr)
	return half{
		listeners: []httpserver.Listener{{Name: "server", Server: httpserver.New(addr, serverHandler(clientIPs, publicAPI, adminAPI, platformAPI, imageHandler, pools))}},
		drain:     []func(context.Context) error{adminRecorder.Shutdown, platformRecorder.Shutdown},
		close: func() error {
			return errors.Join(imageHandler.Close(), pools.close())
		},
	}, nil
}

// serverHandler serves the three Connect namespaces under /api and image
// delivery under /images, which the edge forwards with their prefixes kept and
// the web apps dial on the same paths. Nothing is registered at the root, so a
// procedure has one path wherever it is called from. The console namespaces
// are reachable through the edge on every host, and each of their RPCs refuses
// a caller without an operator session or the web service token before any
// handler runs.
//
// Readiness names one check per pool: with three logins behind one listener, a
// single "db" could not say which of them stopped answering. The client address
// of every request is determined before any handler runs, so the audit log and
// the per-client limits never read a context without one.
func serverHandler(clientIPs *clientip.Resolver, publicAPI *publicapi.API, adminAPI *adminapi.API, platformAPI *platformapi.API, images *imageserver.Server, pools serverPools) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux,
		health.WithDBNamed("db.public", pools.public),
		health.WithDBNamed("db.admin", pools.admin),
		health.WithDBNamed("db.platform", pools.platform),
	)
	api := http.NewServeMux()
	publicAPI.Register(api)
	adminAPI.Register(api)
	platformAPI.Register(api)
	mux.Handle("/api/", http.StripPrefix("/api", api))
	images.Register(mux)
	return clientIPs.Middleware(mux)
}

// serverPools is one pool per PostgreSQL login this process serves as.
type serverPools struct {
	public   *sql.DB
	admin    *sql.DB
	platform *sql.DB
}

// openServerPools opens one pool per login, closing the ones already open
// when a later one fails.
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
