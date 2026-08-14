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

	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/emailsettings"
	"github.com/publira/publira/server/internal/health"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	internalsmtp "github.com/publira/publira/server/internal/smtp"
)

// Querier は platformapi が必要とする DB 操作インターフェースです。
type Querier interface {
	dbmodels.Querier
}

type platformServer struct {
	queries   Querier
	db        *sql.DB
	recorder  *auditlog.Recorder
	encryptor emailsettings.SecretManager
	tester    internalsmtp.Tester
	mailer    internalsmtp.Sender
	tokens    *auth.TokenManager
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

// NewHandler はプラットフォーム API 用の HTTP ハンドラを返します。
// DB 接続は publira_platform ユーザーで行い、BYPASSRLS 属性により RLS を透過します。
func NewHandler(db *sql.DB, queries Querier, logger *slog.Logger, encryptor emailsettings.SecretManager, tester internalsmtp.Tester) http.Handler {
	var mailer internalsmtp.Sender
	if sender, ok := tester.(internalsmtp.Sender); ok {
		mailer = sender
	}
	server := &platformServer{
		queries:   queries,
		db:        db,
		recorder:  auditlog.New(queries, logger),
		encryptor: encryptor,
		tester:    tester,
		mailer:    mailer,
		tokens:    auth.MustTokenManagerFromEnv(),
	}
	authInterceptor := connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			_, user, role, err := server.authenticatePlatformSession(ctx, "", req.Header())
			if err != nil {
				return nil, err
			}
			ctx = context.WithValue(ctx, platformActorContextKey{}, platformActor{UserID: user.ID, Role: role, Email: user.Email})
			return next(ctx, req)
		}
	})

	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(db))
	tenantPath, tenantHandler := publirasplatformv1connect.NewPlatformTenantServiceHandler(
		server,
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(tenantPath, tenantHandler)
	emailPath, emailHandler := publirasplatformv1connect.NewPlatformEmailSettingsServiceHandler(
		server,
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(emailPath, emailHandler)
	settingsPath, settingsHandler := publirasplatformv1connect.NewPlatformSettingsServiceHandler(
		server,
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(settingsPath, settingsHandler)
	operatorPath, operatorHandler := publirasplatformv1connect.NewPlatformOperatorServiceHandler(server)
	mux.Handle(operatorPath, operatorHandler)
	notificationPath, notificationHandler := publirasplatformv1connect.NewPlatformNotificationServiceHandler(
		server,
		connect.WithInterceptors(authInterceptor),
	)
	mux.Handle(notificationPath, notificationHandler)
	authPath, authHandler := publirasplatformv1connect.NewPlatformAuthServiceHandler(server)
	mux.Handle(authPath, authHandler)
	// セットアップサービスは認証不要で公開する
	setupPath, setupHandler := publirasplatformv1connect.NewPlatformSetupServiceHandler(server)
	mux.Handle(setupPath, setupHandler)
	// エンドユーザー管理サービス
	userPath, userHandler := publirasplatformv1connect.NewPlatformUserServiceHandler(server)
	mux.Handle(userPath, userHandler)
	dashboardPath, dashboardHandler := publirasplatformv1connect.NewPlatformDashboardServiceHandler(server)
	mux.Handle(dashboardPath, dashboardHandler)
	auditPath, auditHandler := publirasplatformv1connect.NewPlatformAuditLogServiceHandler(server)
	mux.Handle(auditPath, auditHandler)
	return mux
}
