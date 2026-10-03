package adminapi

import (
	"context"
	"errors"
	"net/http"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// serviceProcedures are the reads a web app may make with its service token:
// ones whose answer is the same for every operator of the tenant, so it can be
// cached per tenant. Nothing that writes, depends on the caller's role, or
// embeds a per-user credential belongs here; GetCreator answers a creator's
// linked accounts to a tenant admin alone, so it stays off.
var serviceProcedures = map[string]struct{}{
	publiraadminv1connect.AdminGenreServiceListGenresProcedure:              {},
	publiraadminv1connect.AdminCreatorRoleServiceListCreatorRolesProcedure:  {},
	publiraadminv1connect.AdminCreatorServiceListCreatorsProcedure:          {},
	publiraadminv1connect.AdminLabelServiceListLabelsProcedure:              {},
	publiraadminv1connect.AdminLabelServiceGetLabelProcedure:                {},
	publiraadminv1connect.AdminSeriesServiceListSeriesProcedure:             {},
	publiraadminv1connect.AdminSeriesServiceGetSeriesProcedure:              {},
	publiraadminv1connect.AdminSeriesServiceListEpisodesProcedure:           {},
	publiraadminv1connect.AdminSeriesServiceGetEpisodeProcedure:             {},
	publiraadminv1connect.AdminSeriesServiceListEpisodeCreditsProcedure:     {},
	publiraadminv1connect.AdminSeriesServiceListEpisodeFreeWindowsProcedure: {},
	publiraadminv1connect.AdminDashboardServiceGetDashboardProcedure:        {},
}

func serviceProcedureDeniedError() error {
	return connect.NewError(connect.CodePermissionDenied, errors.New("procedure is not available to the service credential"))
}

// sessionContextBuilder authenticates a request carrying the service token as
// the service principal and every other request as an operator's session.
func (s *adminServer) sessionContextBuilder() rpcmiddleware.UnaryContextBuilder {
	operator := rpcmiddleware.BuildAdminSessionContext(s.authenticateSession)
	service := rpcmiddleware.BuildAdminSessionContext(s.authenticateService)
	return func(ctx context.Context, req connect.AnyRequest) (context.Context, error) {
		bearer, ok := auth.BearerTokenFromHeader(req.Header())
		if !ok || !s.serviceToken.Matches(bearer) {
			return operator(ctx, req)
		}
		if _, allowed := serviceProcedures[req.Spec().Procedure]; !allowed {
			return nil, serviceProcedureDeniedError()
		}
		return service(ctx, req)
	}
}

func (s *adminServer) authenticateService(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	_ http.Header,
) (rpcmiddleware.SessionContext, error) {
	tenant, err := s.tenantByContext(ctx, tenantCtx)
	if err != nil {
		return rpcmiddleware.SessionContext{}, err
	}
	return rpcmiddleware.SessionContext{Tenant: tenant, Service: true}, nil
}
