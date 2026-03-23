package platformapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"

	"connectrpc.com/connect"

	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db"
)

// Querier は platformapi が必要とする DB 操作インターフェースです。
type Querier interface {
	dbmodels.Querier
}

type platformServer struct {
	queries  Querier
	db       *sql.DB
	recorder *auditlog.Recorder
}

type platformActor struct {
	UserPublicID string
	Role         string
}

type platformActorContextKey struct{}

func platformActorFromContext(ctx context.Context) (platformActor, bool) {
	actor, ok := ctx.Value(platformActorContextKey{}).(platformActor)
	return actor, ok
}

// NewHandler はプラットフォーム API 用の HTTP ハンドラを返します。
func NewHandler(db *sql.DB, queries Querier, logger *slog.Logger) http.Handler {
	server := &platformServer{queries: queries, db: db, recorder: auditlog.New(queries, logger)}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	tenantPath, tenantHandler := publirasplatformv1connect.NewPlatformTenantServiceHandler(
		server,
		connect.WithInterceptors(connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
			return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
				_, user, role, err := server.authenticatePlatformSession(ctx, "", req.Header())
				if err != nil {
					return nil, err
				}
				ctx = context.WithValue(ctx, platformActorContextKey{}, platformActor{UserPublicID: user.PublicID, Role: role})
				return next(ctx, req)
			}
		})),
	)
	mux.Handle(tenantPath, tenantHandler)
	operatorPath, operatorHandler := publirasplatformv1connect.NewPlatformOperatorServiceHandler(server)
	mux.Handle(operatorPath, operatorHandler)
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
