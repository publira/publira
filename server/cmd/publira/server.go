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

// serverRoles is which API surfaces a server process serves. A role is named
// the way the web app that consumes it is, and carries its Connect namespace,
// its share of image delivery, and its database login: storefront is
// publira.v1, the storefront hosts' images, and publira_public; admin is
// publira.admin.v1, the console hosts' images, and publira_admin; platform is
// publira.platform.v1 and publira_platform.
type serverRoles struct {
	storefront bool
	admin      bool
	platform   bool
}

// allServerRoles is what server serves unless --role names some.
var allServerRoles = serverRoles{storefront: true, admin: true, platform: true}

func (r serverRoles) any() bool { return r.storefront || r.admin || r.platform }

// images reports whether the process serves /images: a storefront host's
// images belong to the storefront role and a console host's to the admin role.
func (r serverRoles) images() bool { return r.storefront || r.admin }

// serverServiceNames is one service.name per Connect namespace the roles
// serve, and one for the image routes, so they stay apart in a trace UI now
// that they share a process. The first is the process default.
func serverServiceNames(r serverRoles) []string {
	var names []string
	if r.storefront {
		names = append(names, publicapi.ServiceName)
	}
	if r.admin {
		names = append(names, adminapi.ServiceName)
	}
	if r.platform {
		names = append(names, platformapi.ServiceName)
	}
	if r.images() {
		names = append(names, imageserver.ServiceName)
	}
	return names
}

// buildServer builds the Connect namespaces and image delivery of roles on one
// listener: the reverse proxy forwards /api and /images to it as they are, and
// the Next.js apps dial the same /api directly. A role the process does not
// serve opens no pool and reads no variable of its own.
func buildServer(deps shared, roles serverRoles) (half, error) {
	cfg, err := loadServerConfig(roles)
	if err != nil {
		return half{}, err
	}

	// One pool per PostgreSQL login, because the login is what the database
	// enforces a namespace's reach with: publira_public and publira_admin are
	// subject to row-level security and publira_platform bypasses it. Which
	// pool a request lands on is decided by the namespace its procedure path
	// names, or for an image by the host it arrived on — a tenant's storefront
	// is answered as publira_public and its console as publira_admin — so a
	// mux entry is also a database role, and image delivery shares the pool of
	// the login it answers as rather than opening a second one for it.
	pools, err := openServerPools(roles)
	if err != nil {
		return half{}, failed("failed to initialize db", err)
	}
	built, err := assembleServer(deps, cfg, pools)
	if err != nil {
		_ = pools.close()
		return half{}, err
	}
	addr := addrFromEnv("PUBLIRA_PUBLIC_API_ADDR", defaultAddr)
	return half{
		listeners: []httpserver.Listener{{Name: "server", Server: httpserver.New(addr, built.handler)}},
		drain:     built.drain,
		close: func() error {
			return errors.Join(built.close(), pools.close())
		},
	}, nil
}

// assembledServer is what the server serves on pools, before it is given a
// listener.
type assembledServer struct {
	handler http.Handler
	drain   []func(context.Context) error
	// close releases what was built on the pools, and not the pools.
	close func() error
}

// serverConfig is what the server reads from the environment before it opens
// a pool, so a misconfiguration is refused without reaching the database.
type serverConfig struct {
	idTokens  signin.VerifierConfig
	clientIPs *clientip.Resolver
	tokens    *auth.TokenManager
}

func loadServerConfig(roles serverRoles) (serverConfig, error) {
	// Refused here rather than where Redis is dialled, which falls back to
	// in-process state and would leave the misconfiguration running.
	if _, err := redisurl.FromEnv(); err != nil {
		return serverConfig{}, failed("failed to load config", err)
	}
	var cfg serverConfig
	// The ID tokens of a sign-in provider are verified by the public API
	// alone.
	if roles.storefront {
		idTokens, err := signin.VerifierConfigFromEnv()
		if err != nil {
			return serverConfig{}, failed("failed to load config", err)
		}
		cfg.idTokens = idTokens
	}
	clientIPs, err := clientip.FromEnv()
	if err != nil {
		return serverConfig{}, failed("failed to load config", err)
	}
	cfg.clientIPs = clientIPs
	tokens, err := auth.NewTokenManagerFromEnv()
	if err != nil {
		return serverConfig{}, failed("failed to initialize access token manager", err)
	}
	cfg.tokens = tokens
	return cfg, nil
}

// servedAPIs is what a process serves, nil where its role is not served.
type servedAPIs struct {
	public   *publicapi.API
	admin    *adminapi.API
	platform *platformapi.API
	images   *imageserver.Server
}

