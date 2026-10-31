package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/catalogsearch"
	"github.com/publira/publira/server/internal/catalogsearch/sqlbackend"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/disposabledomains"
	"github.com/publira/publira/server/internal/emailrejection"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/inboundprovider"
	inboundproviders "github.com/publira/publira/server/internal/inboundprovider/providers"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/readguard"
	"github.com/publira/publira/server/internal/readreplica"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/signin"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/tenantconn"
	"github.com/publira/publira/server/internal/tenantstatus"
	"github.com/publira/publira/server/internal/tracing"
	"github.com/publira/publira/server/internal/webpushsettings"
)

type Querier interface {
	dbmodels.Querier
}

type apiServer struct {
	db *sql.DB
	// reads is db and, when the process is given one, its read replica: a
	// request [answeredOnReplica] admits is bound to its tenant there.
	reads     readreplica.Pools
	queries   Querier
	encryptor emailsettings.SecretManager
	tokens    *auth.TokenManager
	logger    *slog.Logger
	guards    readerGuards
	mail      *mailguard.Guard
	// login bounds how often a password may be tried at sign-in.
	login *loginguard.Guard
	// readGuard bounds how fast one client may call the public API.
	readGuard *readguard.Guard
	reval     *revalidate.Requester
	// webPushKeys answers the VAPID public key browsers subscribe with, empty
	// while Web Push is not configured.
	webPushKeys webPushPublicKeySource
	// paymentProviders are the providers a tenant's payment settings may name.
	paymentProviders *paymentprovider.Registry
	// inboundProviders are the providers a tenant's inbound email settings may
	// name.
	inboundProviders *inboundprovider.Registry
	// stores verify the transactions the app buys through the App Store and
	// Google Play.
	stores storeClients
	// search finds the hits of the catalog searches.
	search catalogsearch.Backend
	// idTokens verifies the ID tokens readers sign in with Apple and Google.
	idTokens idTokenVerifier
	// disposable answers whether an address's domain is on the disposable list
	// the platform policy names, for a tenant that refuses those.
	disposable emailrejection.DisposableList
	// storage stores the icons readers upload. A nil one refuses every upload
	// as an object store not yet configured.
	storage storage.Provider
}

type webPushPublicKeySource interface {
	PublicKey(ctx context.Context) (string, error)
}

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, "invalid token")
}

// internalDBError keeps context cancellation and deadline errors as-is so
// Connect can map them to CodeCanceled / CodeDeadlineExceeded. Other DB
// failures are logged and replaced with a generic client-facing message so
// driver details never leave the server.
func (s *apiServer) internalDBError(ctx context.Context, msg string, err error, keyvals ...any) error {
	return s.internalError(ctx, msg, err, keyvals...)
}

// internalError is internalDBError for a failure the database reported no
// problem with — a stored value the server cannot make sense of, say. The
// caller sees the same generic message either way.
func (s *apiServer) internalError(ctx context.Context, msg string, err error, keyvals ...any) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	args := make([]any, 0, len(keyvals)+2)
	args = append(args, keyvals...)
	args = append(args, "error", err)
	s.logger.ErrorContext(ctx, msg, args...)
	return connect.NewError(connect.CodeInternal, "internal server error")
}

// noStorePrivateResponse marks a response that depends on who is asking, so a
// shared cache never serves one member's state to another. The member-scoped
// public RPCs (follow, rating) return through here.
func noStorePrivateResponse[T any](ctx context.Context, msg *T) *T {
	if info, ok := connect.CallInfoForServerContext(ctx); ok {
		info.ResponseHeader().Set("Cache-Control", "private, no-store")
	}
	return msg
}

func tenantIDFromContext(ctx *publirattypesv1.TenantContext) (uuid.UUID, error) {
	return rpcmiddleware.ResolveTenantID(ctx, nil)
}

func (s *apiServer) tenantByContext(ctx context.Context, tenantCtx *publirattypesv1.TenantContext) (dbmodels.Tenant, error) {
	tenantID, err := tenantIDFromContext(tenantCtx)
	if err != nil {
		return dbmodels.Tenant{}, err
	}
	tenant, err := s.queriesFor(ctx).GetTenantByID(ctx, tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Tenant{}, connect.NewError(connect.CodeNotFound, "tenant not found")
		}
		return dbmodels.Tenant{}, s.internalDBError(ctx, "failed to get tenant", err, "tenant_id", tenantID.String())
	}
	return tenant, nil
}

func (s *apiServer) queriesFor(ctx context.Context) Querier {
	if queries, ok := rpcmiddleware.TenantQueriesFromContext(ctx); ok {
		return queries
	}
	return s.queries
}

// beginTenantTx starts a transaction on the request's tenant-scoped connection.
// Falling back to s.db.BeginTx would leave RLS: that path borrows a different
// pool connection that has never set app.current_tenant_id. sqlmock tests skip
// the interceptor, so they are the only callers allowed to begin on the pool.
func (s *apiServer) beginTenantTx(ctx context.Context) (*sql.Tx, error) {
	if conn, ok := rpcmiddleware.TenantConnFromContext(ctx); ok {
		return conn.BeginTx(ctx, nil)
	}
	if isSQLMockDB(s.db) {
		return s.db.BeginTx(ctx, nil)
	}
	return nil, errors.New("tenant-scoped connection is required to begin a transaction")
}

