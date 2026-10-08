package publicapi

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

func TestGetTenantByDomainReturnsDefaultLocale(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByDomains)).
		WillReturnRows(sqlmock.NewRows(publicTenantColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Tenant", nil, now, "active", nil, "UTC", "en"))

	client := publirav1connect.NewDomainServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	resp, err := client.GetTenantByDomain(context.Background(), &publirav1.GetTenantByDomainRequest{
		Domains: []string{"tenant.example.com"},
	})
	if err != nil {
		t.Fatalf("GetTenantByDomain: %v", err)
	}
	if resp.TenantId != tenantID.String() {
		t.Fatalf("tenant_id = %q, want %s", resp.TenantId, tenantID)
	}
	if resp.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.DefaultLocale)
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

			mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByDomains)).
				WillReturnRows(sqlmock.NewRows(publicTenantColumns()).
					AddRow(tenantID, "TENANT001", "tenant.example.com", "Tenant", nil, now, "active", nil, "UTC", tt.stored))

			client := publirav1connect.NewDomainServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
			_, err := client.GetTenantByDomain(context.Background(), &publirav1.GetTenantByDomainRequest{
				Domains: []string{"tenant.example.com"},
			})
			if connect.CodeOf(err) != connect.CodeInternal {
				t.Fatalf("GetTenantByDomain code = %v, want internal (err=%v)", connect.CodeOf(err), err)
			}
			assertPublicExpectations(t, mock)
		})
	}
}

func TestGetTenantByDomainDatabaseErrorIsHidden(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByDomains)).
		WillReturnError(errors.New(`pq: relation "tenants" does not exist`))

	client := publirav1connect.NewDomainServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	_, err := client.GetTenantByDomain(context.Background(), &publirav1.GetTenantByDomainRequest{
		Domains: []string{"tenant.example.com"},
	})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetTenantByDomain code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertPublicExpectations(t, mock)
}
