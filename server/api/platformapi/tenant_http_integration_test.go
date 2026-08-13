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
	"github.com/publira/publira/server/internal/publicid"
	"github.com/publira/publira/server/internal/tenanttz"
)

func TestListTenantsReturnsEmptyList(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(integrationListTenantsQuery)).
		WithArgs(sql.NullString{String: "", Valid: true}, sql.NullString{String: "", Valid: true}, sql.NullString{String: "", Valid: true}, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
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

// A public_id collision is the one conflict the caller never learns about: the
// insert is retried from a savepoint with a freshly generated ID.
func TestCreateTenantRetriesDuplicatePublicID(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)
	attempted := &publicIDArgument{}
	mock.ExpectBegin()
	expectPlatformConfigLookup(mock, tenanttz.Default, now)
	expectPublicIDAttempt(mock)
	mock.ExpectQuery(regexp.QuoteMeta(integrationCreateTenantQuery)).
		WithArgs(sqlmock.AnyArg(), attempted, sql.NullString{String: "dup.example.com", Valid: true}, sql.NullString{}, "Duplicate Tenant", tenanttz.Default).
		WillReturnError(duplicatePublicIDError())
	expectPublicIDAttemptRolledBack(mock)
	expectPublicIDAttempt(mock)
	mock.ExpectQuery(regexp.QuoteMeta(integrationCreateTenantQuery)).
		WithArgs(sqlmock.AnyArg(), attempted, sql.NullString{String: "dup.example.com", Valid: true}, sql.NullString{}, "Duplicate Tenant", tenanttz.Default).
		WillReturnRows(sqlmock.NewRows(integrationTenantColumns()).
			AddRow(tenantID, "4ERDqTx5YB8m", "dup.example.com", "Duplicate Tenant", nil, now, "active", nil, "Asia/Tokyo"))
	expectPublicIDAttemptReleased(mock)
	mock.ExpectCommit()
	expectIntegrationAuditLogInsert(mock)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.CreateTenant(context.Background(), newAuthedCreateTenantIntegrationRequest(&publirasplatformv1.CreateTenantRequest{Name: "Duplicate Tenant", Domain: "dup.example.com"}))
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if resp.Msg.Tenant.PublicId != "4ERDqTx5YB8m" {
		t.Fatalf("tenant.public_id = %q, want 4ERDqTx5YB8m", resp.Msg.Tenant.PublicId)
	}
	assertRetriedWithFreshPublicIDs(t, attempted, 2)
	assertIntegrationExpectations(t, mock)
}

// Exhausting the retries is an internal failure, not the "public_id already
// exists" answer the tenant unique-violation mapping would otherwise produce.
func TestCreateTenantPublicIDAttemptsExhaustedIsInternal(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	attempted := &publicIDArgument{}
	mock.ExpectBegin()
	expectPlatformConfigLookup(mock, tenanttz.Default, now)
	for range publicid.MaxAttempts {
		expectPublicIDAttempt(mock)
		mock.ExpectQuery(regexp.QuoteMeta(integrationCreateTenantQuery)).
			WithArgs(sqlmock.AnyArg(), attempted, sql.NullString{String: "dup.example.com", Valid: true}, sql.NullString{}, "Duplicate Tenant", tenanttz.Default).
			WillReturnError(duplicatePublicIDError())
		expectPublicIDAttemptRolledBack(mock)
	}
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantIntegrationRequest(&publirasplatformv1.CreateTenantRequest{Name: "Duplicate Tenant", Domain: "dup.example.com"}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("CreateTenant code = %v, want internal (err=%v)", connect.CodeOf(err), err)
	}
	if strings.Contains(err.Error(), "already exists") {
		t.Fatalf("CreateTenant error = %v, want an internal failure rather than a conflict", err)
	}
	assertRetriedWithFreshPublicIDs(t, attempted, publicid.MaxAttempts)
	assertIntegrationExpectations(t, mock)
}

func TestCreateTenantDuplicateDomainReturnsAlreadyExists(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)
	mock.ExpectBegin()
	expectPlatformConfigLookup(mock, tenanttz.Default, now)
	expectPublicIDAttempt(mock)
	mock.ExpectQuery(regexp.QuoteMeta(integrationCreateTenantQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sql.NullString{String: "existing.example.com", Valid: true}, sql.NullString{}, "Domain Duplicate Tenant", tenanttz.Default).
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
	expectPlatformConfigLookup(mock, tenanttz.Default, now)
	expectPublicIDAttempt(mock)
	mock.ExpectQuery(regexp.QuoteMeta(integrationCreateTenantQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sql.NullString{String: "sub001.example.com", Valid: true}, sql.NullString{String: "admin.sub001.example.com", Valid: true}, "Subdomain Duplicate Tenant", tenanttz.Default).
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
