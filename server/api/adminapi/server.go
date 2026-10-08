package adminapi

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

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/episodeimages"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/inboundprovider"
	inboundproviders "github.com/publira/publira/server/internal/inboundprovider/providers"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/paymentprovider"
	"github.com/publira/publira/server/internal/paymentprovider/providers"
	"github.com/publira/publira/server/internal/platformpolicy"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/tenantconn"
	"github.com/publira/publira/server/internal/tenantstatus"
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
	// serviceToken admits a web app to the reads in [serviceProcedures].
	serviceToken *auth.ServiceToken
	// policy answers whether a tenant admin must enroll a second factor. It is
	// the platform's decision, so a tenant cannot lock itself out of its own
	// console.
	policy platformpolicy.Source
	// mail bounds how much mail the console's own forms may cause.
	mail *mailguard.Guard
	// login bounds how often a password may be tried at sign-in.
	login *loginguard.Guard
	// paymentProviders are the providers a tenant's payment settings may name.
	paymentProviders *paymentprovider.Registry
	// inboundProviders are the providers a tenant's inbound email settings may
	// name.
	inboundProviders *inboundprovider.Registry
}

func invalidSessionError() error {
	return connect.NewError(connect.CodeUnauthenticated, "invalid token")
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
	return connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
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
	return connect.NewError(connect.CodeInternal, "internal server error")
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
			return dbmodels.Tenant{}, connect.NewError(connect.CodeNotFound, "tenant not found")
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

// writeAndRevalidate runs write in a transaction on the request's tenant-scoped
// connection and records the tags it returns in that same transaction, sending
// them once both have committed. An error from write rolls the transaction back
// and is returned unchanged.
func (s *adminServer) writeAndRevalidate(
	ctx context.Context,
	tenantID uuid.UUID,
	write func(txCtx context.Context) ([]string, error),
) error {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return s.internalDBError(ctx, "failed to begin a write transaction", err, "tenant_id", tenantID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txCtx := rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(tx))
	tags, err := write(txCtx)
	if err != nil {
		return err
	}
	owed, err := s.recordRevalidation(txCtx, tenantID, tags)
	if err != nil {
		return s.internalDBError(ctx, "failed to record a next cache invalidation", err, "tenant_id", tenantID.String(), "tags", tags)
	}
	if err := tx.Commit(); err != nil {
		return s.internalDBError(ctx, "failed to commit a write transaction", err, "tenant_id", tenantID.String())
	}
	s.reval.Send(ctx, owed)
	return nil
}

// recordRevalidation writes the invalidation down on the querier the context
// carries, so a handler that passes its transaction's context owes the drop
// only if that transaction commits. Send the result once it has.
//
// The error is the caller's to act on rather than this helper's to log: the
// caller has to roll its transaction back instead of committing a write whose
// drop nothing owes. A deployment with revalidation turned off is not that
// case — it owes nothing and answers a zero [revalidate.Owed] and no error.
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
	headers *connect.Header,
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
	// The roles are read on every request rather than trusted from the token,
	// so an account whose roles were all taken away loses the session it
	// already holds instead of keeping it until the token expires.
	if !auth.IsTenantStaff(roles) {
		return rpcmiddleware.SessionContext{}, invalidSessionError()
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
// security. reval sends the cache tags its writes leave stale; a nil one turns
// revalidation off.
func New(db *sql.DB, queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, reval *revalidate.Client) (*API, error) {
	api, err := newAPI(db, queries, storageProvider, logger, encryptor, tester, tokens, reval, nil, nil)
	if err != nil {
		return nil, err
	}
	api.server.shareLoginGuard()
	return api, nil
}

// NewWithAsyncRecorder is New with an AsyncRecorder, and with the service
// token the web apps read tenant-level data with; a nil one admits no web app.
// The asynchronous writer acquires a fresh tenant-scoped connection for every
// tenant audit entry.
//
// login and mail are the sign-in limit and the mail limit the process hands
// every namespace it serves, as publicapi.New describes; a nil one counts on
// its own.
func NewWithAsyncRecorder(db *sql.DB, queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, reval *revalidate.Client, recorder *auditlog.AsyncRecorder, serviceToken *auth.ServiceToken, login *loginguard.Guard, mail *mailguard.Guard) (*API, error) {
	api, err := newAPI(db, queries, storageProvider, logger, encryptor, tester, tokens, reval, recorder, mail)
	if err != nil {
		return nil, err
	}
	api.server.serviceToken = serviceToken
	if login == nil {
		api.server.shareLoginGuard()
	} else {
		api.server.login = login
	}
	return api, nil
}

// shareLoginGuard puts the sign-in limit on counters of this namespace's own
// over the ones the deployment shares. newAPI leaves it on in-process counters,
// so no test that signs in reaches the Redis the environment may name.
func (s *adminServer) shareLoginGuard() {
	s.login = loginguard.NewShared(s.policy, s.logger)
}

// Register mounts the publira.admin.v1 services on mux. What a mux carries is
// what its listener serves, so this belongs on the internal listener alone:
// the edge forwards /api host-agnostically, and a mux the edge reaches would
// put the console's RPCs on every tenant site.
func (a *API) Register(mux *http.ServeMux) {
	registerAdminRoutes(mux, a.server)
}

func newAPI(db *sql.DB, queries Querier, storageProvider storage.Provider, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, reval *revalidate.Client, recorder auditlog.Recorder, mail *mailguard.Guard) (*API, error) {
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
	revalidator := revalidate.NewRequester(revalidate.RequesterConfig{
		Client:  reval,
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

		policy:           policy,
		mail:             mail,
		login:            loginguard.NewDefault(),
		paymentProviders: providers.Registry(),
		inboundProviders: inboundproviders.Registry(),
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

const (
	// maxUploadedImageBytes is the largest image a procedure that carries one
	// takes: a cover, a label's or genre's eye-catch, an author's icon, the
	// tenant's icon or logo.
	maxUploadedImageBytes = max(imageproc.EyeCatchMaxBytes, imageproc.IconMaxBytes, imageproc.LogoMaxBytes, creatorIconMaxUploadBytes)
	// imageUploadReadMaxBytes is what a procedure that carries one image reads
	// of a request: that image as the JSON encoding carries it, in base64 and
	// a third larger than the binary one, and the fields sent beside it, which
	// are bounded by rpcmiddleware.DefaultReadMaxBytes everywhere else.
	imageUploadReadMaxBytes = (maxUploadedImageBytes+2)/3*4 + rpcmiddleware.DefaultReadMaxBytes
	// episodeUploadReadMaxBytes is what UploadEpisodeImages reads of a
	// request: the largest upload episodeimages takes, in the base64 of the
	// JSON encoding as well, and the fields sent beside it.
	episodeUploadReadMaxBytes = (episodeimages.MaxUploadBytes+2)/3*4 + rpcmiddleware.DefaultReadMaxBytes
)

// readLimits are the procedures of this namespace that read more of one
// request than rpcmiddleware.DefaultReadMaxBytes: the ones whose request
// carries an upload.
var readLimits = map[string]int{
	publiraadminv1connect.AdminSeriesServiceUploadEpisodeImagesProcedure:             episodeUploadReadMaxBytes,
	publiraadminv1connect.AdminSeriesServiceCreateSeriesProcedure:                    imageUploadReadMaxBytes,
	publiraadminv1connect.AdminSeriesServiceUpdateSeriesProcedure:                    imageUploadReadMaxBytes,
	publiraadminv1connect.AdminSeriesServiceUploadSeriesEyeCatchAspectImageProcedure: imageUploadReadMaxBytes,
	publiraadminv1connect.AdminLabelServiceCreateLabelProcedure:                      imageUploadReadMaxBytes,
	publiraadminv1connect.AdminLabelServiceUpdateLabelProcedure:                      imageUploadReadMaxBytes,
	publiraadminv1connect.AdminLabelServiceUploadLabelEyeCatchAspectImageProcedure:   imageUploadReadMaxBytes,
	publiraadminv1connect.AdminGenreServiceCreateGenreProcedure:                      imageUploadReadMaxBytes,
	publiraadminv1connect.AdminGenreServiceUpdateGenreProcedure:                      imageUploadReadMaxBytes,
	publiraadminv1connect.AdminGenreServiceUploadGenreEyeCatchAspectImageProcedure:   imageUploadReadMaxBytes,
	publiraadminv1connect.AdminCreatorServiceCreateCreatorProcedure:                  imageUploadReadMaxBytes,
	publiraadminv1connect.AdminCreatorServiceUpdateCreatorProcedure:                  imageUploadReadMaxBytes,
	publiraadminv1connect.TenantThemeServiceUploadTenantIconProcedure:                imageUploadReadMaxBytes,
	publiraadminv1connect.TenantThemeServiceUploadTenantLogoProcedure:                imageUploadReadMaxBytes,
}

func registerAdminRoutes(mux *http.ServeMux, server *adminServer) {
	traced := tracing.ConnectServerInterceptors(ServiceName)
	limits := rpcmiddleware.ReadLimits(readLimits)

	services := connect.NewServer(slices.Concat(traced, []connect.ServerInterceptor{
		server.tenantScopedQuerierInterceptor(),
		rpcmiddleware.NewUnaryContextBuilderInterceptor(server.sessionContextBuilder()),
	})...)
	publiraadminv1connect.RegisterAdminSeriesServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminCreatorServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminLabelServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminGenreServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminCreatorRoleServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminAuditLogServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminUserServiceHandler(services, server)
	publiraadminv1connect.RegisterTenantThemeServiceHandler(services, server)
	publiraadminv1connect.RegisterTenantSettingsServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminEmailSettingsServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminPaymentSettingsServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminInboundEmailSettingsServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminFcmSettingsServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminDashboardServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminEngagementServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminPagesServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminAnnouncementServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminNotificationServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminAccessTicketServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminCommentServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminContactServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminRoyaltyServiceHandler(services, server)
	publiraadminv1connect.RegisterAdminTenantMemberServiceHandler(services, server)
	connecthttp.Mount(mux, services, limits...)

	// AdminAuthService signs a session in, so it runs before there is one to
	// build a context from.
	auth := connect.NewServer(slices.Concat(traced, []connect.ServerInterceptor{
		server.tenantScopedQuerierInterceptor(),
	})...)
	publiraadminv1connect.RegisterAdminAuthServiceHandler(auth, server)
	connecthttp.Mount(mux, auth, limits...)
}

func (s *adminServer) tenantScopedQuerierInterceptor() connect.ServerInterceptor {
	return rpcmiddleware.NewUnaryRequestInterceptor(func(ctx context.Context, _ connect.Spec, req proto.Message, next func(context.Context) error) error {
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

		tenant, err := s.queriesFor(ctx).GetTenantByID(ctx, tenantID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return connect.NewError(connect.CodeNotFound, "tenant not found")
			}
			return s.internalDBError(ctx, "failed to get tenant for request scope", err, "tenant_id", tenantID.String())
		}
		if tenantstatus.IsSuspended(tenant) {
			return tenantstatus.Refusal()
		}

		conn, release, err := tenantconn.Acquire(ctx, s.db, tenant.ID, s.logger)
		if err != nil {
			return s.internalDBError(ctx, "failed to acquire tenant-scoped connection", err, "tenant_id", tenant.ID.String())
		}
		defer release()

		tracing.SetTenant(ctx, tenant.PublicID)
		ctx = rpcmiddleware.WithTenantContext(ctx, rpcmiddleware.TenantContext{TenantID: tenant.ID, TenantPublicID: tenant.PublicID})
		ctx = rpcmiddleware.WithTenantConn(ctx, conn)
		ctx = rpcmiddleware.WithTenantQueries(ctx, dbmodels.New(conn))
		return next(ctx)
	})
}

type tenantScopedRequest interface {
	GetTenant() *publirattypesv1.TenantContext
}
