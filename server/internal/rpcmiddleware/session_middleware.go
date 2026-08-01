package rpcmiddleware

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

type sessionContextKey struct{}
type tenantContextKey struct{}

// TenantContext holds resolved tenant identifiers for the current request.
type TenantContext struct {
	TenantID       uuid.UUID
	TenantPublicID string
}

// SessionContext holds the authenticated tenant and user for a request.
// Name kept for call-site stability; authentication is JWT-based (not DB sessions).
type SessionContext struct {
	Tenant dbmodels.Tenant
	User   dbmodels.User
	Role   string
}

// SessionAuthenticator resolves an authenticated user from request metadata (Bearer JWT).
type SessionAuthenticator func(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	headers http.Header,
) (SessionContext, error)

type tenantScopedRequest interface {
	GetTenant() *publirattypesv1.TenantContext
}

func withSessionContext(ctx context.Context, sessionCtx SessionContext) context.Context {
	return context.WithValue(ctx, sessionContextKey{}, sessionCtx)
}

func withTenantContext(ctx context.Context, tenantCtx TenantContext) context.Context {
	return context.WithValue(ctx, tenantContextKey{}, tenantCtx)
}

// WithTenantContext stores resolved tenant identifiers in context.
func WithTenantContext(ctx context.Context, tenantCtx TenantContext) context.Context {
	return withTenantContext(ctx, tenantCtx)
}

// SessionContextFromContext retrieves the SessionContext injected by the auth middleware.
func SessionContextFromContext(ctx context.Context) (SessionContext, bool) {
	sessionCtx, ok := ctx.Value(sessionContextKey{}).(SessionContext)
	return sessionCtx, ok
}

// TenantContextFromContext retrieves the TenantContext injected by the session middleware.
func TenantContextFromContext(ctx context.Context) (TenantContext, bool) {
	tenantCtx, ok := ctx.Value(tenantContextKey{}).(TenantContext)
	return tenantCtx, ok
}

// BuildAdminSessionContext returns a UnaryContextBuilder that extracts the tenant,
// authenticates the access token, and injects the resulting SessionContext into ctx.
func BuildAdminSessionContext(authenticate SessionAuthenticator) UnaryContextBuilder {
	return func(ctx context.Context, req connect.AnyRequest) (context.Context, error) {
		tenantReq, ok := req.Any().(tenantScopedRequest)
		if !ok {
			return nil, connect.NewError(connect.CodeInternal, errors.New("tenant context accessor is not implemented"))
		}
		tenantID, err := ResolveTenantID(tenantReq.GetTenant(), req.Header())
		if err != nil {
			return nil, err
		}

		resolvedTenantRequest := tenantReq.GetTenant()
		if resolvedTenantRequest == nil {
			resolvedTenantRequest = &publirattypesv1.TenantContext{TenantId: tenantID.String()}
		} else if strings.TrimSpace(resolvedTenantRequest.TenantId) == "" {
			resolvedTenantRequest.TenantId = tenantID.String()
		}

		sessionCtx, err := authenticate(ctx, resolvedTenantRequest, req.Header())
		if err != nil {
			return nil, err
		}

		resolvedTenant := TenantContext{
			TenantID:       sessionCtx.Tenant.ID,
			TenantPublicID: sessionCtx.Tenant.PublicID,
		}
		return withSessionContext(withTenantContext(ctx, resolvedTenant), sessionCtx), nil
	}
}
