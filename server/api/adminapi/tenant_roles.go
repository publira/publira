package adminapi

import (
	"context"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/proto"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// Every admin RPC is placed at one of three levels, named after the weakest
// tenant role allowed through, and its handler opens by calling the matching
// helper below — exactly one of them, and from the handler itself rather than
// from a helper it calls, so the level is read where the RPC is implemented.
// The proto comment of each RPC names the same level; the rule for placing a
// new one is in server/AGENTS.md, and TestEveryAdminRPCRequiresItsLevel fails
// on an RPC that calls none, calls more than one, or disagrees with its proto.

// requireTenantAdmin admits a tenant_admin alone: members and invitations, the
// tenant's settings and integrations, reader accounts, access tickets,
// royalties, and the audit log.
func (s *adminServer) requireTenantAdmin(ctx context.Context) (rpcmiddleware.SessionContext, error) {
	return requireTenantLevel(ctx, auth.RoleTenantAdmin, "tenant admin role required")
}

// requireTenantEditor admits a tenant_editor and a tenant_admin: the writes to
// the catalogue, the pages, the announcements, and the moderation of comments.
func (s *adminServer) requireTenantEditor(ctx context.Context) (rpcmiddleware.SessionContext, error) {
	return requireTenantLevel(ctx, auth.RoleTenantEditor, "tenant editor role required")
}

// requireTenantAuditor admits every member of staff: the reads an editor makes,
// which a tenant_auditor makes too.
//
// It is the one level the service principal passes as well. Which procedures a
// web app may call with its service token is decided before the handler runs,
// by serviceProcedures, and every one of them is a read at this level.
func (s *adminServer) requireTenantAuditor(ctx context.Context) (rpcmiddleware.SessionContext, error) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if ok && sessionCtx.Service {
		return sessionCtx, nil
	}
	return requireTenantLevel(ctx, auth.RoleTenantAuditor, "tenant staff role required")
}

func requireTenantLevel(ctx context.Context, level, refusal string) (rpcmiddleware.SessionContext, error) {
	sessionCtx, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodeInternal, "session context is unavailable")
	}
	if !auth.TenantRoleAtLeast(sessionCtx.Role, level) {
		return rpcmiddleware.SessionContext{}, connect.NewError(connect.CodePermissionDenied, refusal)
	}
	return sessionCtx, nil
}

// withOperatorSession authenticates the operator's session on an
// AdminAuthService request and carries it in the returned context, the way the
// interceptor every other service is mounted with does. AdminAuthService has
// no such interceptor because signing in is one of its RPCs, so the ones that
// act on the tenant's data call this before their level's helper.
func (s *adminServer) withOperatorSession(ctx context.Context, req proto.Message) (context.Context, error) {
	return rpcmiddleware.BuildAdminSessionContext(s.authenticateSession)(ctx, connect.Spec{}, req)
}
