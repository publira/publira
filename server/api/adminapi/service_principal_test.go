package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
	"github.com/publira/publira/server/internal/testutil"
)

// serviceContext is the context a handler sees behind the service token.
func serviceContext(t *testing.T) context.Context {
	t.Helper()

	tenant := dbmodels.Tenant{ID: uuid.Must(uuid.NewV7()), PublicID: "TENANTA"}
	build := rpcmiddleware.BuildAdminSessionContext(func(context.Context, *publirattypesv1.TenantContext, *connect.Header) (rpcmiddleware.SessionContext, error) {
		return rpcmiddleware.SessionContext{Tenant: tenant, Service: true}, nil
	})
	ctx, err := build(t.Context(), connect.Spec{}, &publiraadminv1.ListGenresRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenant.ID.String()},
	})
	if err != nil {
		t.Fatalf("build service context: %v", err)
	}
	return ctx
}

// An RPC put on the allowlist by mistake still fails closed at the checks that
// would otherwise have needed a person.
func TestServicePrincipalFailsClosedWhereAPersonIsNeeded(t *testing.T) {
	s := &adminServer{tokens: testutil.TokenManager()}

	t.Run("the tenant admin role", func(t *testing.T) {
		if _, err := s.requireTenantAdmin(serviceContext(t)); connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("requireTenantAdmin code = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
		}
	})
	t.Run("an admin media token", func(t *testing.T) {
		images := []*publirattypesv1.EpisodeImage{{ImageUrl: "/images/episode.webp"}}
		err := s.attachAdminMediaToken(serviceContext(t), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), images)
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("attachAdminMediaToken code = %v, want %v", connect.CodeOf(err), connect.CodePermissionDenied)
		}
		if images[0].ImageUrl != "/images/episode.webp" {
			t.Fatalf("image URL = %q, want it left unsigned", images[0].ImageUrl)
		}
	})
}
