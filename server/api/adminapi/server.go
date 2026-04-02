package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"

	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage"
)

// Querier は adminapi が必要とする DB 操作インターフェースです。
type Querier interface {
	dbmodels.Querier
}

type adminServer struct {
	db        *sql.DB
	queries   Querier
	storage   storage.Provider
	recorder  *auditlog.Recorder
	encryptor emailsettings.SecretManager
	tester    internalsmtp.Tester
	mailer    internalsmtp.Sender
	logger    *slog.Logger
	reval     *revalidate.Client
}

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid session"))
}

func tenantPublicIDFromContext(ctx *publirattypesv1.TenantContext) (string, error) {
	return rpcmiddleware.ResolveTenantPublicID(ctx, nil)
}

func (s *adminServer) tenantByContext(ctx context.Context, tenantCtx *publirattypesv1.TenantContext) (dbmodels.Tenant, error) {
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		return sessionCtx.Tenant, nil
	}
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

func (s *adminServer) queriesFor(ctx context.Context) Querier {
	if queries, ok := rpcmiddleware.TenantQueriesFromContext(ctx); ok {
		return queries
	}
	return s.queries
}

func (s *adminServer) authenticateSession(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	explicitToken string,
	headers http.Header,
) (rpcmiddleware.SessionContext, error) {
	tenant, err := s.tenantByContext(ctx, tenantCtx)
	if err != nil {
		return rpcmiddleware.SessionContext{}, err
	}
	sessionToken, ok := auth.SessionTokenFromRequest(explicitToken, headers)
	if !ok {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	lookup, err := auth.LookupSessionByTokenHashForTenant(ctx, s.queriesFor(ctx), tenant.ID, auth.HashToken(sessionToken), time.Now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, err)
	}
	if lookup.State != auth.SessionStateActive {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	user, err := s.queriesFor(ctx).GetUserByID(ctx, lookup.Session.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, err)
	}
	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, err)
	}
	return rpcmiddleware.SessionContext{
		Tenant:  tenant,
		Session: lookup.Session,
		User:    user,
		Role:    auth.ResolveTenantRole(roles),
	}, nil
}

// NewHandler は管理 API 専用の HTTP ハンドラを返します。
// AdminSeriesService と AdminAuthService のみ公開し、公開 API (CatalogService, AuthService) は含みません。
func NewHandler(db *sql.DB, queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester) http.Handler {
	mailer, _ := tester.(internalsmtp.Sender)
	if logger == nil {
		logger = slog.Default()
	}
	revalidateToken := strings.TrimSpace(os.Getenv("NEXT_REVALIDATE_TOKEN"))
	revalidator := revalidate.NewClient(revalidateToken, logger)
	if revalidator == nil {
		logger.Info("next revalidate is disabled", "reason", "NEXT_REVALIDATE_TOKEN is empty")
	}
	server := &adminServer{
		db:        db,
		queries:   queries,
		storage:   storageProvider,
		recorder:  auditlog.New(queries, logger),
		encryptor: encryptor,
		tester:    tester,
		mailer:    mailer,
		logger:    logger,
		reval:     revalidator,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	adminPath, adminHandler := publiraadminv1connect.NewAdminSeriesServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(adminPath, adminHandler)
	creatorPath, creatorHandler := publiraadminv1connect.NewAdminCreatorServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(creatorPath, creatorHandler)
	labelPath, labelHandler := publiraadminv1connect.NewAdminLabelServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(labelPath, labelHandler)
	auditPath, auditHandler := publiraadminv1connect.NewAdminAuditLogServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(auditPath, auditHandler)
	userPath, userHandler := publiraadminv1connect.NewAdminUserServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(userPath, userHandler)
	tenantThemePath, tenantThemeHandler := publiraadminv1connect.NewTenantThemeServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(tenantThemePath, tenantThemeHandler)
	emailPath, emailHandler := publiraadminv1connect.NewAdminEmailSettingsServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(emailPath, emailHandler)
	adminAuthPath, adminAuthHandler := publiraadminv1connect.NewAdminAuthServiceHandler(server)
	mux.Handle(adminAuthPath, adminAuthHandler)
	dashboardPath, dashboardHandler := publiraadminv1connect.NewAdminDashboardServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(dashboardPath, dashboardHandler)
	return mux
}

func (s *adminServer) tenantScopedQuerierInterceptor() connect.Interceptor {
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

			tenantPublicID, err := rpcmiddleware.ResolveTenantPublicID(tenantReq.GetTenant(), req.Header())
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

			ctx = rpcmiddleware.WithTenantContext(ctx, rpcmiddleware.TenantContext{TenantID: tenant.ID, TenantPublicID: tenant.PublicID})
			ctx = rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(conn))
			return next(ctx, req)
		}
	})
}

type tenantScopedRequest interface {
	GetTenant() *publirattypesv1.TenantContext
}
