package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/mailguard"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/tracing"
)

// Querier is the set of database operations platformapi needs.
type Querier interface {
	dbmodels.Querier
}

type platformServer struct {
	queries   Querier
	db        *sql.DB
	recorder  auditlog.Recorder
	encryptor emailsettings.SecretManager
	tester    internalsmtp.Tester
	tokens    *auth.TokenManager
	logger    *slog.Logger
	// mail bounds how much mail the console's own forms may cause.
	mail *mailguard.Guard
}

// internalDBError keeps context cancellation and deadline errors as-is so
// Connect can map them to CodeCanceled / CodeDeadlineExceeded. Other DB
// failures are logged and replaced with a generic client-facing message so
// driver details never leave the server.
func (s *platformServer) internalDBError(ctx context.Context, msg string, err error, keyvals ...any) error {
	return s.internalError(ctx, msg, err, keyvals...)
}

// internalError is internalDBError for a failure the database reported no
// problem with — a stored value the server cannot make sense of, say. The
// caller sees the same generic message either way.
func (s *platformServer) internalError(ctx context.Context, msg string, err error, keyvals ...any) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	args := make([]any, 0, len(keyvals)+2)
	args = append(args, keyvals...)
	args = append(args, "error", err)
	s.logger.ErrorContext(ctx, msg, args...)
	return connect.NewError(connect.CodeInternal, errors.New("internal server error"))
}

type platformActor struct {
	UserID uuid.UUID
	Role   string
	Email  string
}

type platformActorContextKey struct{}

func platformActorFromContext(ctx context.Context) (platformActor, bool) {
	actor, ok := ctx.Value(platformActorContextKey{}).(platformActor)
	return actor, ok
}

func (s *platformServer) queriesFor(_ context.Context) Querier {
	return s.queries
}

// resolveTenantPublicID resolves the tenant public_id from the request body or
// the tenant header. Platform APIs address tenants by their human-facing
// public_id, so this stays a platform-local helper rather than reusing the UUID
// resolvers in rpcmiddleware.
func resolveTenantPublicID(reqTenantPublicID string, headers http.Header) (string, error) {
	body := strings.TrimSpace(reqTenantPublicID)
	header := rpcmiddleware.TenantIDFromHeader(headers)
	if body != "" && header != "" && body != header {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id header and request body must match"))
	}
	if body != "" {
		return body, nil
	}
	if header != "" {
		return header, nil
	}
	return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id is required"))
}

// ServiceName is the service.name this namespace's spans carry. The three
// namespaces share a process and keep their own name, so a trace UI can still
// tell the platform console's work from the public API's.
const ServiceName = "publira-platform-api-server"

// API is the platform console's namespace — PlatformTenantService,
// PlatformSetupService and the rest of publira.platform.v1 — ready to be
// mounted by [API.Register].
type API struct {
	server *platformServer
}

// New builds the platform console API over db, which must be the pool
// connected as publira_platform, whose BYPASSRLS attribute lets it read past
// row-level security.
//
// It fails rather than serves when the limit on the mail the console's forms
// may cause is misconfigured, so a limit nobody can meet is caught at startup
// instead of by the first operator who cannot get their password reset.
func New(db *sql.DB, queries Querier, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager) (*API, error) {
	mail, err := mailguard.NewFromEnv(logger)
	if err != nil {
		return nil, err
	}
	return newAPI(db, queries, logger, encryptor, tester, tokens, nil, mail), nil
}

// NewWithAsyncRecorder is New with an AsyncRecorder.
func NewWithAsyncRecorder(db *sql.DB, queries Querier, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, recorder *auditlog.AsyncRecorder) (*API, error) {
	mail, err := mailguard.NewFromEnv(logger)
	if err != nil {
		return nil, err
	}
	return newAPI(db, queries, logger, encryptor, tester, tokens, recorder, mail), nil
}

// Register mounts the publira.platform.v1 services on mux. What a mux carries
// is what its listener serves, so this belongs on the internal listener alone:
// the edge forwards /api host-agnostically, and a mux the edge reaches would
// put the platform console's RPCs — PlatformSetupService among them, which is
// served without authentication — on every tenant site.
func (a *API) Register(mux *http.ServeMux) {
	registerPlatformRoutes(mux, a.server)
}

func newAPI(db *sql.DB, queries Querier, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, recorder auditlog.Recorder, mail *mailguard.Guard) *API {
	if logger == nil {
		logger = slog.Default()
	}
	if recorder == nil {
		recorder = auditlog.New(queries, logger)
	}
	if mail == nil {
		mail = mailguard.NewDefault()
	}
	server := &platformServer{
		queries:   queries,
		db:        db,
		recorder:  recorder,
		encryptor: encryptor,
		tester:    tester,
		tokens:    tokens,
		logger:    logger,
		mail:      mail,
	}
	return &API{server: server}
}

// handlerFromServer is the namespace on a mux of its own, health probes
// included, as a process serving nothing else would mount it.
func handlerFromServer(server *platformServer) http.Handler {
	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(server.db))
	registerPlatformRoutes(mux, server)
	return mux
}

func registerPlatformRoutes(mux *http.ServeMux, server *platformServer) {
	authInterceptor := connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			_, user, role, err := server.authenticatePlatformSession(ctx, "", req.Header())
			if err != nil {
				return nil, err
			}
			ctx = context.WithValue(ctx, platformActorContextKey{}, platformActor{UserID: user.ID, Role: role, Email: user.Email})
			if isPlatformWriteProcedure(req.Spec().Procedure) {
				if err := ensurePlatformWriteRole(role); err != nil {
					return nil, err
				}
			}
			return next(ctx, req)
		}
	})

	traced := tracing.ConnectHandlerOption(ServiceName)

	tenantPath, tenantHandler := publirasplatformv1connect.NewPlatformTenantServiceHandler(
		server,
		traced,
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(tenantPath, tenantHandler)
	emailPath, emailHandler := publirasplatformv1connect.NewPlatformEmailSettingsServiceHandler(
		server,
		traced,
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(emailPath, emailHandler)
	settingsPath, settingsHandler := publirasplatformv1connect.NewPlatformSettingsServiceHandler(
		server,
		traced,
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(settingsPath, settingsHandler)
	operatorPath, operatorHandler := publirasplatformv1connect.NewPlatformOperatorServiceHandler(
		server,
		traced,
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(operatorPath, operatorHandler)
	notificationPath, notificationHandler := publirasplatformv1connect.NewPlatformNotificationServiceHandler(
		server,
		traced,
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(notificationPath, notificationHandler)
	authPath, authHandler := publirasplatformv1connect.NewPlatformAuthServiceHandler(server, traced)
	mux.Handle(authPath, authHandler)
	// The setup service is served without authentication.
	setupPath, setupHandler := publirasplatformv1connect.NewPlatformSetupServiceHandler(server, traced)
	mux.Handle(setupPath, setupHandler)
	// End user administration.
	userPath, userHandler := publirasplatformv1connect.NewPlatformUserServiceHandler(
		server,
		traced,
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(userPath, userHandler)
	dashboardPath, dashboardHandler := publirasplatformv1connect.NewPlatformDashboardServiceHandler(server, traced)
	mux.Handle(dashboardPath, dashboardHandler)
	auditPath, auditHandler := publirasplatformv1connect.NewPlatformAuditLogServiceHandler(server, traced)
	mux.Handle(auditPath, auditHandler)
}
