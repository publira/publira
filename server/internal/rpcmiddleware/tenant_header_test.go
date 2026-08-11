package rpcmiddleware_test

import (
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const testTenantID = "00000000-0000-7000-8000-000000000001"

func TestResolveTenantID_FromBody(t *testing.T) {
	got, err := rpcmiddleware.ResolveTenantID(&publirattypesv1.TenantContext{TenantId: testTenantID}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != uuid.MustParse(testTenantID) {
		t.Fatalf("tenant_id = %q, want %s", got, testTenantID)
	}
}

func TestResolveTenantID_FromHeader(t *testing.T) {
	headers := http.Header{}
	headers.Set(rpcmiddleware.TenantIDHeaderName, testTenantID)

	got, err := rpcmiddleware.ResolveTenantID(nil, headers)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != uuid.MustParse(testTenantID) {
		t.Fatalf("tenant_id = %q, want %s", got, testTenantID)
	}
}

func TestResolveTenantID_MismatchReturnsInvalidArgument(t *testing.T) {
	headers := http.Header{}
	headers.Set(rpcmiddleware.TenantIDHeaderName, "00000000-0000-7000-8000-00000000000b")

	_, err := rpcmiddleware.ResolveTenantID(&publirattypesv1.TenantContext{TenantId: testTenantID}, headers)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

func TestResolveTenantID_InvalidUUID(t *testing.T) {
	_, err := rpcmiddleware.ResolveTenantID(&publirattypesv1.TenantContext{TenantId: "not-a-uuid"}, nil)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}
