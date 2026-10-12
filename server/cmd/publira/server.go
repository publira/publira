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
	defaultEdgeAddr     = ":8000"
	defaultInternalAddr = ":8100"

	defaultPublicDBURL   = "postgres://publira_public:publicpass@db:5432/publira?sslmode=disable"
	defaultAdminDBURL    = "postgres://publira_admin:adminpass@db:5432/publira?sslmode=disable"
	defaultPlatformDBURL = "postgres://publira_platform:platformpass@db:5432/publira?sslmode=disable"
)

// serverListeners is which of the server's two listeners a process serves.
type serverListeners struct {
	edge     bool
	internal bool
}

// bothListeners is what server serves unless --listener names one.
var bothListeners = serverListeners{edge: true, internal: true}

func (l serverListeners) any() bool { return l.edge || l.internal }

// serverServiceNames is one service.name per Connect namespace the listeners
// serve, and one for the image routes, so they stay apart in a trace UI now
// that they share a process. The public namespace's comes first: both
// listeners serve it, and it is the process default.
func serverServiceNames(l serverListeners) []string {
	names := []string{publicapi.ServiceName}
	if l.internal {
		names = append(names, adminapi.ServiceName, platformapi.ServiceName)
	}
	if l.edge {
		names = append(names, imageserver.ServiceName)
	}
	return names
}

// buildServer builds the API and image delivery for the listeners l names:
// the edge listener carries what the reverse proxy forwards, /api and /images
// alike, and the internal listener carries the three Connect namespaces the
// Next.js apps dial directly. What only one listener uses — the platform pool,
// the console APIs and the web service token for the internal one, image
// delivery for the edge — is built only when that listener is served, so a
// process serving the edge alone holds no login that bypasses row-level
// security and reads no variable it would not use.
func buildServer(deps shared, l serverListeners) (_ half, err error) {
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
	// the login it answers as rather than opening a second one for it. The
	// platform pool serves the Platform Console's namespace alone, so only the
	// internal listener opens it.
	pools, err := openServerPools(l.internal)
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
	// nor a way to read it, and the edge listener needs no platform pool to
	// search. The searches themselves run on the public pool when the engine is
	// SQL.
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

	built := half{close: pools.close}

	if l.internal {
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

		internalAddr := addrFromEnv("PUBLIRA_PUBLIC_API_GRPC_ADDR", defaultInternalAddr)
		built.listeners = append(built.listeners, listener{name: "server (internal)", server: httpserver.New(internalAddr, internalHandler(clientIPs, publicAPI, adminAPI, platformAPI, pools))})
		built.drain = []func(context.Context) error{adminRecorder.Shutdown, platformRecorder.Shutdown}
	}

	// Image delivery is built last: nothing after it can fail and leave its
	// conversion server running.
	if l.edge {
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

		edgeAddr := addrFromEnv("PUBLIRA_PUBLIC_API_ADDR", defaultEdgeAddr)
		built.listeners = append(built.listeners, listener{name: "server (edge)", server: httpserver.New(edgeAddr, edgeHandler(clientIPs, publicAPI, imageHandler, pools))})
		built.close = func() error {
			return errors.Join(imageHandler.Close(), pools.close())
		}
	}

	return built, nil
}

// edgeHandler serves what the internet may reach: the public API under /api
// and image delivery under /images, which the edge forwards with their
// prefixes kept. Registering either console namespace here would publish its
// RPCs on every tenant site, and readiness names only the public pool, the one
// whose state an outsider may read.
//
// Both listeners determine the client address of every request before any
// handler runs, so the audit log and the per-client limits never read a
// context without one.
func edgeHandler(clientIPs *clientip.Resolver, publicAPI *publicapi.API, images *imageserver.Server, pools serverPools) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(pools.public))
	api := http.NewServeMux()
	publicAPI.Register(api)
	mux.Handle("/api/", http.StripPrefix("/api", api))
	images.Register(mux)
	return clientIPs.Middleware(mux)
}

// internalHandler serves all three namespaces to the Next.js apps, which dial
// it directly over the private network. Readiness names one check per pool:
// with three logins behind one listener, a single "db" could not say which of
// them stopped answering.
func internalHandler(clientIPs *clientip.Resolver, publicAPI *publicapi.API, adminAPI *adminapi.API, platformAPI *platformapi.API, pools serverPools) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux,
		health.WithDBNamed("db.public", pools.public),
		health.WithDBNamed("db.admin", pools.admin),
		health.WithDBNamed("db.platform", pools.platform),
	)
	publicAPI.Register(mux)
	adminAPI.Register(mux)
	platformAPI.Register(mux)
	return clientIPs.Middleware(mux)
}

// serverPools is one pool per PostgreSQL login this process serves as. The
// platform pool is nil in a process that serves the edge listener alone.
type serverPools struct {
	public   *sql.DB
	admin    *sql.DB
	platform *sql.DB
}

// openServerPools opens the public and the admin pool, which both listeners
// answer on, and the platform pool when withPlatform asks for it. A pool left
// unopened is nil, and its variable is never read.
func openServerPools(withPlatform bool) (serverPools, error) {
	public, err := sqldb.Open(dbURLFromEnv("PUBLIRA_PUBLIC_DB_URL", defaultPublicDBURL))
	if err != nil {
		return serverPools{}, err
	}
	admin, err := sqldb.Open(dbURLFromEnv("PUBLIRA_ADMIN_DB_URL", defaultAdminDBURL))
	if err != nil {
		return serverPools{}, errors.Join(err, public.Close())
	}
	pools := serverPools{public: public, admin: admin}
	if !withPlatform {
		return pools, nil
	}
	pools.platform, err = sqldb.Open(dbURLFromEnv("PUBLIRA_PLATFORM_DB_URL", defaultPlatformDBURL))
	if err != nil {
		return serverPools{}, errors.Join(err, public.Close(), admin.Close())
	}
	return pools, nil
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
