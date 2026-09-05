package adminapi

import (
	"context"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/gen/publira/admin/v1/publiraadminv1connect"
)

const getAdminTenantByDomainsQuery = "-- name: GetAdminTenantByDomains :one\n"

func expectAdminTenantByDomains(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time, defaultLocale string) {
	mock.ExpectQuery(regexp.QuoteMeta(getAdminTenantByDomainsQuery)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Tenant", nil, now, "active", "admin.tenant.example.com", "Asia/Tokyo", defaultLocale))
}

// Host resolution is the only tenant read the console makes without a session,
// so it is the one that can tell the browser which language the tenant saved.
func TestAdminGetTenantByDomainReturnsDefaultLocale(t *testing.T) {
	ts, mock := newTestAdminServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	expectAdminTenantByDomains(mock, tenantID, time.Now(), "en")

	client := publiraadminv1connect.NewAdminAuthServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetTenantByDomain(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{
		Domains: []string{"admin.tenant.example.com"},
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
	assertExpectations(t, mock)
}

// A stored code this build serves no catalog for ends the request. Answering
// the tenant id alone would leave the console publishing nothing and the
// document naming no language, which hides the data fault behind a screen that
// looks like it worked.
func TestAdminGetTenantByDomainFailsOnAnUnusableStoredLocale(t *testing.T) {
	tests := []struct {
		name   string
		stored string
	}{
		{name: "blank", stored: ""},
		{name: "unsupported code", stored: "fr"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ts, mock := newTestAdminServer(t)
			expectAdminTenantByDomains(mock, uuid.Must(uuid.NewV7()), time.Now(), tt.stored)

			client := publiraadminv1connect.NewAdminAuthServiceClient(ts.Client(), ts.URL)
			_, err := client.GetTenantByDomain(context.Background(), connect.NewRequest(&publiraadminv1.AdminAuthServiceGetTenantByDomainRequest{
				Domains: []string{"admin.tenant.example.com"},
			}))
			if connect.CodeOf(err) != connect.CodeInternal {
				t.Fatalf("GetTenantByDomain code = %v, want internal (err=%v)", connect.CodeOf(err), err)
			}
			assertExpectations(t, mock)
		})
	}
}
