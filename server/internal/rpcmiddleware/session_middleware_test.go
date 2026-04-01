package rpcmiddleware_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/emptypb"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
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
		Tenant:  dbmodels.Tenant{ID: uuid.Must(uuid.NewV7()), PublicID: "tenant-1"},
		Session: dbmodels.Session{ID: uuid.Must(uuid.NewV7())},
	}
	authenticate := func(_ context.Context, _ *publirattypesv1.TenantContext, _ string, _ http.Header) (rpcmiddleware.SessionContext, error) {
		return want, nil
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: &publirattypesv1.TenantContext{TenantPublicId: "tenant-1"}})
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
	if got.Session.ID != want.Session.ID {
		t.Errorf("Session.ID = %v, want %v", got.Session.ID, want.Session.ID)
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
	authenticate := func(_ context.Context, _ *publirattypesv1.TenantContext, _ string, _ http.Header) (rpcmiddleware.SessionContext, error) {
		return rpcmiddleware.SessionContext{}, authErr
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: &publirattypesv1.TenantContext{TenantPublicId: "tenant-1"}})
	_, err := builder(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("error code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}

func TestBuildAdminSessionContext_NonTenantRequestReturnsInternal(t *testing.T) {
	authenticate := func(_ context.Context, _ *publirattypesv1.TenantContext, _ string, _ http.Header) (rpcmiddleware.SessionContext, error) {
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
	authenticate := func(_ context.Context, _ *publirattypesv1.TenantContext, _ string, _ http.Header) (rpcmiddleware.SessionContext, error) {
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
	authenticate := func(_ context.Context, _ *publirattypesv1.TenantContext, _ string, _ http.Header) (rpcmiddleware.SessionContext, error) {
		authenticateCalled = true
		return rpcmiddleware.SessionContext{}, nil
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: &publirattypesv1.TenantContext{TenantPublicId: "  "}})
	_, err := builder(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("error code = %v, want InvalidArgument", connect.CodeOf(err))
	}
	if authenticateCalled {
		t.Error("authenticate should not be called when tenant_public_id is empty")
	}
}

func TestBuildAdminSessionContext_TenantPublicIDFromHeader(t *testing.T) {
	want := rpcmiddleware.SessionContext{
		Tenant:  dbmodels.Tenant{ID: uuid.Must(uuid.NewV7()), PublicID: "tenant-1"},
		Session: dbmodels.Session{ID: uuid.Must(uuid.NewV7())},
	}
	authenticate := func(_ context.Context, tenantCtx *publirattypesv1.TenantContext, _ string, headers http.Header) (rpcmiddleware.SessionContext, error) {
		if tenantCtx == nil || tenantCtx.TenantPublicId != "tenant-1" {
			t.Fatalf("tenant context = %+v, want tenant-1", tenantCtx)
		}
		if headers.Get(rpcmiddleware.TenantPublicIDHeaderName) != "tenant-1" {
			t.Fatalf("missing tenant header")
		}
		return want, nil
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: nil})
	req.Header().Set(rpcmiddleware.TenantPublicIDHeaderName, "tenant-1")

	ctx, err := builder(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	gotTenantCtx, ok := rpcmiddleware.TenantContextFromContext(ctx)
	if !ok {
		t.Fatal("TenantContext not found in context")
	}
	if gotTenantCtx.TenantPublicID != "tenant-1" {
		t.Fatalf("TenantContext.TenantPublicID = %q, want tenant-1", gotTenantCtx.TenantPublicID)
	}
}
