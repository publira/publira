package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/api/platformapi"
	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	listTenantsQuery              = "-- name: ListTenants :many\n"
	createTenantQuery             = "-- name: CreateTenant :one\n"
	updateTenantStatusQuery       = "-- name: UpdateTenantStatus :one\n"
	getSessionByTokenHash         = "-- name: GetPlatformSessionByTokenHash :one\n"
	getUserByIDQuery              = "-- name: GetPlatformUserByID :one\n"
	listPlatformUserRolesQuery    = "-- name: ListPlatformUserRoles :many\n"
	listPlatformOperatorsQuery    = "-- name: ListPlatformOperators :many\n"
	countAllTenantsQuery          = "-- name: CountAllTenants :one\n"
	countActiveTenantsQuery       = "-- name: CountActiveTenants :one\n"
	countSuspendedTenantsQuery    = "-- name: CountSuspendedTenants :one\n"
	countPendingEndUsersQuery     = "-- name: CountPendingEndUsers :one\n"
	listRecentPlatformEventsQuery = "-- name: ListRecentPlatformEvents :many\n"
	listAdminAuditLogsQuery       = "-- name: ListPlatformAuditLogs :many\n"
	testSessionToken              = "platform-session-token"
	testPlatformRole              = "platform_operator"
)

func tenantColumns() []string {
	return []string{"id", "public_id", "domain", "name", "default_reading_period_hours", "created_at", "status", "admin_domain"}
}

func listOperatorColumns() []string {
	return []string{"public_id", "email", "name", "role", "status", "created_at"}
}

func newTestPlatformServer(t *testing.T) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	server := httptest.NewServer(platformapi.NewHandler(db, dbmodels.New(db), slog.Default()))
	t.Cleanup(server.Close)
	return server, mock
}

func newRequest[T any](msg T) *connect.Request[T] {
	return connect.NewRequest(&msg)
}

func newAuthedRequest[T any](msg T) *connect.Request[T] {
	req := connect.NewRequest(&msg)
	req.Header().Set("X-Publira-Session-Id", testSessionToken)
	return req
}

func newAuthedCreateTenantRequest(msg *publirasplatformv1.CreateTenantRequest) *connect.Request[publirasplatformv1.CreateTenantRequest] {
	req := connect.NewRequest(msg)
	req.Header().Set("X-Publira-Session-Id", testSessionToken)
	return req
}

func validCreateTenantRequest() *publirasplatformv1.CreateTenantRequest {
	return &publirasplatformv1.CreateTenantRequest{
		Name:               "New Tenant",
		Domain:             "new.example.com",
		InitialAdminEmails: []string{"owner@example.com"},
	}
}

