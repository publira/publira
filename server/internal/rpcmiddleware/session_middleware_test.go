package rpcmiddleware_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/emptypb"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

func TestSessionContextFromContext_NotPresent(t *testing.T) {
	_, ok := rpcmiddleware.SessionContextFromContext(context.Background())
	if ok {
		t.Error("expected ok=false for empty context")
	}
}

// tenantRequest is a minimal Connect request message that satisfies tenantScopedRequest.
type tenantRequest struct {
	*emptypb.Empty
	tenant *publirav1.TenantContext
}

func (r *tenantRequest) GetTenant() *publirav1.TenantContext { return r.tenant }

func TestBuildAdminSessionContext_InjectsSessionContext(t *testing.T) {
	want := rpcmiddleware.SessionContext{
		Tenant:  dbmodels.Tenant{PublicID: "tenant-1"},
		Session: dbmodels.Session{ID: uuid.New()},
	}
	authenticate := func(_ context.Context, _ *publirav1.TenantContext, _ string, _ http.Header) (rpcmiddleware.SessionContext, error) {
		return want, nil
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: &publirav1.TenantContext{TenantPublicId: "tenant-1"}})
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
}

func TestBuildAdminSessionContext_AuthErrorPropagated(t *testing.T) {
	authErr := connect.NewError(connect.CodeUnauthenticated, errors.New("invalid session"))
	authenticate := func(_ context.Context, _ *publirav1.TenantContext, _ string, _ http.Header) (rpcmiddleware.SessionContext, error) {
		return rpcmiddleware.SessionContext{}, authErr
	}

	builder := rpcmiddleware.BuildAdminSessionContext(authenticate)
	req := connect.NewRequest(&tenantRequest{Empty: &emptypb.Empty{}, tenant: &publirav1.TenantContext{TenantPublicId: "tenant-1"}})
	_, err := builder(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("error code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}

func TestBuildAdminSessionContext_NonTenantRequestReturnsInternal(t *testing.T) {
	authenticate := func(_ context.Context, _ *publirav1.TenantContext, _ string, _ http.Header) (rpcmiddleware.SessionContext, error) {
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
