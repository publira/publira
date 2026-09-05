package publicapi

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/internal/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/gen/publira/v1/publirav1connect"
)

const getTenantByDomainsQuery = "-- name: GetTenantByDomains :one\n"

func TestGetTenantByDomainReturnsDefaultLocale(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByDomainsQuery)).
		WillReturnRows(sqlmock.NewRows(publicTenantColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Tenant", nil, now, "active", nil, "Asia/Tokyo", "en"))

	client := publirav1connect.NewDomainServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetTenantByDomain(context.Background(), connect.NewRequest(&publirav1.GetTenantByDomainRequest{
		Domains: []string{"tenant.example.com"},
	}))
	if err != nil {
		t.Fatalf("GetTenantByDomain: %v", err)
	}
	if resp.Msg.TenantId != tenantID.String() {
		t.Fatalf("tenant_id = %q, want %s", resp.Msg.TenantId, tenantID)
	}
	if resp.Msg.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.DefaultLocale)
	}
	assertPublicExpectations(t, mock)
}

// Domain resolution is the first read of every storefront request, and its
// answer decides the language the whole site renders in. A stored value naming
// no supported locale ends the request instead of handing the site one nobody
// chose.
func TestGetTenantByDomainFailsOnAnUnusableStoredLocale(t *testing.T) {
	tests := []struct {
		name   string
		stored string
	}{
		{name: "blank", stored: ""},
		{name: "unsupported code", stored: "fr"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testServer, mock := newTestPublicServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now()

			mock.ExpectQuery(regexp.QuoteMeta(getTenantByDomainsQuery)).
				WillReturnRows(sqlmock.NewRows(publicTenantColumns()).
					AddRow(tenantID, "TENANT001", "tenant.example.com", "Tenant", nil, now, "active", nil, "Asia/Tokyo", tt.stored))

			client := publirav1connect.NewDomainServiceClient(testServer.Client(), testServer.URL)
			_, err := client.GetTenantByDomain(context.Background(), connect.NewRequest(&publirav1.GetTenantByDomainRequest{
				Domains: []string{"tenant.example.com"},
			}))
			if connect.CodeOf(err) != connect.CodeInternal {
				t.Fatalf("GetTenantByDomain code = %v, want internal (err=%v)", connect.CodeOf(err), err)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

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