func expectPlatformGuard(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, role string, now time.Time) {
	_ = tenantID
	mock.ExpectQuery(regexp.QuoteMeta(getSessionByTokenHash)).
		WithArgs(auth.HashToken(testSessionToken)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "platform_user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), userID, auth.HashToken(testSessionToken), now.Add(time.Hour), nil, now))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "status", "created_at"}).
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(listPlatformUserRolesQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(role))
}

func assertExpectations(t *testing.T, mock sqlmock.Sqlmock) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func expectAdminAuditLogInsert(mock sqlmock.Sqlmock) {
	mock.ExpectExec("INSERT INTO platform_audit_logs").
		WillReturnResult(sqlmock.NewResult(0, 1))
}

// TestPlatformHandlerExposesOnlyPlatformRoutes は、NewHandler が PlatformTenantService のみ
// 公開し、admin / public API のルートを登録しないことを検証する。
func TestPlatformHandlerExposesOnlyPlatformRoutes(t *testing.T) {
	ts := httptest.NewServer(platformapi.NewHandler(nil, nil, slog.Default()))
	t.Cleanup(ts.Close)

	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformTenantService/ListTenants", false)
	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformTenantService/CreateTenant", false)
	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformAuthService/GetMe", false)
	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformDashboardService/GetDashboardSummary", false)
	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformAuditLogService/ListAuditLogs", false)
	assertRouteStatus(t, ts, "/publira.admin.v1.AdminSeriesService/ListSeries", true)
	assertRouteStatus(t, ts, "/publira.v1.CatalogService/ListPublishedSeries", true)
}

func assertRouteStatus(t *testing.T, ts *httptest.Server, path string, wantNotFound bool) {
	t.Helper()
	resp, err := ts.Client().Get(ts.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	_ = resp.Body.Close()
	gotNotFound := resp.StatusCode == http.StatusNotFound
	if gotNotFound != wantNotFound {
		t.Fatalf("path %s: status=%d not_found=%v, want not_found=%v", path, resp.StatusCode, gotNotFound, wantNotFound)
	}
}

// TestListTenantsReturnsEmptyList はテナントが存在しない場合に空リストを返すことを検証する。
func TestListTenantsReturnsEmptyList(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs("", "", "", int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenants(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantsRequest{}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(resp.Msg.Tenants) != 0 {
		t.Fatalf("tenant count = %d, want 0", len(resp.Msg.Tenants))
	}
	assertExpectations(t, mock)
}

func TestCreateTenantRejectsEmptyDomain(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	req := validCreateTenantRequest()
	req.Domain = ""
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(req))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestCreateTenantRejectsInvalidInitialAdminEmails(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	req := validCreateTenantRequest()
	req.InitialAdminEmails = []string{"invalid-email"}
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(req))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestCreateTenantDuplicateReturnsAlreadyExists は public_id が重複する場合 AlreadyExists を返すことを検証する。
func TestCreateTenantDuplicateReturnsAlreadyExists(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	mock.ExpectBegin()

	mock.ExpectQuery(regexp.QuoteMeta(createTenantQuery)).
		WithArgs(
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sql.NullString{String: "dup.example.com", Valid: true},
			sql.NullString{},
			"Duplicate Tenant",
		).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "tenants_public_id_key"})
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(&publirasplatformv1.CreateTenantRequest{
		Name:   "Duplicate Tenant",
		Domain: "dup.example.com",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists", connect.CodeOf(err))
	}
	if !strings.Contains(strings.ToLower(err.Error()), "public_id") {
		t.Fatalf("CreateTenant error = %v, want public_id duplicate message", err)
	}
	assertExpectations(t, mock)
}

func TestCreateTenantDuplicateDomainReturnsAlreadyExists(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	mock.ExpectBegin()

	mock.ExpectQuery(regexp.QuoteMeta(createTenantQuery)).
		WithArgs(
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sql.NullString{String: "existing.example.com", Valid: true},
			sql.NullString{},
			"Domain Duplicate Tenant",
		).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "tenants_domain_key"})
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(&publirasplatformv1.CreateTenantRequest{
		Name:   "Domain Duplicate Tenant",
		Domain: "existing.example.com",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists", connect.CodeOf(err))
	}
	if !strings.Contains(strings.ToLower(err.Error()), "domain") {
		t.Fatalf("CreateTenant error = %v, want domain duplicate message", err)
	}
	assertExpectations(t, mock)
}

func TestCreateTenantDuplicateAdminDomainReturnsAlreadyExists(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	mock.ExpectBegin()

	mock.ExpectQuery(regexp.QuoteMeta(createTenantQuery)).
		WithArgs(
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sql.NullString{String: "sub001.example.com", Valid: true},
			sql.NullString{String: "admin.sub001.example.com", Valid: true},
			"Subdomain Duplicate Tenant",
		).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "tenants_admin_domain_key"})
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(&publirasplatformv1.CreateTenantRequest{
		Name:        "Subdomain Duplicate Tenant",
		Domain:      "sub001.example.com",
		AdminDomain: "admin.sub001.example.com",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists", connect.CodeOf(err))
	}
	if !strings.Contains(strings.ToLower(err.Error()), "admin_domain") {
		t.Fatalf("CreateTenant error = %v, want admin_domain duplicate message", err)
	}
	assertExpectations(t, mock)
}

// TestSuspendTenantSuccess はテナント停止の正常系を検証する。
func TestSuspendTenantSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(updateTenantStatusQuery)).
		WithArgs("ACTIVE01", "suspended").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id, "ACTIVE01", "active.example.com", "Active Tenant", nil, now, "suspended", nil))
	expectAdminAuditLogInsert(mock)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.SuspendTenant(context.Background(), newAuthedRequest(publirasplatformv1.SuspendTenantRequest{PublicId: "ACTIVE01"}))
	if err != nil {
		t.Fatalf("SuspendTenant: %v", err)
	}
	if resp.Msg.Tenant.Status != "suspended" {
		t.Fatalf("tenant.status = %q, want suspended", resp.Msg.Tenant.Status)
	}
	assertExpectations(t, mock)
}

