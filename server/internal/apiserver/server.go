package apiserver

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/rpcmiddleware"
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

func tenantPublicIDFromContext(ctx *publirav1.TenantContext) (string, error) {
	if ctx == nil || strings.TrimSpace(ctx.TenantPublicId) == "" {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant context is required"))
	}
	return ctx.TenantPublicId, nil
}

func (s *apiServer) tenantByContext(ctx context.Context, tenantCtx *publirav1.TenantContext) (dbmodels.Tenant, error) {
	if sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx); ok {
		return sessionCtx.Tenant, nil
	}
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

func NewHandler(queries Querier, storageProvider storage.Provider) http.Handler {
	server := &apiServer{queries: queries, storage: storageProvider}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	path, handler := publirav1connect.NewCatalogServiceHandler(server)
	mux.Handle(path, handler)
	adminPath, adminHandler := publirav1connect.NewAdminSeriesServiceHandler(server, connect.WithInterceptors(rpcmiddleware.NewUnaryContextBuilderInterceptor(rpcmiddleware.BuildAdminSessionContext(server.authenticateSession))))
	mux.Handle(adminPath, adminHandler)
	authPath, authHandler := publirav1connect.NewAuthServiceHandler(server)
	mux.Handle(authPath, authHandler)
	return mux
}
