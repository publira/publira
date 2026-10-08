package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"slices"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/loginguard"
	"github.com/publira/publira/server/internal/mailguard"
	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/platformsearch"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
	"github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/storagesettings"
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
	// serviceToken admits a web app to the reads in [serviceProcedures].
	serviceToken *auth.ServiceToken
	// storageTester exercises an object store configuration against the store
	// it addresses.
	storageTester storagesettings.Tester
	// searchProbe asks a search engine what it is. Nil is the production one,
	// which connects to the engine each test names.
	searchProbe platformsearch.Prober
	// mail bounds how much mail the console's own forms may cause.
	mail *mailguard.Guard
	// login bounds how often a password may be tried at sign-in.
	login *loginguard.Guard
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
	return connect.NewError(connect.CodeInternal, "internal server error")
}

type platformActor struct {
	UserID uuid.UUID
	Role   string
	Email  string
	// Service marks a call a web app made with its own credential rather than
	// on an operator's behalf. UserID, Role, and Email are zero for it.
	Service bool
}

type platformActorContextKey struct{}

func platformActorFromContext(ctx context.Context) (platformActor, bool) {
	actor, ok := ctx.Value(platformActorContextKey{}).(platformActor)
	return actor, ok
}

func (s *platformServer) queriesFor(_ context.Context) Querier {
	return s.queries
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
func New(db *sql.DB, queries Querier, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager) *API {
	api := newAPI(db, queries, logger, encryptor, tester, tokens, nil, nil, nil)
	api.server.shareLoginGuard()
	return api
}

// NewWithAsyncRecorder is New with an AsyncRecorder, and with the service
// token the web apps read platform-level data with; a nil one admits no web
// app.
func NewWithAsyncRecorder(db *sql.DB, queries Querier, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, recorder *auditlog.AsyncRecorder, serviceToken *auth.ServiceToken) *API {
	api := newAPI(db, queries, logger, encryptor, tester, tokens, recorder, nil, nil)
	api.server.serviceToken = serviceToken
	api.server.shareLoginGuard()
	return api
}

// shareLoginGuard puts the sign-in limit on the counters the deployment shares,
// against the platform policy as db reads it. newAPI leaves it on counters of
// its own, so no test that signs in reaches the Redis the environment may name.
func (s *platformServer) shareLoginGuard() {
	s.login = loginguard.NewShared(platformpolicy.NewResolver(dbmodels.New(s.db), platformpolicy.CacheTTL, s.logger), s.logger)
}

// Register mounts the publira.platform.v1 services on mux. What a mux carries
// is what its listener serves, so this belongs on the internal listener alone:
// the edge forwards /api host-agnostically, and a mux the edge reaches would
// put the platform console's RPCs — PlatformSetupService among them, which is
// served without authentication — on every tenant site.
func (a *API) Register(mux *http.ServeMux) {
	registerPlatformRoutes(mux, a.server)
}

func newAPI(db *sql.DB, queries Querier, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester, tokens *auth.TokenManager, recorder auditlog.Recorder, mail *mailguard.Guard, storageTester storagesettings.Tester) *API {
	if logger == nil {
		logger = slog.Default()
	}
	if recorder == nil {
		recorder = auditlog.New(queries, logger)
	}
	// A nil guard is the production one: the platform policy's limits over the
	// counters the deployment shares.
	if mail == nil {
		mail = mailguard.NewShared(platformpolicy.NewResolver(dbmodels.New(db), platformpolicy.CacheTTL, logger), logger)
	}
	// A nil tester is the production one: it builds its client from the
	// settings each test states rather than from anything wired here.
	if storageTester == nil {
		storageTester = s3.NewConnectionTester()
	}
	server := &platformServer{
		queries:       queries,
		db:            db,
		recorder:      recorder,
		encryptor:     encryptor,
		tester:        tester,
		tokens:        tokens,
		logger:        logger,
		mail:          mail,
		login:         loginguard.NewDefault(),
		storageTester: storageTester,
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
	authInterceptor := func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			headers := rpcmiddleware.RequestHeader(ctx)
			if actor, ok, err := server.serviceActor(headers, spec.Procedure); ok {
				if err != nil {
					return err
				}
				return next(context.WithValue(ctx, platformActorContextKey{}, actor), spec, stream)
			}
			_, user, role, err := server.authenticatePlatformSession(ctx, "", headers)
			if err != nil {
				return err
			}
			ctx = context.WithValue(ctx, platformActorContextKey{}, platformActor{UserID: user.ID, Role: role, Email: user.Email})
			if isPlatformWriteProcedure(spec.Procedure) {
				if err := ensurePlatformWriteRole(role); err != nil {
					return err
				}
			}
			return next(ctx, spec, stream)
		}
	}

	traced := tracing.ConnectServerInterceptors(ServiceName)

	services := connect.NewServer(slices.Concat(traced, []connect.ServerInterceptor{authInterceptor})...)
	publirasplatformv1connect.RegisterPlatformTenantServiceHandler(services, server)
	publirasplatformv1connect.RegisterPlatformEmailSettingsServiceHandler(services, server)
	publirasplatformv1connect.RegisterPlatformSettingsServiceHandler(services, server)
	publirasplatformv1connect.RegisterPlatformStorageSettingsServiceHandler(services, server)
	publirasplatformv1connect.RegisterPlatformSearchSettingsServiceHandler(services, server)
	publirasplatformv1connect.RegisterPlatformWebPushSettingsServiceHandler(services, server)
	publirasplatformv1connect.RegisterPlatformPolicyServiceHandler(services, server)
	publirasplatformv1connect.RegisterPlatformOperatorServiceHandler(services, server)
	publirasplatformv1connect.RegisterPlatformNotificationServiceHandler(services, server)
	publirasplatformv1connect.RegisterPlatformUserServiceHandler(services, server)
	publirasplatformv1connect.RegisterPlatformDashboardServiceHandler(services, server)
	connecthttp.Mount(mux, services)

	// Signing in and the first-run setup are served without a session, and
	// the audit log authenticates its caller itself.
	open := connect.NewServer(traced...)
	publirasplatformv1connect.RegisterPlatformAuthServiceHandler(open, server)
	publirasplatformv1connect.RegisterPlatformSetupServiceHandler(open, server)
	publirasplatformv1connect.RegisterPlatformAuditLogServiceHandler(open, server)
	connecthttp.Mount(mux, open)
}
