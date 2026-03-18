package rpcmiddleware

import (
	"context"
	"errors"
	"net/http"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

type sessionContextKey struct{}

// SessionContext holds the authenticated tenant and session for a request.
type SessionContext struct {
	Tenant  dbmodels.Tenant
	Session dbmodels.Session
}

// SessionAuthenticator resolves a session from request metadata.
type SessionAuthenticator func(
	ctx context.Context,
	tenantCtx *publirav1.TenantContext,
	explicitToken string,
	headers http.Header,
) (SessionContext, error)

type tenantScopedRequest interface {
	GetTenant() *publirav1.TenantContext
}

func withSessionContext(ctx context.Context, sessionCtx SessionContext) context.Context {
	return context.WithValue(ctx, sessionContextKey{}, sessionCtx)
}

// SessionContextFromContext retrieves the SessionContext injected by the session middleware.
func SessionContextFromContext(ctx context.Context) (SessionContext, bool) {
	sessionCtx, ok := ctx.Value(sessionContextKey{}).(SessionContext)
	return sessionCtx, ok
}

// BuildAdminSessionContext returns a UnaryContextBuilder that extracts the tenant,
// authenticates the session, and injects the resulting SessionContext into ctx.
func BuildAdminSessionContext(authenticate SessionAuthenticator) UnaryContextBuilder {
	return func(ctx context.Context, req connect.AnyRequest) (context.Context, error) {
		tenantReq, ok := req.Any().(tenantScopedRequest)
		if !ok {
			return nil, connect.NewError(connect.CodeInternal, errors.New("tenant context accessor is not implemented"))
		}
		sessionCtx, err := authenticate(ctx, tenantReq.GetTenant(), "", req.Header())
		if err != nil {
			return nil, err
		}
		return withSessionContext(ctx, sessionCtx), nil
	}
}
