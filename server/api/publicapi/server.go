package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/tenantconn"
	"github.com/publira/publira/server/internal/tracing"
)

type Querier interface {
	dbmodels.Querier
}

type stripeSessionCreator interface {
	create(ctx context.Context, input stripeCheckoutInput) (string, error)
}

type apiServer struct {
	db                *sql.DB
	queries           Querier
	storage           storage.Provider
	encryptor         emailsettings.SecretManager
	mailer            internalsmtp.Sender
	tokens            *auth.TokenManager
	logger            *slog.Logger
	newStripeProvider func(secretKey string) stripeSessionCreator
	webHostURL        *url.URL
}

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid token"))
}

// internalDBError keeps context cancellation and deadline errors as-is so
// Connect can map them to CodeCanceled / CodeDeadlineExceeded. Other DB
// failures are logged and replaced with a generic client-facing message so
// driver details never leave the server.
func (s *apiServer) internalDBError(ctx context.Context, msg string, err error, keyvals ...any) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	args := make([]any, 0, len(keyvals)+2)
	args = append(args, keyvals...)
	args = append(args, "error", err)
	s.logger.ErrorContext(ctx, msg, args...)
	return connect.NewError(connect.CodeInternal, errors.New("internal server error"))
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

// NewHandler は公開 API 専用の HTTP ハンドラを返します。
// CatalogService / AuthService / NotificationService / TenantService / DomainService を公開し、管理 API は含みません。
func NewHandler(db *sql.DB, queries Querier, storageProvider storage.Provider, encryptor emailsettings.SecretManager, mailer internalsmtp.Sender, tokens *auth.TokenManager) http.Handler {
	return handlerFromServer(newAPIServer(db, queries, storageProvider, encryptor, mailer, tokens, slog.Default()))
}

func newAPIServer(
	db *sql.DB,
	queries Querier,
	storageProvider storage.Provider,
	encryptor emailsettings.SecretManager,
	mailer internalsmtp.Sender,
	tokens *auth.TokenManager,
	logger *slog.Logger,
) *apiServer {
	if logger == nil {
		logger = slog.Default()
	}
	webHostURL, err := parseWebHostURL(os.Getenv("PUBLIRA_WEB_HOST_URL"))
	if err != nil {
		logger.Error("Stripe Checkout is disabled because PUBLIRA_WEB_HOST_URL is invalid", "error", err)
	}
	return &apiServer{
		db:        db,
		queries:   queries,
		storage:   storageProvider,
		encryptor: encryptor,
		mailer:    mailer,
		tokens:    tokens,
		logger:    logger,
		newStripeProvider: func(secretKey string) stripeSessionCreator {
			return newStripeCheckoutProvider(secretKey)
		},
		webHostURL: webHostURL,
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
	traced := tracing.ConnectHandlerOption()

	path, handler := publirav1connect.NewCatalogServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(path, handler)
	purchasePath, purchaseHandler := publirav1connect.NewPurchaseServiceHandler(server, traced, connect.WithInterceptors(tenantScoped))
	mux.Handle(purchasePath, purchaseHandler)
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
			if strings.Contains(strings.ToLower(fmt.Sprintf("%T", s.db.Driver())), "sqlmock") {
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
			ctx = rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(conn))
			return next(ctx, req)
		}
	})
}

type tenantScopedRequest interface {
	GetTenant() *publirattypesv1.TenantContext
}
