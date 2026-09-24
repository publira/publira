package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/tenantconn"
	"github.com/publira/publira/server/internal/tracing"
	"github.com/publira/publira/server/internal/webpushsettings"
)

type Querier interface {
	dbmodels.Querier
}

type apiServer struct {
	db        *sql.DB
	queries   Querier
	encryptor emailsettings.SecretManager
	tokens    *auth.TokenManager
	logger    *slog.Logger
	guards    readerGuards
	mail      *mailguard.Guard
	reval     *revalidate.Requester
	// webPushKeys answers the VAPID public key browsers subscribe with, empty
	// while Web Push is not configured.
	webPushKeys webPushPublicKeySource
	// paymentProviders are the providers a tenant's payment settings may name.
	paymentProviders *paymentprovider.Registry
}

type webPushPublicKeySource interface {
	PublicKey(ctx context.Context) (string, error)
}

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid token"))
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
	return connect.NewError(connect.CodeInternal, errors.New("internal server error"))
}

// noStorePrivateResponse marks a response that depends on who is asking, so a
// shared cache never serves one member's state to another. The member-scoped
// public RPCs (follow, rating) return through here.
func noStorePrivateResponse[T any](msg *T) *connect.Response[T] {
	response := connect.NewResponse(msg)
	response.Header().Set("Cache-Control", "private, no-store")
	return response
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
			return dbmodels.Tenant{}, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
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

// revalidateTags records what a committed write left stale and sends it. The
// record is the only step that can still fail, and it is logged rather than
// returned: the write is already committed, and a reader's action must not fail
// because a cache entry outlived it.
func (s *apiServer) revalidateTags(ctx context.Context, tenantID uuid.UUID, tags []string) {
	owed, err := s.reval.Record(ctx, s.queriesFor(ctx), tenantID, tags)
	if err != nil {
		s.logger.WarnContext(ctx, "failed to record a next cache invalidation",
			"tenant_id", tenantID.String(),
			"tags", tags,
			"error", err,
		)
		return
	}
	s.reval.Send(ctx, owed)
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
// role's. Both flood controls read their limits from the platform policy
// through that same pool.
func New(db *sql.DB, queries Querier, encryptor emailsettings.SecretManager, tokens *auth.TokenManager) (*API, error) {
	logger := slog.Default()
	policy := platformpolicy.NewResolver(dbmodels.New(db), platformpolicy.CacheTTL, logger)
	guards := newReaderGuards(policy, logger)
	mail := mailguard.NewShared(policy, logger)
	return &API{server: newAPIServer(db, queries, encryptor, tokens, logger, guards, mail)}, nil
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
	logger *slog.Logger,
	guards readerGuards,
	mail *mailguard.Guard,
) *apiServer {
	if logger == nil {
		logger = slog.Default()
	}
	if mail == nil {
		mail = mailguard.NewDefault()
	}
	// Disabled rather than fatal when the token or a target URL is missing, as
	// the console's client is: every other RPC here answers a reader without
	// invalidating anything, and the one removal that does is one the
	// storefront catches up with when its cached list expires.
	revalidateClient, revalidateErr := revalidate.NewClient(strings.TrimSpace(os.Getenv("PUBLIRA_REVALIDATE_TOKEN")), logger)
	if revalidateErr != nil {
		logger.Warn("next revalidate is disabled", "reason", revalidateErr.Error())
	}
	revalidator := revalidate.NewRequester(revalidate.RequesterConfig{
		Client:  revalidateClient,
		Queries: queries,
		DB:      db,
		Logger:  logger,
	})
	return &apiServer{
		db:               db,
		queries:          queries,
		encryptor:        encryptor,
		tokens:           tokens,
		logger:           logger,
		guards:           guards.withDefaults(),
		mail:             mail,
		reval:            revalidator,
		webPushKeys:      webpushsettings.NewPublicKeys(dbmodels.New(db), webpushsettings.CacheTTL, logger),
		paymentProviders: providers.Registry(),
	}
}

func handlerFromServer(server *apiServer) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(server.db))
	registerPublicRoutes(mux, server)
	return mux
}

func registerPublicRoutes(mux *http.ServeMux, server *apiServer) {
	tenantScoped := server.tenantScopedQuerierInterceptor()
	traced := tracing.ConnectHandlerOption(ServiceName)

	path, handler := publirav1connect.NewCatalogServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(path, handler)
	episodeReadPath, episodeReadHandler := publirav1connect.NewEpisodeReadServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(episodeReadPath, episodeReadHandler)
	purchasePath, purchaseHandler := publirav1connect.NewPurchaseServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(purchasePath, purchaseHandler)
	followPath, followHandler := publirav1connect.NewFollowServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(followPath, followHandler)
	ratingPath, ratingHandler := publirav1connect.NewRatingServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(ratingPath, ratingHandler)
	contentViewPath, contentViewHandler := publirav1connect.NewContentViewServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(contentViewPath, contentViewHandler)
	commentPath, commentHandler := publirav1connect.NewCommentServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(commentPath, commentHandler)
	contactPath, contactHandler := publirav1connect.NewContactServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(contactPath, contactHandler)
	pagesPath, pagesHandler := publirav1connect.NewPublicPagesServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(pagesPath, pagesHandler)
	authPath, authHandler := publirav1connect.NewAuthServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(authPath, authHandler)
	notificationPath, notificationHandler := publirav1connect.NewNotificationServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(notificationPath, notificationHandler)
	tenantPath, tenantHandler := publirav1connect.NewTenantServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(tenantPath, tenantHandler)
	// DomainService is used before tenant context is known (e.g. proxy domain resolution),
	// so it must not require tenant-scoped interception.
	domainPath, domainHandler := publirav1connect.NewDomainServiceHandler(server, traced)
	mux.Handle(domainPath, domainHandler)
}

func (s *apiServer) tenantScopedQuerierInterceptor() connect.Interceptor {
	return connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if s.db == nil {
				return next(ctx, req)
			}
			if isSQLMockDB(s.db) {
				return next(ctx, req)
			}

			tenantReq, ok := req.Any().(tenantScopedRequest)
			if !ok {
				return next(ctx, req)
			}

			tenantID, err := rpcmiddleware.ResolveTenantID(tenantReq.GetTenant(), req.Header())
			if err != nil {
				return nil, err
			}

			tenant, err := s.queriesFor(ctx).GetTenantByID(ctx, tenantID)
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
				}
				return nil, s.internalDBError(ctx, "failed to get tenant", err, "tenant_id", tenantID.String())
			}

			conn, release, err := tenantconn.Acquire(ctx, s.db, tenant.ID, s.logger)
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to acquire tenant connection", err, "tenant_id", tenant.ID.String())
			}
			defer release()

			tracing.SetTenant(ctx, tenant.PublicID)
			ctx = rpcmiddleware.WithTenantContext(ctx, rpcmiddleware.TenantContext{TenantID: tenant.ID, TenantPublicID: tenant.PublicID})
			ctx = rpcmiddleware.WithTenantConn(ctx, conn)
			ctx = rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(conn))
			return next(ctx, req)
		}
	})
}

type tenantScopedRequest interface {
	GetTenant() *publirattypesv1.TenantContext
}
