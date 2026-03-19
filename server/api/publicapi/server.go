package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"connectrpc.com/connect"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/storage"
)

type Querier interface {
	dbmodels.Querier
}

type apiServer struct {
	queries Querier
	storage storage.Provider
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

func (s *apiServer) tenantByContext(ctx context.Context, tenantCtx *publirattypesv1.TenantContext) (dbmodels.Tenant, error) {
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

// NewHandler は公開 API 専用の HTTP ハンドラを返します。
// CatalogService と AuthService のみ公開し、管理 API (AdminSeriesService) は含みません。
func NewHandler(queries Querier, storageProvider storage.Provider) http.Handler {
	server := &apiServer{queries: queries, storage: storageProvider}
	mux := http.NewServeMux()
	registerHealthz(mux)
	registerPublicRoutes(mux, server)
	return mux
}

func registerHealthz(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}

func registerPublicRoutes(mux *http.ServeMux, server *apiServer) {
	path, handler := publirav1connect.NewCatalogServiceHandler(server)
	mux.Handle(path, handler)
	authPath, authHandler := publirav1connect.NewAuthServiceHandler(server)
	mux.Handle(authPath, authHandler)
}
