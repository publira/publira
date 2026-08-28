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
	"github.com/publira/publira/server/internal/tracing"
)

// Querier は adminapi が必要とする DB 操作インターフェースです。
type Querier interface {
	dbmodels.Querier
}

type adminServer struct {
	db       *sql.DB
	queries  Querier
	storage  storage.Provider
	recorder auditlog.Recorder
	// requestScopedRecorder keeps the synchronous test recorder on the RLS
	// connection acquired by the request. AsyncRecorder instead acquires a new
	// tenant-scoped connection after the request finishes.
	requestScopedRecorder bool
	encryptor             emailsettings.SecretManager
	tester                internalsmtp.Tester
	mailer                internalsmtp.Sender
	logger                *slog.Logger
	reval                 *revalidate.Client
	tokens                *auth.TokenManager
}

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid token"))
}

// internalDBError keeps context cancellation and deadline errors as-is so
// Connect can map them to CodeCanceled / CodeDeadlineExceeded. Other DB
// failures are logged and replaced with a generic client-facing message so
// driver details never leave the server.
func (s *adminServer) internalDBError(ctx context.Context, msg string, err error, keyvals ...any) error {
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
		return dbmodels.Tenant{}, s.internalDBError(ctx, "failed to get tenant", err, "tenant_id", tenantID.String())
	}
	return tenant, nil
}

func (s *adminServer) queriesFor(ctx context.Context) Querier {
	if queries, ok := rpcmiddleware.TenantQueriesFromContext(ctx); ok {
		return queries
	}
	return s.queries
}

// beginTenantTx starts a transaction on the request's tenant-scoped
// connection. Falling back to s.db.BeginTx would leave RLS: that path
// borrows a different pool connection that has never set
// app.current_tenant_id. sqlmock tests skip the interceptor, so they
// are the only callers allowed to begin on the pool.
func (s *adminServer) beginTenantTx(ctx context.Context) (*sql.Tx, error) {
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

func (s *adminServer) recorderFor(ctx context.Context) auditlog.Recorder {
	if s.requestScopedRecorder {
		if queries, ok := rpcmiddleware.TenantQueriesFromContext(ctx); ok {
			return auditlog.New(queries, s.logger)
		}
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
		return rpcmiddleware.SessionContext{}, s.internalDBError(ctx, "failed to get session user by public id", err, "tenant_id", tenant.ID.String())
	}
	user, err := s.queriesFor(ctx).GetUserByID(ctx, userRef.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return rpcmiddleware.SessionContext{}, invalidSessionError()
		}
		return rpcmiddleware.SessionContext{}, s.internalDBError(ctx, "failed to get session user", err, "tenant_id", tenant.ID.String(), "user_id", userRef.ID.String())
	}
	if user.Status != "active" || user.CredentialsVersion != claims.CredentialsVersion {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
	}
	roles, err := s.queriesFor(ctx).ListTenantUserRoles(ctx, user.ID)
	if err != nil {
		return rpcmiddleware.SessionContext{}, s.internalDBError(ctx, "failed to list session user roles", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	tracing.SetEndUser(ctx, user.PublicID)
	return rpcmiddleware.SessionContext{
		Tenant: tenant,
		User:   user,
		Role:   auth.ResolveTenantRole(roles),
	}, nil
}

// NewHandler は管理 API 専用の HTTP ハンドラを返します。
// AdminSeriesService と AdminAuthService のみ公開し、公開 API (CatalogService, AuthService) は含みません。
func NewHandler(db *sql.DB, queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager) http.Handler {
	return newHandler(db, queries, storageProvider, logger, encryptor, tester, tokens, nil)
}

// NewHandlerWithAsyncRecorder creates an admin API handler with an
// AsyncRecorder. The asynchronous writer acquires a fresh tenant-scoped
// connection for every tenant audit entry.
func NewHandlerWithAsyncRecorder(db *sql.DB, queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, recorder *auditlog.AsyncRecorder) http.Handler {
	return newHandler(db, queries, storageProvider, logger, encryptor, tester, tokens, recorder)
}

func newHandler(db *sql.DB, queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, recorder auditlog.Recorder) http.Handler {
	mailer, _ := tester.(internalsmtp.Sender)
	if logger == nil {
		logger = slog.Default()
	}
	requestScopedRecorder := recorder == nil
	if recorder == nil {
		recorder = auditlog.New(queries, logger)
	}
	revalidateToken := strings.TrimSpace(os.Getenv("PUBLIRA_REVALIDATE_TOKEN"))
	revalidator, revalidateErr := revalidate.NewClient(revalidateToken, logger)
	if revalidateErr != nil {
		logger.Warn("next revalidate is disabled", "reason", revalidateErr.Error())
	} else if revalidator == nil {
		logger.Info("next revalidate is disabled", "reason", "PUBLIRA_REVALIDATE_TOKEN is empty")
	}
	server := &adminServer{
		db:                    db,
		queries:               queries,
		storage:               storageProvider,
		recorder:              recorder,
		requestScopedRecorder: requestScopedRecorder,
		encryptor:             encryptor,
		tester:                tester,
		mailer:                mailer,
		logger:                logger,
		reval:                 revalidator,
		tokens:                tokens,
	}
	traced := tracing.ConnectHandlerOption()

	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(db))
	adminPath, adminHandler := publiraadminv1connect.NewAdminSeriesServiceHandler(
		server,
		traced,
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
		traced,
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
		traced,
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
		traced,
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
		traced,
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
		traced,
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
		traced,
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
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(emailPath, emailHandler)
	paymentPath, paymentHandler := publiraadminv1connect.NewAdminPaymentSettingsServiceHandler(
		server,
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(paymentPath, paymentHandler)
	adminAuthPath, adminAuthHandler := publiraadminv1connect.NewAdminAuthServiceHandler(
		server,
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
		),
	)
	mux.Handle(adminAuthPath, adminAuthHandler)
	dashboardPath, dashboardHandler := publiraadminv1connect.NewAdminDashboardServiceHandler(
		server,
		traced,
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
		traced,
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
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(announcementPath, announcementHandler)
	notificationPath, notificationHandler := publiraadminv1connect.NewAdminNotificationServiceHandler(
		server,
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(notificationPath, notificationHandler)
	accessTicketPath, accessTicketHandler := publiraadminv1connect.NewAdminAccessTicketServiceHandler(
		server,
		traced,
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
				return nil, s.internalDBError(ctx, "failed to get tenant for request scope", err, "tenant_id", tenantID.String())
			}

			conn, release, err := tenantconn.Acquire(ctx, s.db, tenant.ID, s.logger)
			if err != nil {
				return nil, s.internalDBError(ctx, "failed to acquire tenant-scoped connection", err, "tenant_id", tenant.ID.String())
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
