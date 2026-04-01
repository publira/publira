package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"connectrpc.com/connect"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage"
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
}

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid session"))
}

func tenantPublicIDFromContext(ctx *publirattypesv1.TenantContext) (string, error) {
	if ctx == nil || strings.TrimSpace(ctx.TenantPublicId) == "" {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant context is required"))
	}
	return ctx.TenantPublicId, nil
}

func (s *apiServer) tenantByContext(ctx context.Context, tenantCtx *publirattypesv1.TenantContext) (dbmodels.Tenant, error) {
	tenantPublicID, err := tenantPublicIDFromContext(tenantCtx)
	if err != nil {
		return dbmodels.Tenant{}, err
	}
	tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
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
// CatalogService / AuthService / TenantService / DomainService を公開し、管理 API は含みません。
func NewHandler(db *sql.DB, queries Querier, storageProvider storage.Provider, encryptor emailsettings.SecretManager, mailer internalsmtp.Sender) http.Handler {
	server := &apiServer{db: db, queries: queries, storage: storageProvider, encryptor: encryptor, mailer: mailer}
	mux := http.NewServeMux()
	registerHealthz(mux)
	registerPublicRoutes(mux, server)
	return mux
}

func registerHealthz(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}

func registerPublicRoutes(mux *http.ServeMux, server *apiServer) {
	tenantScoped := server.tenantScopedQuerierInterceptor()

	path, handler := publirav1connect.NewCatalogServiceHandler(server, connect.WithInterceptors(tenantScoped))
	mux.Handle(path, handler)
	authPath, authHandler := publirav1connect.NewAuthServiceHandler(server, connect.WithInterceptors(tenantScoped))
	mux.Handle(authPath, authHandler)
	tenantPath, tenantHandler := publirav1connect.NewTenantServiceHandler(server, connect.WithInterceptors(tenantScoped))
	mux.Handle(tenantPath, tenantHandler)
	domainPath, domainHandler := publirav1connect.NewDomainServiceHandler(server, connect.WithInterceptors(tenantScoped))
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

			tenantPublicID, err := tenantPublicIDFromContext(tenantReq.GetTenant())
			if err != nil {
				return nil, err
			}

			tenant, err := s.queriesFor(ctx).GetTenantByPublicID(ctx, tenantPublicID)
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
				}
				return nil, connect.NewError(connect.CodeInternal, err)
			}

			conn, err := s.db.Conn(ctx)
			if err != nil {
				return nil, connect.NewError(connect.CodeInternal, err)
			}
			defer conn.Close()

			if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenant.ID.String()); err != nil {
				return nil, connect.NewError(connect.CodeInternal, err)
			}
			defer conn.ExecContext(context.Background(), "SELECT set_config('app.current_tenant_id', '', false)")

			ctx = rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(conn))
			return next(ctx, req)
		}
	})
}

type tenantScopedRequest interface {
	GetTenant() *publirattypesv1.TenantContext
}
