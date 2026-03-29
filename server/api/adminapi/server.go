package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"

	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage"
)

// Querier は adminapi が必要とする DB 操作インターフェースです。
type Querier interface {
	dbmodels.Querier
}

type adminServer struct {
	queries   Querier
	storage   storage.Provider
	recorder  *auditlog.Recorder
	encryptor emailsettings.SecretManager
	tester    internalsmtp.Tester
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

func (s *adminServer) tenantByContext(ctx context.Context, tenantCtx *publirattypesv1.TenantContext) (dbmodels.Tenant, error) {
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		return sessionCtx.Tenant, nil
	}
	tenantPublicID, err := tenantPublicIDFromContext(tenantCtx)
	if err != nil {
		return dbmodels.Tenant{}, err
	}
	tenant, err := s.queries.GetTenantByPublicID(ctx, tenantPublicID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Tenant{}, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return dbmodels.Tenant{}, connect.NewError(connect.CodeInternal, err)
	}
	return tenant, nil
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
	lookup, err := auth.LookupSessionByTokenHashForTenant(ctx, s.queries, tenant.ID, auth.HashToken(sessionToken), time.Now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, err)
	}
	if lookup.State != auth.SessionStateActive {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	user, err := s.queries.GetUserByID(ctx, lookup.Session.UserID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, err)
	}
	roles, err := s.queries.ListTenantUserRoles(ctx, user.ID)
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
func NewHandler(queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester) http.Handler {
	server := &adminServer{
		queries:   queries,
		storage:   storageProvider,
		recorder:  auditlog.New(queries, logger),
		encryptor: encryptor,
		tester:    tester,
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
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(adminPath, adminHandler)
	creatorPath, creatorHandler := publiraadminv1connect.NewAdminCreatorServiceHandler(
		server,
		connect.WithInterceptors(
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(creatorPath, creatorHandler)
	labelPath, labelHandler := publiraadminv1connect.NewAdminLabelServiceHandler(
		server,
		connect.WithInterceptors(
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(labelPath, labelHandler)
	auditPath, auditHandler := publiraadminv1connect.NewAdminAuditLogServiceHandler(
		server,
		connect.WithInterceptors(
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(auditPath, auditHandler)
	userPath, userHandler := publiraadminv1connect.NewAdminUserServiceHandler(
		server,
		connect.WithInterceptors(
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(userPath, userHandler)
	emailPath, emailHandler := publiraadminv1connect.NewAdminEmailSettingsServiceHandler(
		server,
		connect.WithInterceptors(
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
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(dashboardPath, dashboardHandler)
	return mux
}
