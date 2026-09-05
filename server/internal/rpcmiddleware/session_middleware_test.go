package rpcmiddleware_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/emptypb"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

func TestSessionContextFromContext_NotPresent(t *testing.T) {
	_, ok := rpcmiddleware.SessionContextFromContext(context.Background())
	if ok {
		t.Error("expected ok=false for empty context")
	}
}

func TestTenantContextFromContext_NotPresent(t *testing.T) {
	_, ok := rpcmiddleware.TenantContextFromContext(context.Background())
	if ok {
		t.Error("expected ok=false for empty context")
	}
}

// tenantRequest is a minimal Connect request message that satisfies tenantScopedRequest.
type tenantRequest struct {
	*emptypb.Empty
	tenant *publirattypesv1.TenantContext
}

func (r *tenantRequest) GetTenant() *publirattypesv1.TenantContext { return r.tenant }

func TestBuildAdminSessionContext_InjectsSessionContext(t *testing.T) {
	want := rpcmiddleware.SessionContext{
		Tenant: dbmodels.Tenant{ID: uuid.Must(uuid.NewV7()), PublicID: "tenant-1"},
	}
	authenticate := func(_ context.Context, _ *publirattypesv1.TenantContext, _ http.Header) (rpcmiddleware.SessionContext, error) {
		return want, nil
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: &publirattypesv1.TenantContext{TenantId: "00000000-0000-7000-8000-000000000011"}})
	ctx, err := builder(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got, ok := rpcmiddleware.SessionContextFromContext(ctx)
	if !ok {
		t.Fatal("SessionContext not found in context")
	}
	if got.Tenant.PublicID != want.Tenant.PublicID {
		t.Errorf("Tenant.PublicID = %q, want %q", got.Tenant.PublicID, want.Tenant.PublicID)
	}
	if got.User.ID != want.User.ID {
		t.Errorf("User.ID = %v, want %v", got.User.ID, want.User.ID)
	}

	gotTenantCtx, ok := rpcmiddleware.TenantContextFromContext(ctx)
	if !ok {
		t.Fatal("TenantContext not found in context")
	}
	if gotTenantCtx.TenantID != want.Tenant.ID {
		t.Errorf("TenantContext.TenantID = %v, want %v", gotTenantCtx.TenantID, want.Tenant.ID)
	}
	if gotTenantCtx.TenantPublicID != want.Tenant.PublicID {
		t.Errorf("TenantContext.TenantPublicID = %q, want %q", gotTenantCtx.TenantPublicID, want.Tenant.PublicID)
	}
}

func TestBuildAdminSessionContext_AuthErrorPropagated(t *testing.T) {
	authErr := connect.NewError(connect.CodeUnauthenticated, errors.New("invalid session"))
	authenticate := func(_ context.Context, _ *publirattypesv1.TenantContext, _ http.Header) (rpcmiddleware.SessionContext, error) {
		return rpcmiddleware.SessionContext{}, authErr
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: &publirattypesv1.TenantContext{TenantId: "00000000-0000-7000-8000-000000000011"}})
	_, err := builder(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("error code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}

func TestBuildAdminSessionContext_NonTenantRequestReturnsInternal(t *testing.T) {
	authenticate := func(_ context.Context, _ *publirattypesv1.TenantContext, _ http.Header) (rpcmiddleware.SessionContext, error) {
		return rpcmiddleware.SessionContext{}, nil
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	// &emptypb.Empty{} does not implement tenantScopedRequest.
	req := connect.NewRequest(&emptypb.Empty{})
	_, err := builder(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Errorf("error code = %v, want Internal", connect.CodeOf(err))
	}
}

func TestBuildAdminSessionContext_MissingTenantContextReturnsInvalidArgument(t *testing.T) {
	authenticateCalled := false
	authenticate := func(_ context.Context, _ *publirattypesv1.TenantContext, _ http.Header) (rpcmiddleware.SessionContext, error) {
		authenticateCalled = true
		return rpcmiddleware.SessionContext{}, nil
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: nil})
	_, err := builder(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("error code = %v, want InvalidArgument", connect.CodeOf(err))
	}
	if authenticateCalled {
		t.Error("authenticate should not be called when tenant context is missing")
	}
}

func TestBuildAdminSessionContext_EmptyTenantPublicIDReturnsInvalidArgument(t *testing.T) {
	authenticateCalled := false
	authenticate := func(_ context.Context, _ *publirattypesv1.TenantContext, _ http.Header) (rpcmiddleware.SessionContext, error) {
		authenticateCalled = true
		return rpcmiddleware.SessionContext{}, nil
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: &publirattypesv1.TenantContext{TenantId: "  "}})
	_, err := builder(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("error code = %v, want InvalidArgument", connect.CodeOf(err))
	}
	if authenticateCalled {
		t.Error("authenticate should not be called when tenant_public_id is empty")
	}
}

func TestBuildAdminSessionContext_TenantIDFromHeader(t *testing.T) {
	const tenantID = "00000000-0000-7000-8000-000000000011"
	want := rpcmiddleware.SessionContext{
		Tenant: dbmodels.Tenant{ID: uuid.MustParse(tenantID), PublicID: "tenant-1"},
	}
	authenticate := func(_ context.Context, tenantCtx *publirattypesv1.TenantContext, headers http.Header) (rpcmiddleware.SessionContext, error) {
		if tenantCtx == nil || tenantCtx.TenantId != tenantID {
			t.Fatalf("tenant context = %+v, want tenant_id=%s", tenantCtx, tenantID)
		}
		if headers.Get(rpcmiddleware.TenantIDHeaderName) != tenantID {
			t.Fatalf("missing tenant header")
		}
		return want, nil
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: nil})
	req.Header().Set(rpcmiddleware.TenantIDHeaderName, tenantID)

	ctx, err := builder(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	gotTenantCtx, ok := rpcmiddleware.TenantContextFromContext(ctx)
	if !ok {
		t.Fatal("TenantContext not found in context")
	}
	if gotTenantCtx.TenantID != uuid.MustParse(tenantID) {
		t.Fatalf("TenantContext.TenantID = %q, want %s", gotTenantCtx.TenantID, tenantID)
	}
	if gotTenantCtx.TenantPublicID != "tenant-1" {
		t.Fatalf("TenantContext.TenantPublicID = %q, want tenant-1", gotTenantCtx.TenantPublicID)
	}
}