// TestSuspendTenantNotFound は存在しないテナントの場合 NotFound を返すことを検証する。
func TestSuspendTenantNotFound(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(updateTenantStatusQuery)).
		WithArgs("NOTFOUND", "suspended").
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.SuspendTenant(context.Background(), newAuthedRequest(publirasplatformv1.SuspendTenantRequest{PublicId: "NOTFOUND"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("SuspendTenant code = %v, want not_found", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestResumeTenantSuccess はテナント再開の正常系を検証する。
func TestResumeTenantSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(updateTenantStatusQuery)).
		WithArgs("SUSP001", "active").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id, "SUSP001", "suspended.example.com", "Suspended Tenant", nil, now, "active", nil))
	expectAdminAuditLogInsert(mock)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ResumeTenant(context.Background(), newAuthedRequest(publirasplatformv1.ResumeTenantRequest{PublicId: "SUSP001"}))
	if err != nil {
		t.Fatalf("ResumeTenant: %v", err)
	}
	if resp.Msg.Tenant.Status != "active" {
		t.Fatalf("tenant.status = %q, want active", resp.Msg.Tenant.Status)
	}
	assertExpectations(t, mock)
}

func TestPlatformTenantRequiresSession(t *testing.T) {
	ts, _ := newTestPlatformServer(t)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.ListTenants(context.Background(), newRequest(publirasplatformv1.ListTenantsRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListTenants code = %v, want unauthenticated", connect.CodeOf(err))
	}
}

func TestPlatformTenantRejectsNonPlatformRole(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, "tenant_admin", now)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.ListTenants(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantsRequest{}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListTenants code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestListOperators(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(listPlatformOperatorsQuery)).
		WillReturnRows(sqlmock.NewRows(listOperatorColumns()).
			AddRow("PLATUSER001", "operator1@example.com", "Operator One", "platform_operator", "active", now).
			AddRow("PLATUSER002", "operator2@example.com", "Operator Two", "platform_auditor", "suspended", now))

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListOperators(context.Background(), newAuthedRequest(publirasplatformv1.ListOperatorsRequest{}))
	if err != nil {
		t.Fatalf("ListOperators: %v", err)
	}
	if len(resp.Msg.Operators) != 2 {
		t.Fatalf("len(operators) = %d, want 2", len(resp.Msg.Operators))
	}
	if resp.Msg.Operators[1].Status != "suspended" {
		t.Fatalf("status = %q, want suspended", resp.Msg.Operators[1].Status)
	}
	assertExpectations(t, mock)
}

func TestListAuditLogs(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	actorID1 := uuid.Must(uuid.NewV7())
	actorID2 := uuid.Must(uuid.NewV7())
	targetOperatorID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAdminAuditLogsQuery)).
		WithArgs(sql.NullString{}, sql.NullString{}, sql.NullString{}, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "actor_platform_user_id", "actor_role", "action", "target_type", "target_id", "outcome", "reason", "client_ip", "created_at", "actor_name", "actor_public_id", "tenant_name", "tenant_public_id", "target_public_id", "target_name"}).
			AddRow(uuid.Must(uuid.NewV7()), actorID1, "platform_operator", "tenant_created", "tenant", tenantID.String(), "success", nil, "203.0.113.10", now, "Operator One", "PLATUSER001", "Tenant One", "TENANT001", "TENANT001", "Tenant One").
			AddRow(uuid.Must(uuid.NewV7()), actorID2, "platform_super_admin", "operator_updated", "operator", targetOperatorID.String(), "success", nil, nil, now.Add(-time.Minute), "Operator Two", "PLATUSER002", "", "", "PLATUSER003", "Operator Three"))

	client := publirasplatformv1connect.NewPlatformAuditLogServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListAuditLogs(context.Background(), newAuthedRequest(publirasplatformv1.ListAuditLogsRequest{}))
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	if len(resp.Msg.AuditLogs) != 2 {
		t.Fatalf("len(audit_logs) = %d, want 2", len(resp.Msg.AuditLogs))
	}
	if resp.Msg.AuditLogs[0].TenantPublicId != "TENANT001" {
		t.Fatalf("audit_logs[0].tenant_public_id = %q, want TENANT001", resp.Msg.AuditLogs[0].TenantPublicId)
	}
	if resp.Msg.AuditLogs[1].TargetId != targetOperatorID.String() {
		t.Fatalf("audit_logs[1].target_id = %q, want %s", resp.Msg.AuditLogs[1].TargetId, targetOperatorID.String())
	}
	assertExpectations(t, mock)
}