// assembleServer builds the API and image delivery of the roles whose pools
// are open. Every read is made on the pool of the surface it serves, the
// platform's settings among them, so which pools a request reaches follows
// from what it asks for, and a role's pool is the whole of what it needs.
func assembleServer(deps shared, cfg serverConfig, pools serverPools) (assembledServer, error) {
	logger := deps.logger
	tokens := cfg.tokens
	encryptor := deps.encryptor

	// One sign-in limit and one mail limit for the namespaces served here. The
	// storefront and the tenant console sign in and mail the same accounts, and
	// one source may reach all three, so counters kept in this process when no
	// Redis is named have to be one set rather than one per namespace. The
	// policy is read as the least of the logins held here that may read it.
	policy := platformpolicy.NewResolver(dbmodels.New(pools.leastPrivileged()), platformpolicy.CacheTTL, logger)
	login := loginguard.NewShared(policy, logger)
	mail := mailguard.NewShared(policy, logger)

	var served servedAPIs
	var drain []func(context.Context) error

	if pools.public != nil {
		// The search engine is read from the platform's settings on the
		// public pool, the one the search RPCs are answered on, so the public
		// API holds no other login to search. The row's password is sealed
		// under keys only this process holds. The searches themselves run on
		// the same pool when the engine is SQL.
		searcher := platformsearch.Searcher{
			Resolver: platformsearch.NewResolver(platformsearch.ResolverConfig{
				Queries: dbmodels.New(pools.public),
				Secrets: encryptor,
				Logger:  logger,
			}),
			SQL: sqlbackend.New(dbmodels.New(pools.public)),
		}
		// The object store the reader icons go to is read the way the admin
		// API reads it, on the pool the uploads are answered on.
		storageProvider := platformstorage.Provider{Resolver: platformstorage.New(platformstorage.Config{
			Queries: dbmodels.New(pools.public),
			Secrets: encryptor,
			Logger:  logger,
		}, platformstorage.NewStorage)}
		// The revalidate client is shared by the two namespaces whose writes
		// leave a cache entry stale.
		publicAPI, err := publicapi.New(pools.public, dbmodels.New(pools.public), storageProvider, encryptor, tokens, deps.revalidate, searcher, cfg.idTokens, login, mail)
		if err != nil {
			return assembledServer{}, failed("failed to initialize public api handler", err)
		}
		served.public = publicAPI
	}

	// The web service token is how the web apps call the consoles' APIs, so it
	// is read only where one of them is served.
	var webServiceToken *auth.ServiceToken
	if pools.admin != nil || pools.platform != nil {
		webServiceToken = newWebServiceToken(logger)
	}
	smtpTester := internalsmtp.NewClient()

	if pools.admin != nil {
		// The object store is read from the platform's settings on the admin
		// pool, the one the uploads are answered on, so this process starts
		// before an operator has saved one and an upload until then is
		// refused.
		storageProvider := platformstorage.Provider{Resolver: platformstorage.New(platformstorage.Config{
			Queries: dbmodels.New(pools.admin),
			Secrets: encryptor,
			Logger:  logger,
		}, platformstorage.NewStorage)}
		adminRecorder := auditlog.NewAsync(dbmodels.New(pools.admin), pools.admin, logger)
		adminAPI, err := adminapi.NewWithAsyncRecorder(pools.admin, dbmodels.New(pools.admin), storageProvider, logger, encryptor, smtpTester, tokens, deps.revalidate, adminRecorder, webServiceToken, login, mail)
		if err != nil {
			return assembledServer{}, failed("failed to initialize admin api handler", err)
		}
		served.admin = adminAPI
		drain = append(drain, adminRecorder.Shutdown)
	}

	if pools.platform != nil {
		platformRecorder := auditlog.NewAsync(dbmodels.New(pools.platform), nil, logger)
		served.platform = platformapi.NewWithAsyncRecorder(pools.platform, dbmodels.New(pools.platform), logger, encryptor, smtpTester, tokens, platformRecorder, webServiceToken, login, mail)
		drain = append(drain, platformRecorder.Shutdown)
	}

	closeImages := func() error { return nil }
	// Image delivery is built last: nothing after it can fail and leave its
	// conversion server running. A site whose role is not served is left
	// empty, and its hosts are refused rather than answered as the other
	// site's login.
	if pools.public != nil || pools.admin != nil {
		var storefront, console imageserver.SiteDB
		if pools.public != nil {
			storefront = newImageSite(pools.public, encryptor, logger)
		}
		if pools.admin != nil {
			console = newImageSite(pools.admin, encryptor, logger)
		}
		imageHandler, err := imageserver.NewHandler(storefront, console, logger, tokens)
		if err != nil {
			return assembledServer{}, failed("failed to initialize image handler", err)
		}
		served.images = imageHandler
		closeImages = imageHandler.Close
	}

	return assembledServer{
		handler: serverHandler(cfg.clientIPs, served, pools),
		drain:   drain,
		close:   closeImages,
	}, nil
}

