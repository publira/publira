package platformapi

import (
	"net/http"

	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
	dbmodels "github.com/publira/publira/server/internal/db"
)

// Querier は platformapi が必要とする DB 操作インターフェースです。
type Querier interface {
	dbmodels.Querier
}

type platformServer struct {
	queries Querier
}

// NewHandler はプラットフォーム API 専用の HTTP ハンドラを返します。
// PlatformTenantService のみ公開します。
func NewHandler(queries Querier) http.Handler {
	server := &platformServer{queries: queries}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	tenantPath, tenantHandler := publirasplatformv1connect.NewPlatformTenantServiceHandler(server)
	mux.Handle(tenantPath, tenantHandler)
	return mux
}