func TestListAuditLogsWithFilters(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAdminAuditLogsQuery)).
		WithArgs(
			sql.NullString{String: "PLATUSER001", Valid: true},
			sql.NullString{String: "TENANT001", Valid: true},
			sql.NullString{String: "tenant_created", Valid: true},
			int32(5),
			int32(10),
		).
		WillReturnRows(sqlmock.NewRows([]string{"id", "actor_platform_user_id", "actor_role", "action", "target_type", "target_id", "outcome", "reason", "client_ip", "created_at", "actor_name", "actor_public_id", "tenant_name", "tenant_public_id", "target_public_id", "target_name"}).
			AddRow(uuid.Must(uuid.NewV7()), actorID, "platform_operator", "tenant_created", "tenant", tenantID.String(), "success", nil, nil, now, "Operator One", "PLATUSER001", "Tenant One", "TENANT001", "TENANT001", "Tenant One"))

	client := publirasplatformv1connect.NewPlatformAuditLogServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListAuditLogs(context.Background(), newAuthedRequest(publirasplatformv1.ListAuditLogsRequest{
		Limit:             10,
		Offset:            5,
		TenantPublicId:    "TENANT001",
		ActorUserPublicId: "PLATUSER001",
		Action:            "tenant_created",
	}))
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	if len(resp.Msg.AuditLogs) != 1 {
		t.Fatalf("len(audit_logs) = %d, want 1", len(resp.Msg.AuditLogs))
	}
	if resp.Msg.AuditLogs[0].Action != "tenant_created" {
		t.Fatalf("audit_logs[0].action = %q, want tenant_created", resp.Msg.AuditLogs[0].Action)
	}
	assertExpectations(t, mock)
}

func TestListAuditLogsClampLimit(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAdminAuditLogsQuery)).
		WithArgs(sql.NullString{}, sql.NullString{}, sql.NullString{}, int32(0), int32(100)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "actor_platform_user_id", "actor_role", "action", "target_type", "target_id", "outcome", "reason", "client_ip", "created_at", "actor_name", "actor_public_id", "tenant_name", "tenant_public_id", "target_public_id", "target_name"}))

	client := publirasplatformv1connect.NewPlatformAuditLogServiceClient(ts.Client(), ts.URL)
	_, err := client.ListAuditLogs(context.Background(), newAuthedRequest(publirasplatformv1.ListAuditLogsRequest{Limit: 999}))
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	assertExpectations(t, mock)
}

