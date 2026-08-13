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

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/tenantconn"
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
	tokens    *auth.TokenManager
}

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid token"))
}

// internalDBError keeps context cancellation and deadline errors as-is so
// Connect can map them to CodeCanceled / CodeDeadlineExceeded. Other DB
// failures are logged and replaced with a generic client-facing message so
// driver details never leave the server.
func (s *adminServer) internalDBError(msg string, err error, keyvals ...any) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	args := make([]any, 0, len(keyvals)+2)
	args = append(args, keyvals...)
	args = append(args, "error", err)
	s.logger.Error(msg, args...)
	return connect.NewError(connect.CodeInternal, errors.New("internal server error"))
}

func tenantIDFromContext(ctx *publirattypesv1.TenantContext) (uuid.UUID, error) {
	return rpcmiddleware.ResolveTenantID(ctx, nil)
}

func (s *adminServer) tenantByContext(ctx context.Context, tenantCtx *publirattypesv1.TenantContext) (dbmodels.Tenant, error) {
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		return sessionCtx.Tenant, nil
	}
	tenantID, err := tenantIDFromContext(tenantCtx)
	if err != nil {
		return dbmodels.Tenant{}, err
	}
	tenant, err := s.queriesFor(ctx).GetTenantByID(ctx, tenantID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.Tenant{}, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return dbmodels.Tenant{}, s.internalDBError("failed to get tenant", err, "tenant_id", tenantID.String())
	}
	return tenant, nil
}

func (s *adminServer) queriesFor(ctx context.Context) Querier {
	if queries, ok := rpcmiddleware.TenantQueriesFromContext(ctx); ok {
		return queries
	}
	return s.queries
}

// recorderFor returns an audit recorder bound to the tenant-scoped connection of
// the current request. audit_logs is under RLS and the admin API connects as
// publira_admin, so an entry written through the pool-level querier — which
// carries no app.current_tenant_id — is rejected by the tenant isolation policy
// and the event is lost. Falls back to the pool-level recorder when no
// tenant-scoped connection is in play (sqlmock tests, unauthenticated paths).
func (s *adminServer) recorderFor(ctx context.Context) *auditlog.Recorder {
	if queries, ok := rpcmiddleware.TenantQueriesFromContext(ctx); ok {
		return auditlog.New(queries, s.logger)
	}
	return s.recorder
}

func (s *adminServer) authenticateSession(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	headers http.Header,
) (rpcmiddleware.SessionContext, error) {
	tenant, err := s.tenantByContext(ctx, tenantCtx)
	if err != nil {
		return rpcmiddleware.SessionContext{}, err
	}
	rawToken, ok := auth.BearerTokenFromHeader(headers)
	if !ok || s.tokens == nil {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	claims, err := s.tokens.Verify(rawToken, auth.AudienceAdmin)
	if err != nil {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	if claims.TenantID != "" && claims.TenantID != tenant.ID.String() {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	userRef, err := s.queriesFor(ctx).GetUserByPublicIDForTenant(ctx, dbmodels.GetUserByPublicIDForTenantParams{
		PublicID: claims.Subject,
		TenantID: uuid.NullUUID{UUID: tenant.ID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, err)
	}
	user, err := s.queriesFor(ctx).GetUserByID(ctx, userRef.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, err)
	}
	if user.Status != "active" || user.CredentialsVersion != claims.CredentialsVersion {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, err)
	}
	return rpcmiddleware.SessionContext{
		Tenant: tenant,
		User:   user,
		Role:   auth.ResolveTenantRole(roles),
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
		tokens:    auth.MustTokenManagerFromEnv(),
	}
	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(db))
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
	tenantSettingsPath, tenantSettingsHandler := publiraadminv1connect.NewTenantSettingsServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(tenantSettingsPath, tenantSettingsHandler)
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
	adminAuthPath, adminAuthHandler := publiraadminv1connect.NewAdminAuthServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
		),
	)
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
	pagesPath, pagesHandler := publiraadminv1connect.NewAdminPagesServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(pagesPath, pagesHandler)
	announcementPath, announcementHandler := publiraadminv1connect.NewAdminAnnouncementServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(announcementPath, announcementHandler)
	accessTicketPath, accessTicketHandler := publiraadminv1connect.NewAdminAccessTicketServiceHandler(
		server,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(accessTicketPath, accessTicketHandler)
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

			conn, release, err := tenantconn.Acquire(ctx, s.db, tenant.ID, s.logger)
			if err != nil {
				return nil, s.internalDBError("failed to acquire tenant-scoped connection", err, "tenant_id", tenant.ID.String())
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