// serverHandler serves the Connect namespaces under /rpc and image delivery
// under /images, which the edge forwards with their prefixes kept and the web
// apps dial on the same paths. Nothing is registered at the root, so a
// procedure has the same path wherever it is called from. The console
// namespaces are reachable through the edge on every host, and each of their
// RPCs refuses a caller without an operator session or the web service token
// before any handler runs.
//
// Readiness names one check per pool: with up to three logins behind one
// listener, a single "db" could not say which of them stopped answering. The
// client address of every request is determined before any handler runs, so
// the audit log and the per-client limits never read a context without one.
func serverHandler(clientIPs *clientip.Resolver, served servedAPIs, pools serverPools) http.Handler {
	mux := http.NewServeMux()
	var checks []health.Option
	for _, pool := range []struct {
		name string
		db   *sql.DB
	}{
		{"db.public", pools.public},
		{"db.admin", pools.admin},
		{"db.platform", pools.platform},
	} {
		if pool.db != nil {
			checks = append(checks, health.WithDBNamed(pool.name, pool.db))
		}
	}
	health.Register(mux, checks...)
	api := http.NewServeMux()
	if served.public != nil {
		served.public.Register(api)
	}
	if served.admin != nil {
		served.admin.Register(api)
	}
	if served.platform != nil {
		served.platform.Register(api)
	}
	// /api serves the same namespaces for the clients not yet on /rpc, and is
	// removed in 0.2.0.
	for _, prefix := range []string{"/rpc", "/api"} {
		mux.Handle(prefix+"/", http.StripPrefix(prefix, api))
	}
	if served.images != nil {
		served.images.Register(mux)
	}
	return clientIPs.Middleware(mux)
}

// serverPools is one pool per PostgreSQL login this process serves as, nil for
// a role it does not serve.
type serverPools struct {
	public   *sql.DB
	admin    *sql.DB
	platform *sql.DB
}

// leastPrivileged is the pool of the least of the logins held: the platform
// policy is read as it, and every login may read the policy.
func (p serverPools) leastPrivileged() *sql.DB {
	switch {
	case p.public != nil:
		return p.public
	case p.admin != nil:
		return p.admin
	default:
		return p.platform
	}
}

// openServerPools opens the pool of each role served, closing the ones
// already open when a later one fails. The variable of a role not served is
// never read.
func openServerPools(roles serverRoles) (serverPools, error) {
	var pools serverPools
	for _, login := range []struct {
		served   bool
		env      string
		fallback string
		pool     **sql.DB
	}{
		{roles.storefront, "PUBLIRA_PUBLIC_DB_URL", defaultPublicDBURL, &pools.public},
		{roles.admin, "PUBLIRA_ADMIN_DB_URL", defaultAdminDBURL, &pools.admin},
		{roles.platform, "PUBLIRA_PLATFORM_DB_URL", defaultPlatformDBURL, &pools.platform},
	} {
		if !login.served {
			continue
		}
		db, err := sqldb.Open(dbURLFromEnv(login.env, login.fallback))
		if err != nil {
			return serverPools{}, errors.Join(err, pools.close())
		}
		*login.pool = db
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

// newImageSite is how image delivery answers the site that pool's login
// belongs to: the host lookup, the tenant-scoped queries, and the object
// store's settings are all read on pool, so the site is answered without the
// other site's login.
func newImageSite(pool *sql.DB, secrets platformstorage.SecretManager, logger *slog.Logger) imageserver.SiteDB {
	return imageserver.SiteDB{
		Pool:     pool,
		Resolver: dbmodels.New(pool),
		Tenants:  imageserver.NewDBTenantScopedFactory(pool, logger),
		Objects:  newImageObjectStore(secrets, pool, logger),
	}
}

// newImageObjectStore reads every image from the store the platform's
// settings name, read on pool. Both site logins are granted that one platform
// table; the access key in it is sealed under keys only this process holds.
func newImageObjectStore(secrets platformstorage.SecretManager, pool *sql.DB, logger *slog.Logger) imageserver.ObjectStore {
	resolver := platformstorage.New(platformstorage.Config{
		Queries: dbmodels.New(pool),
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
