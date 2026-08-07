package platformapi

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
)

func TestListTenantsReturnsEmptyList(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(integrationListTenantsQuery)).
		WithArgs("", "", "", int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(integrationTenantColumns()))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenants(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.ListTenantsRequest{}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(resp.Msg.Tenants) != 0 {
		t.Fatalf("tenant count = %d, want 0", len(resp.Msg.Tenants))
	}
	assertIntegrationExpectations(t, mock)
}

func TestCreateTenantRejectsEmptyDomain(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	req := validIntegrationCreateTenantRequest()
	req.Domain = ""
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantIntegrationRequest(req))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertIntegrationExpectations(t, mock)
}

func TestCreateTenantRejectsInvalidInitialAdminEmails(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	req := validIntegrationCreateTenantRequest()
	req.InitialAdminEmails = []string{"invalid-email"}
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantIntegrationRequest(req))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertIntegrationExpectations(t, mock)
}

func TestCreateTenantDuplicateReturnsAlreadyExists(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(integrationCreateTenantQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sql.NullString{String: "dup.example.com", Valid: true}, sql.NullString{}, "Duplicate Tenant").
		WillReturnError(duplicatePublicIDError())
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantIntegrationRequest(&publirasplatformv1.CreateTenantRequest{Name: "Duplicate Tenant", Domain: "dup.example.com"}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists", connect.CodeOf(err))
	}
	if !strings.Contains(strings.ToLower(err.Error()), "public_id") {
		t.Fatalf("CreateTenant error = %v, want public_id duplicate message", err)
	}
	assertIntegrationExpectations(t, mock)
}

func TestCreateTenantDuplicateDomainReturnsAlreadyExists(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(integrationCreateTenantQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sql.NullString{String: "existing.example.com", Valid: true}, sql.NullString{}, "Domain Duplicate Tenant").
		WillReturnError(duplicateDomainError())
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantIntegrationRequest(&publirasplatformv1.CreateTenantRequest{Name: "Domain Duplicate Tenant", Domain: "existing.example.com"}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists", connect.CodeOf(err))
	}
	if !strings.Contains(strings.ToLower(err.Error()), "domain") {
		t.Fatalf("CreateTenant error = %v, want domain duplicate message", err)
	}
	assertIntegrationExpectations(t, mock)
}

func TestCreateTenantDuplicateAdminDomainReturnsAlreadyExists(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(integrationCreateTenantQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sql.NullString{String: "sub001.example.com", Valid: true}, sql.NullString{String: "admin.sub001.example.com", Valid: true}, "Subdomain Duplicate Tenant").
		WillReturnError(duplicateAdminDomainError())
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantIntegrationRequest(&publirasplatformv1.CreateTenantRequest{Name: "Subdomain Duplicate Tenant", Domain: "sub001.example.com", AdminDomain: "admin.sub001.example.com"}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists", connect.CodeOf(err))
	}
	if !strings.Contains(strings.ToLower(err.Error()), "admin_domain") {
		t.Fatalf("CreateTenant error = %v, want admin_domain duplicate message", err)
	}
	assertIntegrationExpectations(t, mock)
}

func TestSuspendTenantSuccess(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(integrationUpdateTenantStatusQuery)).
		WithArgs("ACTIVE01", "suspended").
		WillReturnRows(sqlmock.NewRows(integrationTenantColumns()).AddRow(id, "ACTIVE01", "active.example.com", "Active Tenant", nil, now, "suspended", nil, "Asia/Tokyo"))
	expectIntegrationAuditLogInsert(mock)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.SuspendTenant(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.SuspendTenantRequest{PublicId: "ACTIVE01"}))
	if err != nil {
		t.Fatalf("SuspendTenant: %v", err)
	}
	if resp.Msg.Tenant.Status != "suspended" {
		t.Fatalf("tenant.status = %q, want suspended", resp.Msg.Tenant.Status)
	}
	assertIntegrationExpectations(t, mock)
}

func TestSuspendTenantNotFound(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(integrationUpdateTenantStatusQuery)).
		WithArgs("NOTFOUND", "suspended").
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.SuspendTenant(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.SuspendTenantRequest{PublicId: "NOTFOUND"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("SuspendTenant code = %v, want not_found", connect.CodeOf(err))
	}
	assertIntegrationExpectations(t, mock)
}

func TestResumeTenantSuccess(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(integrationUpdateTenantStatusQuery)).
		WithArgs("SUSP001", "active").
		WillReturnRows(sqlmock.NewRows(integrationTenantColumns()).AddRow(id, "SUSP001", "suspended.example.com", "Suspended Tenant", nil, now, "active", nil, "Asia/Tokyo"))
	expectIntegrationAuditLogInsert(mock)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ResumeTenant(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.ResumeTenantRequest{PublicId: "SUSP001"}))
	if err != nil {
		t.Fatalf("ResumeTenant: %v", err)
	}
	if resp.Msg.Tenant.Status != "active" {
		t.Fatalf("tenant.status = %q, want active", resp.Msg.Tenant.Status)
	}
	assertIntegrationExpectations(t, mock)
}

func TestPlatformTenantRequiresSession(t *testing.T) {
	ts, _ := newIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.ListTenants(context.Background(), newIntegrationRequest(publirasplatformv1.ListTenantsRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListTenants code = %v, want unauthenticated", connect.CodeOf(err))
	}
}

func TestPlatformTenantRejectsNonPlatformRole(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, "tenant_admin", now)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.ListTenants(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.ListTenantsRequest{}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListTenants code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertIntegrationExpectations(t, mock)
}
