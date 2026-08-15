package publicapi

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
)

const getTenantByDomainsQuery = "-- name: GetTenantByDomains :one\n"

func TestGetTenantByDomainDatabaseErrorIsHidden(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByDomainsQuery)).
		WillReturnError(errors.New(`pq: relation "tenants" does not exist`))

	client := publirav1connect.NewDomainServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetTenantByDomain(context.Background(), connect.NewRequest(&publirav1.GetTenantByDomainRequest{
		Domains: []string{"tenant.example.com"},
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetTenantByDomain code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertPublicExpectations(t, mock)
}