func isSQLMockDB(db *sql.DB) bool {
	if db == nil {
		return false
	}
	return strings.Contains(strings.ToLower(fmt.Sprintf("%T", db.Driver())), "sqlmock")
}

// ServiceName is the service.name this namespace's spans carry. The three
// namespaces share a process and keep their own name, so a trace UI can still
// tell the public API's work from the two consoles'.
const ServiceName = "publira-api-server"

// API is the public namespace — CatalogService, AuthService,
// NotificationService, TenantService, DomainService and the rest of
// publira.v1 — ready to be mounted by [API.Register].
type API struct {
	server *apiServer
}

// New builds the public API over db, which must be the pool connected as
// publira_public: the row-level security every handler here relies on is that
// role's. replica is a hot standby of db's cluster signed in as the same login,
// which [replicaProcedures] are answered on when it has caught up; nil answers
// every request on db. The flood controls read their limits from the platform
// policy through db, and so does the disposable-domain list a tenant may
// refuse sign-ups against. reval sends the cache tags its writes leave stale; a
// nil one turns revalidation off. search answers the catalog searches; a nil
// one is the SQL backend over queries. idTokens says where the ID tokens a
// reader signs in with are checked against. storageProvider stores the icons
// readers upload. payments are the providers a tenant's payment settings may
// name; a nil one is [providers.Registry].
//
// login is the sign-in limit and mail the limit on the mail a form may cause,
// which the process hands every namespace it serves: the storefront and the
// tenant console sign in, and mail, the same accounts, and a source reaching
// all three holds one allowance of each, so the counts have to be one even when
// they are kept in this process. A nil one counts on its own.
//
// reads bounds how fast one client may call the public API, and is the guard
// the process hands image delivery as well. A nil one counts on its own.
func New(db, replica *sql.DB, queries Querier, storageProvider storage.Provider, encryptor emailsettings.SecretManager, tokens *auth.TokenManager, reval *revalidate.Client, search catalogsearch.Backend, idTokens signin.VerifierConfig, payments *paymentprovider.Registry, login *loginguard.Guard, mail *mailguard.Guard, reads *readguard.Guard) (*API, error) {
	logger := slog.Default()
	policy := platformpolicy.NewResolver(dbmodels.New(db), platformpolicy.CacheTTL, logger)
	guards := newReaderGuards(policy, logger)
	if mail == nil {
		mail = mailguard.NewShared(policy, logger)
	}
	server := newAPIServer(db, queries, encryptor, tokens, reval, logger, guards, mail, search)
	if login == nil {
		login = loginguard.NewShared(policy, logger)
	}
	server.login = login
	if reads == nil {
		reads = readguard.NewFromEnv(logger)
	}
	server.readGuard = reads
	server.idTokens = signin.NewVerifier(idTokens)
	if payments != nil {
		server.paymentProviders = payments
	}
	server.storage = storageProvider
	server.reads.Replica = replica
	return &API{server: server}, nil
}

// Register mounts the publira.v1 services on mux. What a mux carries is what
// its listener serves, so this is the whole of the public API and none of the
// two console namespaces.
func (a *API) Register(mux *http.ServeMux) {
	registerPublicRoutes(mux, a.server)
}

func newAPIServer(
	db *sql.DB,
	queries Querier,
	encryptor emailsettings.SecretManager,
	tokens *auth.TokenManager,
	reval *revalidate.Client,
	logger *slog.Logger,
	guards readerGuards,
	mail *mailguard.Guard,
	search catalogsearch.Backend,
) *apiServer {
	if logger == nil {
		logger = slog.Default()
	}
	if mail == nil {
		mail = mailguard.NewDefault()
	}
	if search == nil {
		search = sqlbackend.New(queries)
	}
	guards = guards.withDefaults()
	revalidator := revalidate.NewRequester(revalidate.RequesterConfig{
		Client:  reval,
		Queries: queries,
		DB:      db,
		Logger:  logger,
	})
	return &apiServer{
		db:               db,
		reads:            readreplica.Pools{Primary: db, Logger: logger},
		queries:          queries,
		encryptor:        encryptor,
		tokens:           tokens,
		logger:           logger,
		guards:           guards,
		mail:             mail,
		login:            loginguard.NewDefault(),
		readGuard:        readguard.NewDefault(),
		reval:            revalidator,
		webPushKeys:      webpushsettings.NewPublicKeys(dbmodels.New(db), webpushsettings.CacheTTL, logger),
		paymentProviders: providers.Registry(),
		inboundProviders: inboundproviders.Registry(),
		stores:           defaultStoreClients(),
		search:           search,
		idTokens:         signin.NewVerifier(signin.VerifierConfig{}),
		disposable:       disposabledomains.New(guards.policy, nil, logger),
	}
}

func handlerFromServer(server *apiServer) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(server.db))
	registerPublicRoutes(mux, server)
	return mux
}

