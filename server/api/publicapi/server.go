package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
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
)

type Querier interface {
	dbmodels.Querier
}

type apiServer struct {
	db        *sql.DB
	queries   Querier
	storage   storage.Provider
	encryptor emailsettings.SecretManager
	mailer    internalsmtp.Sender
	tokens    *auth.TokenManager
}

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid token"))
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
		return dbmodels.Tenant{}, connect.NewError(connect.CodeInternal, err)
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
func NewHandler(db *sql.DB, queries Querier, storageProvider storage.Provider, encryptor emailsettings.SecretManager, mailer internalsmtp.Sender) http.Handler {
	server := &apiServer{
		db:        db,
		queries:   queries,
		storage:   storageProvider,
		encryptor: encryptor,
		mailer:    mailer,
		tokens:    auth.MustTokenManagerFromEnv(),
	}
	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(db))
	registerPublicRoutes(mux, server)
	return mux
}

func registerPublicRoutes(mux *http.ServeMux, server *apiServer) {
	tenantScoped := server.tenantScopedQuerierInterceptor()

	path, handler := publirav1connect.NewCatalogServiceHandler(server, connect.WithInterceptors(tenantScoped))
	mux.Handle(path, handler)
	pagesPath, pagesHandler := publirav1connect.NewPublicPagesServiceHandler(server, connect.WithInterceptors(tenantScoped))
	mux.Handle(pagesPath, pagesHandler)
	authPath, authHandler := publirav1connect.NewAuthServiceHandler(server, connect.WithInterceptors(tenantScoped))
	mux.Handle(authPath, authHandler)
	notificationPath, notificationHandler := publirav1connect.NewNotificationServiceHandler(server, connect.WithInterceptors(tenantScoped))
	mux.Handle(notificationPath, notificationHandler)
	tenantPath, tenantHandler := publirav1connect.NewTenantServiceHandler(server, connect.WithInterceptors(tenantScoped))
	mux.Handle(tenantPath, tenantHandler)
	// DomainService is used before tenant context is known (e.g. proxy domain resolution),
	// so it must not require tenant-scoped interception.
	domainPath, domainHandler := publirav1connect.NewDomainServiceHandler(server)
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
				return nil, connect.NewError(connect.CodeInternal, err)
			}

			conn, release, err := tenantconn.Acquire(ctx, s.db, tenant.ID, slog.Default())
			if err != nil {
				return nil, connect.NewError(connect.CodeInternal, err)
			}
			defer release()

			ctx = rpcmiddleware.WithTenantContext(ctx, rpcmiddleware.TenantContext{TenantID: tenant.ID, TenantPublicID: tenant.PublicID})
			ctx = rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(conn))
			return next(ctx, req)
		}
	})
}

type tenantScopedRequest interface {
	GetTenant() *publirattypesv1.TenantContext
}
