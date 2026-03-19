package rpcmiddleware

import (
	"context"
	"errors"
	"log"
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

// SessionContext holds the authenticated tenant and session for a request.
type SessionContext struct {
	Tenant  dbmodels.Tenant
	Session dbmodels.Session
}

// SessionAuthenticator resolves a session from request metadata.
type SessionAuthenticator func(
	ctx context.Context,
	tenantCtx *publirattypesv1.TenantContext,
	explicitToken string,
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

// SessionContextFromContext retrieves the SessionContext injected by the session middleware.
func SessionContextFromContext(ctx context.Context) (SessionContext, bool) {
	sessionCtx, ok := ctx.Value(sessionContextKey{}).(SessionContext)
	return sessionCtx, ok
}

// TenantContextFromContext retrieves the TenantContext injected by the session middleware.
func TenantContextFromContext(ctx context.Context) (TenantContext, bool) {
	tenantCtx, ok := ctx.Value(tenantContextKey{}).(TenantContext)
	return tenantCtx, ok
}

func tenantPublicIDFromRequest(tenantCtx *publirattypesv1.TenantContext) (string, error) {
	if tenantCtx == nil {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant context is required"))
	}
	tenantPublicID := strings.TrimSpace(tenantCtx.TenantPublicId)
	if tenantPublicID == "" {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("tenant_public_id is required"))
	}
	return tenantPublicID, nil
}

// BuildAdminSessionContext returns a UnaryContextBuilder that extracts the tenant,
// authenticates the session, and injects the resulting SessionContext into ctx.
func BuildAdminSessionContext(authenticate SessionAuthenticator) UnaryContextBuilder {
	return func(ctx context.Context, req connect.AnyRequest) (context.Context, error) {
		tenantReq, ok := req.Any().(tenantScopedRequest)
		if !ok {
			log.Printf("debug authz tenant resolution failed: tenant context accessor missing")
			return nil, connect.NewError(connect.CodeInternal, errors.New("tenant context accessor is not implemented"))
		}
		tenantPublicID, err := tenantPublicIDFromRequest(tenantReq.GetTenant())
		if err != nil {
			log.Printf("debug authz tenant resolution failed: %v", err)
			return nil, err
		}

		sessionCtx, err := authenticate(ctx, tenantReq.GetTenant(), "", req.Header())
		if err != nil {
			log.Printf("debug authz session authentication failed: tenant_public_id=%s error=%v", tenantPublicID, err)
			return nil, err
		}

		resolvedTenant := TenantContext{
			TenantID:       sessionCtx.Tenant.ID,
			TenantPublicID: sessionCtx.Tenant.PublicID,
		}
		if strings.TrimSpace(resolvedTenant.TenantPublicID) == "" {
			resolvedTenant.TenantPublicID = tenantPublicID
		}
		log.Printf(
			"debug authz tenant resolved: tenant_public_id=%s tenant_id=%s",
			resolvedTenant.TenantPublicID,
			resolvedTenant.TenantID,
		)

		return withSessionContext(withTenantContext(ctx, resolvedTenant), sessionCtx), nil
	}
}