// maxInboundEmailWebhookRequestBytes is the most ProcessInboundEmailWebhook
// reads of one request. It leaves room for the headers and the tenant beside
// the largest payload the webhook takes.
const maxInboundEmailWebhookRequestBytes = maxInboundEmailWebhookPayload + 1<<20

// readLimits are the procedures of this namespace that read more of one
// request than rpcmiddleware.DefaultReadMaxBytes. The payment and App Store
// webhooks are not among them: their payloads are capped at
// maxPaymentWebhookPayload, which the default holds with room to spare.
var readLimits = map[string]int{
	publirav1connect.ContactServiceProcessInboundEmailWebhookProcedure: maxInboundEmailWebhookRequestBytes,
	publirav1connect.AuthServiceUploadMyIconProcedure:                  uploadMyIconReadMaxBytes,
}

func registerPublicRoutes(mux *http.ServeMux, server *apiServer) {
	traced := tracing.ConnectServerInterceptors(ServiceName)
	limits := rpcmiddleware.ReadLimits(readLimits)
	guarded := slices.Concat(traced, []connect.ServerInterceptor{server.readGuardInterceptor()})
	tenantScoped := slices.Concat(guarded, []connect.ServerInterceptor{server.tenantScopedQuerierInterceptor(), server.readerLocaleInterceptor()})

	services := connect.NewServer(tenantScoped...)
	publirav1connect.RegisterCatalogServiceHandler(services, server)
	publirav1connect.RegisterEpisodeReadServiceHandler(services, server)
	publirav1connect.RegisterPurchaseServiceHandler(services, server)
	publirav1connect.RegisterSubscriptionServiceHandler(services, server)
	publirav1connect.RegisterCoinServiceHandler(services, server)
	publirav1connect.RegisterFollowServiceHandler(services, server)
	publirav1connect.RegisterRatingServiceHandler(services, server)
	publirav1connect.RegisterWaitFreeServiceHandler(services, server)
	publirav1connect.RegisterContentViewServiceHandler(services, server)
	publirav1connect.RegisterCommentServiceHandler(services, server)
	publirav1connect.RegisterPublicPagesServiceHandler(services, server)
	publirav1connect.RegisterAuthServiceHandler(services, server)
	publirav1connect.RegisterNotificationServiceHandler(services, server)
	publirav1connect.RegisterTenantServiceHandler(services, server)
	publirav1connect.RegisterContactServiceHandler(services, server)
	connecthttp.Mount(mux, services, limits...)

	// DomainService is used before tenant context is known (e.g. proxy domain resolution),
	// so it must not require tenant-scoped interception.
	domain := connect.NewServer(guarded...)
	publirav1connect.RegisterDomainServiceHandler(domain, server)
	connecthttp.Mount(mux, domain, limits...)
}

// tenantScopedQuerierInterceptor binds every tenant-scoped request to its
// tenant on one connection for the whole request, on the read replica when
// [answeredOnReplica] admits the request and the replica has caught up, and on
// the primary otherwise. The tenant is looked up on that same connection, so a
// request answered on the replica does not reach the primary for its tenant
// either.
func (s *apiServer) tenantScopedQuerierInterceptor() connect.ServerInterceptor {
	return rpcmiddleware.NewUnaryRequestInterceptor(func(ctx context.Context, spec connect.Spec, req proto.Message, next func(context.Context) error) error {
		if s.db == nil {
			return next(ctx)
		}
		if isSQLMockDB(s.db) {
			return next(ctx)
		}

		tenantReq, ok := req.(tenantScopedRequest)
		if !ok {
			return next(ctx)
		}

		tenantID, err := rpcmiddleware.ResolveTenantID(tenantReq.GetTenant(), rpcmiddleware.RequestHeader(ctx))
		if err != nil {
			return err
		}

		var conn *sql.Conn
		var release func()
		if answeredOnReplica(spec.Procedure, rpcmiddleware.RequestHeader(ctx)) {
			conn, release, _, err = s.reads.Acquire(ctx, tenantID)
		} else {
			conn, release, err = tenantconn.Acquire(ctx, s.db, tenantID, s.logger)
		}
		if err != nil {
			return s.internalDBError(ctx, "failed to acquire tenant connection", err, "tenant_id", tenantID.String())
		}
		defer release()
		queries := dbmodels.New(conn)

		tenant, err := queries.GetTenantByID(ctx, tenantID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return connect.NewError(connect.CodeNotFound, "tenant not found")
			}
			return s.internalDBError(ctx, "failed to get tenant", err, "tenant_id", tenantID.String())
		}
		if tenantstatus.IsSuspended(tenant) {
			return tenantstatus.Refusal()
		}

		tracing.SetTenant(ctx, tenant.PublicID)
		ctx = rpcmiddleware.WithTenantContext(ctx, rpcmiddleware.TenantContext{TenantID: tenant.ID, TenantPublicID: tenant.PublicID})
		ctx = rpcmiddleware.WithTenantConn(ctx, conn)
		ctx = rpcmiddleware.WithTenantQueries(ctx, queries)
		return next(ctx)
	})
}

type tenantScopedRequest interface {
	GetTenant() *publirattypesv1.TenantContext
}
