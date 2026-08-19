package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
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

func TestGetTenantByDomainFallsBackToPlatformDefault(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByDomainsQuery)).
		WillReturnRows(sqlmock.NewRows(publicTenantColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Tenant", nil, now, "active", nil, "Asia/Tokyo", ""))
	expectPlatformConfigLookup(mock, "Asia/Tokyo", "en", now)

	client := publirav1connect.NewDomainServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetTenantByDomain(context.Background(), connect.NewRequest(&publirav1.GetTenantByDomainRequest{
		Domains: []string{"tenant.example.com"},
	}))
	if err != nil {
		t.Fatalf("GetTenantByDomain: %v", err)
	}
	if resp.Msg.DefaultLocale != "en" {
		t.Fatalf("default_locale = %q, want en", resp.Msg.DefaultLocale)
	}
	assertPublicExpectations(t, mock)
}

func TestGetTenantByDomainFallsBackToDefaultLocale(t *testing.T) {
	testServer, mock := newTestPublicServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now()

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByDomainsQuery)).
		WillReturnRows(sqlmock.NewRows(publicTenantColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Tenant", nil, now, "active", nil, "Asia/Tokyo", ""))
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformConfigQuery)).WillReturnError(sql.ErrNoRows)

	client := publirav1connect.NewDomainServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetTenantByDomain(context.Background(), connect.NewRequest(&publirav1.GetTenantByDomainRequest{
		Domains: []string{"tenant.example.com"},
	}))
	if err != nil {
		t.Fatalf("GetTenantByDomain: %v", err)
	}
	if resp.Msg.DefaultLocale == "" {
		t.Fatal("default_locale is empty, want a resolved locale")
	}
	if resp.Msg.DefaultLocale != "ja" {
		t.Fatalf("default_locale = %q, want ja", resp.Msg.DefaultLocale)
	}
	assertPublicExpectations(t, mock)
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