func TestListAuditLogsUnauthenticated(t *testing.T) {
	ts, _ := newTestPlatformServer(t)

	client := publirasplatformv1connect.NewPlatformAuditLogServiceClient(ts.Client(), ts.URL)
	_, err := client.ListAuditLogs(context.Background(), newRequest(publirasplatformv1.ListAuditLogsRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListAuditLogs code = %v, want unauthenticated", connect.CodeOf(err))
	}
}

func TestGetDashboardSummary(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(countAllTenantsQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(50)))
	mock.ExpectQuery(regexp.QuoteMeta(countActiveTenantsQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(42)))
	mock.ExpectQuery(regexp.QuoteMeta(countSuspendedTenantsQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(8)))
	mock.ExpectQuery(regexp.QuoteMeta(countPendingEndUsersQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(3)))
	mock.ExpectQuery(regexp.QuoteMeta(listRecentPlatformEventsQuery)).
		WithArgs(int32(10)).
		WillReturnRows(sqlmock.NewRows([]string{"event_type", "action", "target", "actor", "occurred_at"}).
			AddRow("tenant_created", "Tenant Created", "TENANT001", "", now).
			AddRow("operator_role_granted", "Operator Role Granted", "PLATUSER001", "operator.yamada", now.Add(-time.Minute)))

	client := publirasplatformv1connect.NewPlatformDashboardServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetDashboardSummary(context.Background(), newAuthedRequest(publirasplatformv1.GetDashboardSummaryRequest{}))
	if err != nil {
		t.Fatalf("GetDashboardSummary: %v", err)
	}
	if resp.Msg.TotalTenants != 50 {
		t.Fatalf("total_tenants = %d, want 50", resp.Msg.TotalTenants)
	}
	if resp.Msg.ActiveTenants != 42 {
		t.Fatalf("active_tenants = %d, want 42", resp.Msg.ActiveTenants)
	}
	if resp.Msg.PendingEndUsers != 3 {
		t.Fatalf("pending_end_users = %d, want 3", resp.Msg.PendingEndUsers)
	}
	if len(resp.Msg.RecentEvents) != 2 {
		t.Fatalf("recent_events count = %d, want 2", len(resp.Msg.RecentEvents))
	}
	if resp.Msg.RecentEvents[0].Actor != "system" {
		t.Fatalf("recent_events[0].actor = %q, want system", resp.Msg.RecentEvents[0].Actor)
	}
	assertExpectations(t, mock)
}

func TestGetDashboardSummaryClampLimit(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(countAllTenantsQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(countActiveTenantsQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(countSuspendedTenantsQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(0)))
	mock.ExpectQuery(regexp.QuoteMeta(countPendingEndUsersQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(0)))
	mock.ExpectQuery(regexp.QuoteMeta(listRecentPlatformEventsQuery)).
		WithArgs(int32(50)).
		WillReturnRows(sqlmock.NewRows([]string{"event_type", "action", "target", "actor", "occurred_at"}))

	client := publirasplatformv1connect.NewPlatformDashboardServiceClient(ts.Client(), ts.URL)
	_, err := client.GetDashboardSummary(context.Background(), newAuthedRequest(publirasplatformv1.GetDashboardSummaryRequest{RecentEventsLimit: 999}))
	if err != nil {
		t.Fatalf("GetDashboardSummary: %v", err)
	}
	assertExpectations(t, mock)
}

func TestGetDashboardSummaryUnauthenticated(t *testing.T) {
	ts, _ := newTestPlatformServer(t)

	client := publirasplatformv1connect.NewPlatformDashboardServiceClient(ts.Client(), ts.URL)
	_, err := client.GetDashboardSummary(context.Background(), newRequest(publirasplatformv1.GetDashboardSummaryRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetDashboardSummary code = %v, want unauthenticated", connect.CodeOf(err))
	}
}
