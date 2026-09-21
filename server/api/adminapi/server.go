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

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/tenantconn"
	"github.com/publira/publira/server/internal/tracing"
)

// Querier is the set of database operations adminapi needs.
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
	logger                *slog.Logger
	reval                 *revalidate.Requester
	tokens                *auth.TokenManager
	// policy answers whether a tenant admin must enroll a second factor. It is
	// the platform's decision, so a tenant cannot lock itself out of its own
	// console.
	policy platformpolicy.Source
	// mail bounds how much mail the console's own forms may cause.
	mail *mailguard.Guard
}

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid token"))
}

// storageUploadError keeps context cancellation and deadline errors uncoded so
// Connect maps them to CodeCanceled / CodeDeadlineExceeded at the protocol
// boundary. A platform with no object store saved is a precondition the
// Platform Console resolves; other storage failures are internal.
func storageUploadError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	if errors.Is(err, storage.ErrNotConfigured) {
		return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, storage.ErrNotConfigured, rpcerrors.ReasonStorageNotConfigured)
	}
	return connect.NewError(connect.CodeInternal, err)
}

// internalDBError keeps context cancellation and deadline errors as-is so
// Connect can map them to CodeCanceled / CodeDeadlineExceeded. Other DB
// failures are logged and replaced with a generic client-facing message so
// driver details never leave the server.
func (s *adminServer) internalDBError(ctx context.Context, msg string, err error, keyvals ...any) error {
	return s.internalError(ctx, msg, err, keyvals...)
}

// internalError is internalDBError for a failure the database reported no
// problem with — a stored value the server cannot make sense of, say. The
// caller sees the same generic message either way.
func (s *adminServer) internalError(ctx context.Context, msg string, err error, keyvals ...any) error {
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

// revalidateTags records what a committed write left stale and sends it. The
// failure it can still have is the record, and that one is logged rather than
// returned: the write is already committed, and a console save must not fail
// because a cache entry outlived it.
func (s *adminServer) revalidateTags(ctx context.Context, tenantID uuid.UUID, tags []string) {
	owed, err := s.recordRevalidation(ctx, tenantID, tags)
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

// recordRevalidation writes the invalidation down on the querier the context
// carries, so a handler that passes its transaction's context owes the drop
// only if that transaction commits. Send the result once it has.
//
// The error is the caller's to act on rather than this helper's to log, because
// what it means depends on where the write is: a caller still holding the
// transaction has to roll it back instead of committing a write whose drop
// nothing owes. A deployment with revalidation turned off is not that case — it
// owes nothing and answers a zero [revalidate.Owed] and no error.
func (s *adminServer) recordRevalidation(
	ctx context.Context,
	tenantID uuid.UUID,
	tags []string,
) (revalidate.Owed, error) {
	return s.reval.Record(ctx, s.queriesFor(ctx), tenantID, tags)
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

// ServiceName is the service.name this namespace's spans carry. The three
// namespaces share a process and keep their own name, so a trace UI can still
// tell the tenant console's work from the public API's.
const ServiceName = "publira-admin-api-server"

// API is the tenant console's namespace — AdminSeriesService,
// AdminAuthService and the rest of publira.admin.v1 — ready to be mounted by
// [API.Register].
type API struct {
	server *adminServer
}

// New builds the tenant console API over db, which must be the pool connected
// as publira_admin: every handler here reads through that role's row-level
// security.
func New(db *sql.DB, queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager) (*API, error) {
	return newAPI(db, queries, storageProvider, logger, encryptor, tester, tokens, nil, nil)
}

// NewWithAsyncRecorder is New with an AsyncRecorder. The asynchronous writer
// acquires a fresh tenant-scoped connection for every tenant audit entry.
func NewWithAsyncRecorder(db *sql.DB, queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, recorder *auditlog.AsyncRecorder) (*API, error) {
	return newAPI(db, queries, storageProvider, logger, encryptor, tester, tokens, recorder, nil)
}

// Register mounts the publira.admin.v1 services on mux. What a mux carries is
// what its listener serves, so this belongs on the internal listener alone:
// the edge forwards /api host-agnostically, and a mux the edge reaches would
// put the console's RPCs on every tenant site.
func (a *API) Register(mux *http.ServeMux) {
	registerAdminRoutes(mux, a.server)
}

func newAPI(db *sql.DB, queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, recorder auditlog.Recorder, mail *mailguard.Guard) (*API, error) {
	if logger == nil {
		logger = slog.Default()
	}
	policy := platformpolicy.NewResolver(dbmodels.New(db), platformpolicy.CacheTTL, logger)
	// A nil guard is the production one: the platform policy's limits over the
	// counters the deployment shares.
	if mail == nil {
		mail = mailguard.NewShared(policy, logger)
	}
	requestScopedRecorder := recorder == nil
	if recorder == nil {
		recorder = auditlog.New(queries, logger)
	}
	revalidateToken := strings.TrimSpace(os.Getenv("PUBLIRA_REVALIDATE_TOKEN"))
	revalidateClient, revalidateErr := revalidate.NewClient(revalidateToken, logger)
	if revalidateErr != nil {
		logger.Warn("next revalidate is disabled", "reason", revalidateErr.Error())
	} else if revalidateClient == nil {
		logger.Info("next revalidate is disabled", "reason", "PUBLIRA_REVALIDATE_TOKEN is empty")
	}
	revalidator := revalidate.NewRequester(revalidate.RequesterConfig{
		Client:  revalidateClient,
		Queries: queries,
		DB:      db,
		Logger:  logger,
	})
	server := &adminServer{
		db:                    db,
		queries:               queries,
		storage:               storageProvider,
		recorder:              recorder,
		requestScopedRecorder: requestScopedRecorder,
		encryptor:             encryptor,
		tester:                tester,
		logger:                logger,
		reval:                 revalidator,
		tokens:                tokens,

		policy: policy,
		mail:   mail,
	}
	return &API{server: server}, nil
}

// handlerFromServer is the namespace on a mux of its own, health probes
// included, as a process serving nothing else would mount it.
func handlerFromServer(server *adminServer) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(server.db))
	registerAdminRoutes(mux, server)
	return mux
}

func registerAdminRoutes(mux *http.ServeMux, server *adminServer) {
	traced := tracing.ConnectHandlerOption(ServiceName)

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
	genrePath, genreHandler := publiraadminv1connect.NewAdminGenreServiceHandler(
		server,
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(genrePath, genreHandler)
	creatorRolePath, creatorRoleHandler := publiraadminv1connect.NewAdminCreatorRoleServiceHandler(
		server,
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(creatorRolePath, creatorRoleHandler)
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
	engagementPath, engagementHandler := publiraadminv1connect.NewAdminEngagementServiceHandler(
		server,
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(engagementPath, engagementHandler)
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
	commentPath, commentHandler := publiraadminv1connect.NewAdminCommentServiceHandler(
		server,
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(commentPath, commentHandler)
	contactPath, contactHandler := publiraadminv1connect.NewAdminContactServiceHandler(
		server,
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(contactPath, contactHandler)
	royaltyPath, royaltyHandler := publiraadminv1connect.NewAdminRoyaltyServiceHandler(
		server,
		traced,
		connect.WithInterceptors(
			server.tenantScopedQuerierInterceptor(),
			rpcmiddleware.NewUnaryContextBuilderInterceptor(
				rpcmiddleware.BuildAdminSessionContext(server.authenticateSession),
			),
		),
	)
	mux.Handle(royaltyPath, royaltyHandler)
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
