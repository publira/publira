package rpcmiddleware_test

import (
	"net/http"
	"testing"

	"connectrpc.com/connect"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

func TestResolveTenantPublicID_FromBody(t *testing.T) {
	got, err := rpcmiddleware.ResolveTenantPublicID(&publirattypesv1.TenantContext{TenantPublicId: "TENANT001"}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "TENANT001" {
		t.Fatalf("tenant_public_id = %q, want TENANT001", got)
	}
}

func TestResolveTenantPublicID_FromHeader(t *testing.T) {
	headers := http.Header{}
	headers.Set(rpcmiddleware.TenantPublicIDHeaderName, "TENANT001")

	got, err := rpcmiddleware.ResolveTenantPublicID(nil, headers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "TENANT001" {
		t.Fatalf("tenant_public_id = %q, want TENANT001", got)
	}
}

func TestResolveTenantPublicID_MismatchReturnsInvalidArgument(t *testing.T) {
	headers := http.Header{}
	headers.Set(rpcmiddleware.TenantPublicIDHeaderName, "TENANT_B")

	_, err := rpcmiddleware.ResolveTenantPublicID(&publirattypesv1.TenantContext{TenantPublicId: "TENANT_A"}, headers)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

func TestResolveTenantPublicIDValue_FromTenantIDAliasHeader(t *testing.T) {
	headers := http.Header{}
	headers.Set(rpcmiddleware.TenantIDHeaderName, "TENANT001")

	got, err := rpcmiddleware.ResolveTenantPublicIDValue("", headers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "TENANT001" {
		t.Fatalf("tenant_public_id = %q, want TENANT001", got)
	}
}
