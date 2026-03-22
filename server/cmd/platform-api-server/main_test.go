package main

import (
	"context"
	"database/sql"
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
	"golang.org/x/crypto/bcrypt"

	"github.com/publira/publira/server/api/platformapi"
	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	getTenantByPublicIDQuery                   = "-- name: GetTenantByPublicID :one\nSELECT id, public_id, domain, subdomain, name, default_reading_period_hours, created_at, status\nFROM tenants\nWHERE public_id = $1\nLIMIT 1\n"
	listTenantsQuery                           = "-- name: ListTenants :many\nSELECT id, public_id, domain, subdomain, name, default_reading_period_hours, created_at, status\nFROM tenants\nWHERE ($1::text = '' OR name ILIKE '%' || $1::text || '%')\n  AND ($2::text = '' OR public_id ILIKE '%' || $2::text || '%')\n  AND ($3::text = '' OR status = $3::text)\nORDER BY created_at DESC\nLIMIT $5 OFFSET $4\n"
	createTenantQuery                          = "-- name: CreateTenant :one\nINSERT INTO tenants (id, public_id, domain, subdomain, name, status)\nVALUES ($1, $2, $3, $4, $5, 'active')\nRETURNING id, public_id, domain, subdomain, name, default_reading_period_hours, created_at, status\n"
	createTenantMembershipQuery                = "-- name: CreateTenantMembership :one\nINSERT INTO tenant_memberships (id, user_id, tenant_id, status)\nVALUES ($1, $2, $3, $4)\nRETURNING id, user_id, tenant_id, status, created_at\n"
	createTenantMemberRoleQuery                = "-- name: CreateTenantMemberRole :one\nINSERT INTO tenant_member_roles (id, membership_id, role)\nVALUES ($1, $2, $3)\nRETURNING id, membership_id, role, created_at\n"
	updateTenantStatusQuery                    = "-- name: UpdateTenantStatus :one\nUPDATE tenants\nSET status = $2\nWHERE public_id = $1\nRETURNING id, public_id, domain, subdomain, name, default_reading_period_hours, created_at, status\n"
	getSessionByTokenHash                      = "-- name: GetSessionByTokenHash :one\nSELECT id, current_tenant_id, user_id, token_hash, expires_at, revoked_at, created_at\nFROM sessions\nWHERE token_hash = $1\nLIMIT 1\n"
	getUserByIDQuery                           = "-- name: GetUserByID :one\nSELECT id, public_id, email, password_hash, name, created_at, status\nFROM users\nWHERE id = $1\n"
	getUserByEmailQuery                        = "-- name: GetUserByEmail :one\nSELECT id, public_id, email, password_hash, name, created_at, status\nFROM users\nWHERE email = $1\nLIMIT 1\n"
	countPlatformUsersQuery                    = "-- name: CountPlatformUsers :one\nSELECT COUNT(*)::int\nFROM (\n        SELECT DISTINCT user_id\n        FROM platform_user_roles\n    ) platform_users\n"
	createUserQuery                            = "-- name: CreateUser :one\nINSERT INTO users (id, public_id, email, password_hash, name)\nVALUES ($1, $2, $3, $4, $5)\nRETURNING id, public_id, email, password_hash, name, created_at, status\n"
	createPlatformUserRoleQuery                = "-- name: CreatePlatformUserRole :one\nINSERT INTO platform_user_roles (id, user_id, role)\nVALUES ($1, $2, $3)\nRETURNING id, user_id, role, created_at\n"
	deletePlatformUserRolesByUserIDQuery       = "-- name: DeletePlatformUserRolesByUserID :exec\nDELETE FROM platform_user_roles\nWHERE user_id = $1\n"
	listPlatformUserRolesQuery                 = "-- name: ListPlatformUserRoles :many\nSELECT role\nFROM platform_user_roles\nWHERE user_id = $1\nORDER BY role\n"
	listPlatformOperatorsQuery                 = "-- name: ListPlatformOperators :many\nSELECT u.public_id,\n    u.email,\n    u.name,\n    COALESCE(\n        (\n            SELECT pur.role\n            FROM platform_user_roles pur\n            WHERE pur.user_id = u.id\n            ORDER BY CASE\n                    WHEN pur.role = 'platform_super_admin' THEN 3\n                    WHEN pur.role = 'super-admin' THEN 3\n                    WHEN pur.role = 'platform_operator' THEN 2\n                    WHEN pur.role = 'platform-operator' THEN 2\n                    WHEN pur.role = 'platform_auditor' THEN 1\n                    ELSE 0\n                END DESC,\n                pur.role ASC\n            LIMIT 1\n        ),\n        ''::text\n    )::text AS role,\n    u.status,\n    u.created_at\nFROM users u\nWHERE EXISTS (\n        SELECT 1\n        FROM platform_user_roles pur\n        WHERE pur.user_id = u.id\n    )\nORDER BY u.created_at DESC\n"
	getPlatformOperatorByPublicIDQuery         = "-- name: GetPlatformOperatorByPublicID :one\nSELECT u.id,\n    u.public_id,\n    u.email,\n    u.name,\n    COALESCE(\n        (\n            SELECT pur.role\n            FROM platform_user_roles pur\n            WHERE pur.user_id = u.id\n            ORDER BY CASE\n                    WHEN pur.role = 'platform_super_admin' THEN 3\n                    WHEN pur.role = 'super-admin' THEN 3\n                    WHEN pur.role = 'platform_operator' THEN 2\n                    WHEN pur.role = 'platform-operator' THEN 2\n                    WHEN pur.role = 'platform_auditor' THEN 1\n                    ELSE 0\n                END DESC,\n                pur.role ASC\n            LIMIT 1\n        ),\n        ''::text\n    )::text AS role,\n    u.status,\n    u.created_at\nFROM users u\nWHERE u.public_id = $1\n    AND EXISTS (\n        SELECT 1\n        FROM platform_user_roles pur\n        WHERE pur.user_id = u.id\n    )\nLIMIT 1\n"
	listEndUsersQuery                          = "-- name: ListEndUsers :many\nSELECT u.id,\n    u.public_id,\n    u.name,\n    u.email,\n    u.status,\n    u.created_at\nFROM users u\nWHERE NOT EXISTS (\n        SELECT 1\n        FROM platform_user_roles pur\n        WHERE pur.user_id = u.id\n    )\n    AND NOT EXISTS (\n        SELECT 1\n        FROM tenant_memberships tm\n        WHERE tm.user_id = u.id\n    )\n    AND ($1::timestamptz IS NULL OR u.created_at >= $1::timestamptz)\n    AND ($2::timestamptz IS NULL OR u.created_at <= $2::timestamptz)\n    AND ($3::text = '' OR u.status = $3::text)\nORDER BY u.created_at DESC\nLIMIT $5 OFFSET $4\n"
	countAllTenantsQuery                       = "-- name: CountAllTenants :one\nSELECT COUNT(*)::int\nFROM tenants\n"
	countActiveTenantsQuery                    = "-- name: CountActiveTenants :one\nSELECT COUNT(*)::int\nFROM tenants\nWHERE status = 'active'\n"
	countSuspendedTenantsQuery                 = "-- name: CountSuspendedTenants :one\nSELECT COUNT(*)::int\nFROM tenants\nWHERE status = 'suspended'\n"
	countPendingEndUsersQuery                  = "-- name: CountPendingEndUsers :one\nSELECT COUNT(*)::int\nFROM users u\nWHERE u.status = 'inactive'\n    AND NOT EXISTS (\n        SELECT 1\n        FROM platform_user_roles pur\n        WHERE pur.user_id = u.id\n    )\n"
	listRecentPlatformEventsQuery              = "-- name: ListRecentPlatformEvents :many\nSELECT event_type,\n    action,\n    target,\n    actor,\n    occurred_at\nFROM (\n        SELECT 'tenant_created'::text AS event_type,\n            'Tenant Created'::text AS action,\n            t.public_id::text AS target,\n            ''::text AS actor,\n            t.created_at AS occurred_at\n        FROM tenants t\n        UNION ALL\n        SELECT 'operator_role_granted'::text AS event_type,\n            'Operator Role Granted'::text AS action,\n            u.public_id::text AS target,\n            ''::text AS actor,\n            pur.created_at AS occurred_at\n        FROM platform_user_roles pur\n            JOIN users u ON u.id = pur.user_id\n        UNION ALL\n        SELECT 'end_user_created'::text AS event_type,\n            'End User Created'::text AS action,\n            u.public_id::text AS target,\n            ''::text AS actor,\n            u.created_at AS occurred_at\n        FROM users u\n        WHERE NOT EXISTS (\n                SELECT 1\n                FROM platform_user_roles pur\n                WHERE pur.user_id = u.id\n            )\n    ) events\nORDER BY occurred_at DESC\nLIMIT $1\n"
	getUserByPublicIDQuery                     = "-- name: GetUserByPublicID :one\nSELECT u.id,\n    u.public_id,\n    u.name,\n    u.email,\n    u.status,\n    u.created_at\nFROM users u\nWHERE u.public_id = $1\nLIMIT 1\n"
	getTenantsByEndUserQuery                   = "-- name: GetTenantsByEndUser :many\nSELECT DISTINCT t.id,\n    t.public_id\nFROM tenants t\n    JOIN tenant_memberships tm ON tm.tenant_id = t.id\nWHERE tm.user_id = $1\n    AND tm.status = 'active'\nORDER BY t.created_at DESC\n"
	countTenantMembershipsByUserIDQuery        = "-- name: CountTenantMembershipsByUserID :one\nSELECT COUNT(*)::int\nFROM tenant_memberships\nWHERE user_id = $1\n"
	updateUserStatusQuery                      = "-- name: UpdateUserStatus :one\nUPDATE users\nSET status = $2\nWHERE public_id = $1\nRETURNING id, public_id, email, password_hash, name, created_at, status\n"
	terminateUserSessionsQuery                 = "-- name: TerminateUserSessions :exec\nUPDATE sessions\nSET revoked_at = NOW()\nWHERE user_id = $1\n    AND revoked_at IS NULL\n"
	deleteUserByIDQuery                        = "-- name: DeleteUserByID :exec\nDELETE FROM users\nWHERE id = $1\n"
	listTenantMembershipsQuery                 = "-- name: ListTenantMemberships :many\nSELECT u.id AS user_id,\n    u.public_id,\n    u.name,\n    u.email,\n    COALESCE(\n        (\n            SELECT tmr.role\n            FROM tenant_member_roles tmr\n            WHERE tmr.membership_id = tm.id\n            ORDER BY CASE\n                    WHEN tmr.role = 'tenant_admin' THEN 3\n                    WHEN tmr.role = 'admin' THEN 3\n                    WHEN tmr.role = 'tenant_editor' THEN 2\n                    WHEN tmr.role = 'editor' THEN 2\n                    WHEN tmr.role = 'tenant_auditor' THEN 1\n                    WHEN tmr.role = 'auditor' THEN 1\n                    ELSE 0\n                END DESC,\n                tmr.role ASC\n            LIMIT 1\n        ),\n        ''::text\n    )::text AS role,\n    tm.status,\n    tm.created_at\nFROM tenant_memberships tm\n    JOIN users u ON u.id = tm.user_id\nWHERE tm.tenant_id = $1\nORDER BY tm.created_at DESC\nLIMIT $3 OFFSET $2\n"
	getTenantMembershipByUserAndTenantQuery    = "-- name: GetTenantMembershipByUserAndTenant :one\nSELECT tm.id, tm.user_id, tm.tenant_id, tm.status, tm.created_at\nFROM tenant_memberships tm\nWHERE tm.user_id = $1\n    AND tm.tenant_id = $2\nLIMIT 1\n"
	deleteTenantMembershipQuery                = "-- name: DeleteTenantMembership :exec\nDELETE FROM tenant_memberships\nWHERE id = $1\n"
	deleteTenantMemberRolesByMembershipIDQuery = "-- name: DeleteTenantMemberRolesByMembershipID :exec\nDELETE FROM tenant_member_roles\nWHERE membership_id = $1\n"
	testSessionToken                           = "platform-session-token"
	testPlatformRole                           = "platform_operator"
)

func tenantColumns() []string {
	return []string{"id", "public_id", "domain", "subdomain", "name", "default_reading_period_hours", "created_at", "status"}
}

func tenantMembershipColumns() []string {
	return []string{"id", "user_id", "tenant_id", "status", "created_at"}
}

func tenantMemberRoleColumns() []string {
	return []string{"id", "membership_id", "role", "created_at"}
}

func listOperatorColumns() []string {
	return []string{"public_id", "email", "name", "role", "status", "created_at"}
}

func operatorColumns() []string {
	return []string{"id", "public_id", "email", "name", "role", "status", "created_at"}
}

func newTestPlatformServer(t *testing.T) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	server := httptest.NewServer(platformapi.NewHandler(db, dbmodels.New(db)))
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
		Subdomain:          "new",
		InitialAdminEmails: []string{"owner@example.com"},
	}
}

func expectPlatformGuard(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, role string, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(getSessionByTokenHash)).
		WithArgs(auth.HashToken(testSessionToken)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "current_tenant_id", "user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), tenantID, userID, auth.HashToken(testSessionToken), now.Add(time.Hour), nil, now))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status"}).
			AddRow(userID, "PLATUSER001", "platform@example.com", "hashed", "Platform User", now, "active"))

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

// TestPlatformHandlerExposesOnlyPlatformRoutes は、NewHandler が PlatformTenantService のみ
// 公開し、admin / public API のルートを登録しないことを検証する。
func TestPlatformHandlerExposesOnlyPlatformRoutes(t *testing.T) {
	ts := httptest.NewServer(platformapi.NewHandler(nil, nil))
	t.Cleanup(ts.Close)

	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformTenantService/ListTenants", false)
	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformTenantService/CreateTenant", false)
	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformAuthService/GetMe", false)
	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformDashboardService/GetDashboardSummary", false)
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
		WithArgs(sql.NullString{Valid: false}, sql.NullString{Valid: false}, sql.NullString{Valid: false}, int32(0), int32(20)).
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

// TestListTenantsReturnsTenants はテナント一覧が正しく返ることを検証する。
func TestListTenantsReturnsTenants(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	id1 := uuid.Must(uuid.NewV7())
	id2 := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs(sql.NullString{Valid: false}, sql.NullString{Valid: false}, sql.NullString{Valid: false}, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id1, "TENANT001", nil, nil, "Tenant One", nil, now, "active").
			AddRow(id2, "TENANT002", nil, nil, "Tenant Two", nil, now, "suspended"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenants(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantsRequest{}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(resp.Msg.Tenants) != 2 {
		t.Fatalf("tenant count = %d, want 2", len(resp.Msg.Tenants))
	}
	if resp.Msg.Tenants[0].PublicId != "TENANT001" {
		t.Fatalf("tenants[0].public_id = %q, want TENANT001", resp.Msg.Tenants[0].PublicId)
	}
	if resp.Msg.Tenants[1].Status != "suspended" {
		t.Fatalf("tenants[1].status = %q, want suspended", resp.Msg.Tenants[1].Status)
	}
	assertExpectations(t, mock)
}

// TestListTenantsAppliesDefaultLimit はデフォルトの limit が 20 であることを検証する。
func TestListTenantsAppliesDefaultLimit(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs(sql.NullString{Valid: false}, sql.NullString{Valid: false}, sql.NullString{Valid: false}, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.ListTenants(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantsRequest{Limit: 0}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	assertExpectations(t, mock)
}

// TestListTenantsClampMaxLimit は limit が 100 以上の場合 100 に丸められることを検証する。
func TestListTenantsClampMaxLimit(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs(sql.NullString{Valid: false}, sql.NullString{Valid: false}, sql.NullString{Valid: false}, int32(0), int32(100)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.ListTenants(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantsRequest{Limit: 200}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	assertExpectations(t, mock)
}

// TestListTenantsFilterByName はテナント一覧を名前でフィルタできることを検証する。
func TestListTenantsFilterByName(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs(sql.NullString{String: "Test", Valid: true}, sql.NullString{Valid: false}, sql.NullString{Valid: false}, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenants(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantsRequest{Name: "Test"}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(resp.Msg.Tenants) != 1 {
		t.Fatalf("tenant count = %d, want 1", len(resp.Msg.Tenants))
	}
	assertExpectations(t, mock)
}

// TestListTenantsFilterByPublicID はテナント一覧を公開IDでフィルタできることを検証する。
func TestListTenantsFilterByPublicID(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs(sql.NullString{Valid: false}, sql.NullString{String: "TENANT001", Valid: true}, sql.NullString{Valid: false}, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenants(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantsRequest{PublicId: "TENANT001"}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(resp.Msg.Tenants) != 1 {
		t.Fatalf("tenant count = %d, want 1", len(resp.Msg.Tenants))
	}
	assertExpectations(t, mock)
}

// TestListTenantsFilterByStatus はテナント一覧をステータスでフィルタできることを検証する。
func TestListTenantsFilterByStatus(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs(sql.NullString{Valid: false}, sql.NullString{Valid: false}, sql.NullString{String: "suspended", Valid: true}, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id, "TENANT001", nil, nil, "Test Tenant", nil, now, "suspended"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenants(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantsRequest{Status: "suspended"}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(resp.Msg.Tenants) != 1 {
		t.Fatalf("tenant count = %d, want 1", len(resp.Msg.Tenants))
	}
	if resp.Msg.Tenants[0].Status != "suspended" {
		t.Fatalf("tenants[0].status = %q, want suspended", resp.Msg.Tenants[0].Status)
	}
	assertExpectations(t, mock)
}

// TestGetTenantSuccess はテナント詳細取得の正常系を検証する。
func TestGetTenantSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetTenant(context.Background(), newAuthedRequest(publirasplatformv1.GetTenantRequest{PublicId: "TENANT001"}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.Tenant.PublicId != "TENANT001" {
		t.Fatalf("tenant.public_id = %q, want TENANT001", resp.Msg.Tenant.PublicId)
	}
	if resp.Msg.Tenant.Name != "Test Tenant" {
		t.Fatalf("tenant.name = %q, want Test Tenant", resp.Msg.Tenant.Name)
	}
	assertExpectations(t, mock)
}

// TestGetTenantNotFound は存在しないテナントの場合 NotFound を返すことを検証する。
func TestGetTenantNotFound(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("NOTFOUND").
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.GetTenant(context.Background(), newAuthedRequest(publirasplatformv1.GetTenantRequest{PublicId: "NOTFOUND"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetTenant code = %v, want not_found", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestGetTenantRequiresPublicID は public_id が空の場合 InvalidArgument を返すことを検証する。
func TestGetTenantRequiresPublicID(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.GetTenant(context.Background(), newAuthedRequest(publirasplatformv1.GetTenantRequest{PublicId: "   "}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("GetTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestCreateTenantSuccess はテナント作成の正常系を検証する。
func TestCreateTenantSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	createdTenantID := uuid.Must(uuid.NewV7())
	createdUserID := uuid.Must(uuid.NewV7())
	createdMembershipID := uuid.Must(uuid.NewV7())

	mock.ExpectBegin()

	mock.ExpectQuery(regexp.QuoteMeta(createTenantQuery)).
		WithArgs(
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sql.NullString{String: "new.example.com", Valid: true},
			sql.NullString{String: "new", Valid: true},
			"New Tenant",
		).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(createdTenantID, "TNNEW000001", "new.example.com", "new", "New Tenant", nil, now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByEmailQuery)).
		WithArgs("owner@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status"}).
			AddRow(createdUserID, "USRNEW000001", "owner@example.com", "hashed-password", "Owner User", now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(createTenantMembershipQuery)).
		WithArgs(sqlmock.AnyArg(), createdUserID, createdTenantID, "active").
		WillReturnRows(sqlmock.NewRows(tenantMembershipColumns()).
			AddRow(createdMembershipID, createdUserID, createdTenantID, "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(createTenantMemberRoleQuery)).
		WithArgs(sqlmock.AnyArg(), createdMembershipID, "tenant_admin").
		WillReturnRows(sqlmock.NewRows(tenantMemberRoleColumns()).
			AddRow(uuid.Must(uuid.NewV7()), createdMembershipID, "tenant_admin", now))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByEmailQuery)).
		WithArgs("missing@example.com").
		WillReturnError(sql.ErrNoRows)

	mock.ExpectCommit()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	req := validCreateTenantRequest()
	req.InitialAdminEmails = []string{"owner@example.com", "missing@example.com"}
	resp, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(req))
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if resp.Msg.Tenant.PublicId != "TNNEW000001" {
		t.Fatalf("tenant.public_id = %q, want TNNEW000001", resp.Msg.Tenant.PublicId)
	}
	if resp.Msg.Tenant.Status != "active" {
		t.Fatalf("tenant.status = %q, want active", resp.Msg.Tenant.Status)
	}
	assertExpectations(t, mock)
}

// TestCreateTenantRequiresName は name が空の場合 InvalidArgument を返すことを検証する。
func TestCreateTenantRequiresName(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	req := validCreateTenantRequest()
	req.Name = ""
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(req))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestCreateTenantRequiresSubdomain(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	req := validCreateTenantRequest()
	req.Subdomain = "   "
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(req))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestCreateTenantAllowsEmptyDomain(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)
	createdTenantID := uuid.Must(uuid.NewV7())

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(createTenantQuery)).
		WithArgs(
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sql.NullString{String: "", Valid: false},
			sql.NullString{String: "new", Valid: true},
			"New Tenant",
		).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(createdTenantID, "TNNEW000002", nil, "new", "New Tenant", nil, now, "active"))
	mock.ExpectCommit()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	req := validCreateTenantRequest()
	req.Domain = ""
	req.InitialAdminEmails = nil
	resp, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(req))
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if resp.Msg.Tenant.PublicId != "TNNEW000002" {
		t.Fatalf("tenant.public_id = %q, want TNNEW000002", resp.Msg.Tenant.PublicId)
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
			sql.NullString{String: "dup", Valid: true},
			"Duplicate Tenant",
		).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "tenants_public_id_key"})
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(&publirasplatformv1.CreateTenantRequest{
		Name:      "Duplicate Tenant",
		Domain:    "dup.example.com",
		Subdomain: "dup",
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
			sql.NullString{String: "dom001", Valid: true},
			"Domain Duplicate Tenant",
		).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "tenants_domain_key"})
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(&publirasplatformv1.CreateTenantRequest{
		Name:      "Domain Duplicate Tenant",
		Domain:    "existing.example.com",
		Subdomain: "dom001",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists", connect.CodeOf(err))
	}
	if !strings.Contains(strings.ToLower(err.Error()), "domain") {
		t.Fatalf("CreateTenant error = %v, want domain duplicate message", err)
	}
	assertExpectations(t, mock)
}

func TestCreateTenantDuplicateSubdomainReturnsAlreadyExists(t *testing.T) {
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
			sql.NullString{String: "existing-sub", Valid: true},
			"Subdomain Duplicate Tenant",
		).
		WillReturnError(&pgconn.PgError{Code: "23505", ConstraintName: "tenants_subdomain_key"})
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newAuthedCreateTenantRequest(&publirasplatformv1.CreateTenantRequest{
		Name:      "Subdomain Duplicate Tenant",
		Domain:    "sub001.example.com",
		Subdomain: "existing-sub",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists", connect.CodeOf(err))
	}
	if !strings.Contains(strings.ToLower(err.Error()), "subdomain") {
		t.Fatalf("CreateTenant error = %v, want subdomain duplicate message", err)
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
			AddRow(id, "ACTIVE01", nil, nil, "Active Tenant", nil, now, "suspended"))

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
			AddRow(id, "SUSP001", nil, nil, "Suspended Tenant", nil, now, "active"))

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

func TestCreateOperatorSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	adminID := uuid.Must(uuid.NewV7())
	newOperatorID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(getUserByEmailQuery)).
		WithArgs("new-operator@example.com").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(createUserQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "new-operator@example.com", sqlmock.AnyArg(), "New Operator").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status"}).
			AddRow(newOperatorID, "PLATNEW001", "new-operator@example.com", "hash", "New Operator", now, "active"))
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformUserRolesQuery)).
		WithArgs(newOperatorID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))
	mock.ExpectQuery(regexp.QuoteMeta(createPlatformUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), newOperatorID, "platform_operator").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), newOperatorID, "platform_operator", now))
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATNEW001").
		WillReturnRows(sqlmock.NewRows(operatorColumns()).
			AddRow(newOperatorID, "PLATNEW001", "new-operator@example.com", "New Operator", "platform_operator", "active", now))
	mock.ExpectCommit()

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	resp, err := client.CreateOperator(context.Background(), newAuthedRequest(publirasplatformv1.CreateOperatorRequest{
		Name:  "New Operator",
		Email: "new-operator@example.com",
		Role:  "platform_operator",
	}))
	if err != nil {
		t.Fatalf("CreateOperator: %v", err)
	}
	if resp.Msg.Operator == nil || resp.Msg.Operator.PublicId != "PLATNEW001" {
		t.Fatalf("operator = %v, want public_id=PLATNEW001", resp.Msg.Operator)
	}
	assertExpectations(t, mock)
}

func TestCreateOperatorRequiresSuperAdmin(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	operatorID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, operatorID, "platform_operator", now)

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateOperator(context.Background(), newAuthedRequest(publirasplatformv1.CreateOperatorRequest{
		Name:  "New Operator",
		Email: "new-operator@example.com",
		Role:  "platform_operator",
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateOperator code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestUpdateOperatorRoleSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	adminID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER002").
		WillReturnRows(sqlmock.NewRows(operatorColumns()).
			AddRow(targetID, "PLATUSER002", "operator2@example.com", "Operator Two", "platform_operator", "active", now))
	mock.ExpectExec(regexp.QuoteMeta(deletePlatformUserRolesByUserIDQuery)).
		WithArgs(targetID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(createPlatformUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), targetID, "platform_auditor").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), targetID, "platform_auditor", now))
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER002").
		WillReturnRows(sqlmock.NewRows(operatorColumns()).
			AddRow(targetID, "PLATUSER002", "operator2@example.com", "Operator Two", "platform_auditor", "active", now))
	mock.ExpectCommit()

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	resp, err := client.UpdateOperatorRole(context.Background(), newAuthedRequest(publirasplatformv1.UpdateOperatorRoleRequest{
		PublicId: "PLATUSER002",
		Role:     "platform_auditor",
	}))
	if err != nil {
		t.Fatalf("UpdateOperatorRole: %v", err)
	}
	if resp.Msg.Operator == nil || resp.Msg.Operator.Role != "platform_auditor" {
		t.Fatalf("operator.role = %v, want platform_auditor", resp.Msg.Operator)
	}
	assertExpectations(t, mock)
}

func TestSuspendOperatorSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	adminID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER003").
		WillReturnRows(sqlmock.NewRows(operatorColumns()).
			AddRow(targetID, "PLATUSER003", "operator3@example.com", "Operator Three", "platform_operator", "active", now))
	mock.ExpectQuery(regexp.QuoteMeta(updateUserStatusQuery)).
		WithArgs("PLATUSER003", "suspended").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status"}).
			AddRow(targetID, "PLATUSER003", "operator3@example.com", "hash", "Operator Three", now, "suspended"))
	mock.ExpectExec(regexp.QuoteMeta(terminateUserSessionsQuery)).
		WithArgs(targetID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER003").
		WillReturnRows(sqlmock.NewRows(operatorColumns()).
			AddRow(targetID, "PLATUSER003", "operator3@example.com", "Operator Three", "platform_operator", "suspended", now))
	mock.ExpectCommit()

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	resp, err := client.SuspendOperator(context.Background(), newAuthedRequest(publirasplatformv1.SuspendOperatorRequest{PublicId: "PLATUSER003"}))
	if err != nil {
		t.Fatalf("SuspendOperator: %v", err)
	}
	if resp.Msg.Operator == nil || resp.Msg.Operator.Status != "suspended" {
		t.Fatalf("operator.status = %v, want suspended", resp.Msg.Operator)
	}
	assertExpectations(t, mock)
}

func TestUnsuspendOperatorRejectsInvalidState(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	adminID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER004").
		WillReturnRows(sqlmock.NewRows(operatorColumns()).
			AddRow(targetID, "PLATUSER004", "operator4@example.com", "Operator Four", "platform_operator", "active", now))
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	_, err := client.UnsuspendOperator(context.Background(), newAuthedRequest(publirasplatformv1.UnsuspendOperatorRequest{PublicId: "PLATUSER004"}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UnsuspendOperator code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestDeactivateOperatorSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	adminID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER005").
		WillReturnRows(sqlmock.NewRows(operatorColumns()).
			AddRow(targetID, "PLATUSER005", "operator5@example.com", "Operator Five", "platform_operator", "active", now))
	mock.ExpectQuery(regexp.QuoteMeta(updateUserStatusQuery)).
		WithArgs("PLATUSER005", "inactive").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status"}).
			AddRow(targetID, "PLATUSER005", "operator5@example.com", "hash", "Operator Five", now, "inactive"))
	mock.ExpectExec(regexp.QuoteMeta(terminateUserSessionsQuery)).
		WithArgs(targetID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER005").
		WillReturnRows(sqlmock.NewRows(operatorColumns()).
			AddRow(targetID, "PLATUSER005", "operator5@example.com", "Operator Five", "platform_operator", "inactive", now))
	mock.ExpectCommit()

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	resp, err := client.DeactivateOperator(context.Background(), newAuthedRequest(publirasplatformv1.DeactivateOperatorRequest{PublicId: "PLATUSER005"}))
	if err != nil {
		t.Fatalf("DeactivateOperator: %v", err)
	}
	if resp.Msg.Operator == nil || resp.Msg.Operator.Status != "inactive" {
		t.Fatalf("operator.status = %v, want inactive", resp.Msg.Operator)
	}
	assertExpectations(t, mock)
}

func TestDeactivateOperatorRequiresSuperAdmin(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	operatorID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, operatorID, "platform_operator", now)

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	_, err := client.DeactivateOperator(context.Background(), newAuthedRequest(publirasplatformv1.DeactivateOperatorRequest{PublicId: "PLATUSER005"}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeactivateOperator code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestDeactivateOperatorSelfDeactivationForbidden(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	adminID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER001").
		WillReturnRows(sqlmock.NewRows(operatorColumns()).
			AddRow(adminID, "PLATUSER001", "platform@example.com", "Platform User", "platform_super_admin", "active", now))
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	_, err := client.DeactivateOperator(context.Background(), newAuthedRequest(publirasplatformv1.DeactivateOperatorRequest{PublicId: "PLATUSER001"}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeactivateOperator code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestDeactivateOperatorAlreadyInactiveRejected(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	adminID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(getPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER006").
		WillReturnRows(sqlmock.NewRows(operatorColumns()).
			AddRow(targetID, "PLATUSER006", "operator6@example.com", "Operator Six", "platform_operator", "inactive", now))
	mock.ExpectRollback()

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	_, err := client.DeactivateOperator(context.Background(), newAuthedRequest(publirasplatformv1.DeactivateOperatorRequest{PublicId: "PLATUSER006"}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeactivateOperator code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func TestPlatformAuthCreateSessionSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	password := "secret-password"
	passwordHashBytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("GenerateFromPassword: %v", err)
	}

	mock.ExpectQuery(regexp.QuoteMeta(getUserByEmailQuery)).
		WithArgs("platform@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status"}).
			AddRow(userID, "PLATUSER001", "platform@example.com", string(passwordHashBytes), "Platform User", now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(listPlatformUserRolesQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(testPlatformRole))

	mock.ExpectQuery("INSERT INTO sessions").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), userID, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "current_tenant_id", "user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), nil, userID, "token-hash", now.Add(time.Hour), nil, now))

	client := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)
	resp, err := client.CreateSession(context.Background(), newRequest(publirasplatformv1.PlatformAuthServiceCreateSessionRequest{
		Email:    "platform@example.com",
		Password: password,
	}))
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if resp.Msg.User == nil || resp.Msg.User.Role != testPlatformRole {
		t.Fatalf("user.role = %v, want %s", resp.Msg.User, testPlatformRole)
	}
	if resp.Msg.Session == nil || resp.Msg.Session.SessionId == "" {
		t.Fatalf("session is missing token")
	}
	if got := resp.Header().Get("Set-Cookie"); got == "" {
		t.Fatalf("Set-Cookie is empty")
	}
	assertExpectations(t, mock)
}

func TestPlatformAuthGetMeSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	client := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)
	req := newRequest(publirasplatformv1.PlatformAuthServiceGetMeRequest{})
	req.Header().Set("X-Publira-Session-Id", testSessionToken)
	resp, err := client.GetMe(context.Background(), req)
	if err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	if resp.Msg.User == nil || resp.Msg.User.Role != testPlatformRole {
		t.Fatalf("user.role = %v, want %s", resp.Msg.User, testPlatformRole)
	}
	assertExpectations(t, mock)
}

func TestPlatformAuthDeleteSessionRevokes(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	sessionID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getSessionByTokenHash)).
		WithArgs(auth.HashToken(testSessionToken)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "current_tenant_id", "user_id", "token_hash", "expires_at", "revoked_at", "created_at"}).
			AddRow(sessionID, tenantID, userID, auth.HashToken(testSessionToken), now.Add(time.Hour), nil, now))

	mock.ExpectExec("UPDATE sessions").
		WithArgs(sessionID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	client := publirasplatformv1connect.NewPlatformAuthServiceClient(ts.Client(), ts.URL)
	req := newRequest(publirasplatformv1.PlatformAuthServiceDeleteSessionRequest{})
	req.Header().Set("X-Publira-Session-Id", testSessionToken)
	resp, err := client.DeleteSession(context.Background(), req)
	if err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	if got := resp.Header().Get("Set-Cookie"); got == "" {
		t.Fatalf("Set-Cookie is empty")
	}
	assertExpectations(t, mock)
}

// TestCheckSetupStatusNotCompleted はユーザーが存在しない場合 setup_completed = false を返すことを検証する。
func TestCheckSetupStatusNotCompleted(t *testing.T) {
	ts, mock := newTestPlatformServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(countPlatformUsersQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(0)))

	client := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)
	resp, err := client.CheckSetupStatus(context.Background(), newRequest(publirasplatformv1.CheckSetupStatusRequest{}))
	if err != nil {
		t.Fatalf("CheckSetupStatus: %v", err)
	}
	if resp.Msg.SetupCompleted {
		t.Fatalf("setup_completed = true, want false")
	}
	assertExpectations(t, mock)
}

// TestCheckSetupStatusCompleted はユーザーが存在する場合 setup_completed = true を返すことを検証する。
func TestCheckSetupStatusCompleted(t *testing.T) {
	ts, mock := newTestPlatformServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(countPlatformUsersQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(1)))

	client := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)
	resp, err := client.CheckSetupStatus(context.Background(), newRequest(publirasplatformv1.CheckSetupStatusRequest{}))
	if err != nil {
		t.Fatalf("CheckSetupStatus: %v", err)
	}
	if !resp.Msg.SetupCompleted {
		t.Fatalf("setup_completed = false, want true")
	}
	assertExpectations(t, mock)
}

// TestCreateInitialUserSuccess は初期ユーザー作成の正常系を検証する。
func TestCreateInitialUserSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())

	// Fast-path: ユーザーは存在しない
	mock.ExpectQuery(regexp.QuoteMeta(countPlatformUsersQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(0)))

	// トランザクション開始
	mock.ExpectBegin()

	// ユーザー作成
	mock.ExpectQuery(regexp.QuoteMeta(createUserQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "admin@example.com", sqlmock.AnyArg(), "Admin User").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status"}).
			AddRow(userID, "ADMINUSER01", "admin@example.com", "hash", "Admin User", now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(createPlatformUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "platform_super_admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role", "created_at"}).
			AddRow(uuid.Must(uuid.NewV7()), userID, "platform_super_admin", now))

	// トランザクションコミット
	mock.ExpectCommit()

	client := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateInitialUser(context.Background(), newRequest(publirasplatformv1.CreateInitialUserRequest{
		Name:     "Admin User",
		Email:    "admin@example.com",
		Password: "secure-password-123",
	}))
	if err != nil {
		t.Fatalf("CreateInitialUser: %v", err)
	}
	assertExpectations(t, mock)
}

// TestCreateInitialUserAlreadySetup はユーザーが既に存在する場合 AlreadyExists を返すことを検証する。
func TestCreateInitialUserAlreadySetup(t *testing.T) {
	ts, mock := newTestPlatformServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(countPlatformUsersQuery)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(1)))

	client := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateInitialUser(context.Background(), newRequest(publirasplatformv1.CreateInitialUserRequest{
		Name:     "Admin User",
		Email:    "admin@example.com",
		Password: "secure-password-123",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateInitialUser code = %v, want already_exists", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestCreateInitialUserInvalidInput は必須フィールドが空の場合 InvalidArgument を返すことを検証する。
func TestCreateInitialUserInvalidInput(t *testing.T) {
	ts, _ := newTestPlatformServer(t)
	client := publirasplatformv1connect.NewPlatformSetupServiceClient(ts.Client(), ts.URL)

	cases := []struct {
		name string
		req  func() publirasplatformv1.CreateInitialUserRequest
	}{
		{"empty_name", func() publirasplatformv1.CreateInitialUserRequest {
			return publirasplatformv1.CreateInitialUserRequest{Name: "", Email: "a@b.com", Password: "pass"}
		}},
		{"empty_email", func() publirasplatformv1.CreateInitialUserRequest {
			return publirasplatformv1.CreateInitialUserRequest{Name: "Name", Email: "", Password: "pass"}
		}},
		{"empty_password", func() publirasplatformv1.CreateInitialUserRequest {
			return publirasplatformv1.CreateInitialUserRequest{Name: "Name", Email: "a@b.com", Password: ""}
		}},
		{"invalid_email", func() publirasplatformv1.CreateInitialUserRequest {
			return publirasplatformv1.CreateInitialUserRequest{Name: "Name", Email: "not-an-email", Password: "pass"}
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := client.CreateInitialUser(context.Background(), newRequest(tc.req()))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("CreateInitialUser code = %v, want invalid_argument", connect.CodeOf(err))
			}
		})
	}
}

func endUserColumns() []string {
	return []string{"id", "public_id", "name", "email", "status", "created_at"}
}

// TestListEndUsers はエンドユーザー一覧が取得できることを検証する。
func TestListEndUsers(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(listEndUsersQuery)).
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(getTenantsByEndUserQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}))

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListEndUsers(context.Background(), newAuthedRequest(publirasplatformv1.ListEndUsersRequest{}))
	if err != nil {
		t.Fatalf("ListEndUsers: %v", err)
	}
	if len(resp.Msg.Users) != 1 {
		t.Fatalf("len(users) = %d, want 1", len(resp.Msg.Users))
	}
	if resp.Msg.Users[0].PublicId != "EUSER00001" {
		t.Fatalf("public_id = %v, want EUSER00001", resp.Msg.Users[0].PublicId)
	}
	assertExpectations(t, mock)
}

// TestListEndUsersUnauthenticated は未認証の場合 Unauthenticated を返すことを検証する。
func TestListEndUsersUnauthenticated(t *testing.T) {
	ts, mock := newTestPlatformServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(getSessionByTokenHash)).
		WithArgs(auth.HashToken(testSessionToken)).
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	_, err := client.ListEndUsers(context.Background(), newAuthedRequest(publirasplatformv1.ListEndUsersRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListEndUsers code = %v, want unauthenticated", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestGetEndUser はエンドユーザー詳細が取得できることを検証する。
func TestGetEndUser(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("EUSER00001").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(getTenantsByEndUserQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}))

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetEndUser(context.Background(), newAuthedRequest(publirasplatformv1.GetEndUserRequest{PublicId: "EUSER00001"}))
	if err != nil {
		t.Fatalf("GetEndUser: %v", err)
	}
	if resp.Msg.User.PublicId != "EUSER00001" {
		t.Fatalf("public_id = %v, want EUSER00001", resp.Msg.User.PublicId)
	}
	assertExpectations(t, mock)
}

// TestGetEndUserNotFound は存在しないユーザーの場合 NotFound を返すことを検証する。
func TestGetEndUserNotFound(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())

	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("NOTEXIST01").
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	_, err := client.GetEndUser(context.Background(), newAuthedRequest(publirasplatformv1.GetEndUserRequest{PublicId: "NOTEXIST01"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetEndUser code = %v, want not_found", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestSuspendEndUser はエンドユーザーを停止しセッションが失効することを検証する。
func TestSuspendEndUser(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	// 対象ユーザーを取得
	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("EUSER00001").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "active", now))

	// ロール確認（エンドユーザーはロールなし）
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	// テナントメンバーシップ確認（件数0）
	mock.ExpectQuery(regexp.QuoteMeta(countTenantMembershipsByUserIDQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	// ステータスを suspended に更新
	mock.ExpectQuery(regexp.QuoteMeta(updateUserStatusQuery)).
		WithArgs("EUSER00001", "suspended").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status"}).
			AddRow(endUserID, "EUSER00001", "enduser@example.com", "hash", "End User", now, "suspended"))

	// セッション失効
	mock.ExpectExec(regexp.QuoteMeta(terminateUserSessionsQuery)).
		WithArgs(endUserID).
		WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(regexp.QuoteMeta(getTenantsByEndUserQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}))

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	resp, err := client.SuspendEndUser(context.Background(), newAuthedRequest(publirasplatformv1.SuspendEndUserRequest{PublicId: "EUSER00001"}))
	if err != nil {
		t.Fatalf("SuspendEndUser: %v", err)
	}
	if resp.Msg.User.Status != "suspended" {
		t.Fatalf("status = %v, want suspended", resp.Msg.User.Status)
	}
	assertExpectations(t, mock)
}

// TestSuspendEndUserWithPlatformRole はプラットフォームロール保持ユーザーの停止が拒否されることを検証する。
func TestSuspendEndUserWithPlatformRole(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("PLATUSER002").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(endUserID, "PLATUSER002", "Platform User 2", "platform2@example.com", "active", now))

	// ロール確認（このユーザーはplatformロールを持っている）
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("platform_operator"))

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	_, err := client.SuspendEndUser(context.Background(), newAuthedRequest(publirasplatformv1.SuspendEndUserRequest{PublicId: "PLATUSER002"}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("SuspendEndUser code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestUnsuspendEndUser は停止解除が正常に動作することを検証する。
func TestUnsuspendEndUser(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("EUSER00001").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "suspended", now))

	// ロール確認（エンドユーザーはロールなし）
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	// テナントメンバーシップ確認（件数0）
	mock.ExpectQuery(regexp.QuoteMeta(countTenantMembershipsByUserIDQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	mock.ExpectQuery(regexp.QuoteMeta(updateUserStatusQuery)).
		WithArgs("EUSER00001", "active").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status"}).
			AddRow(endUserID, "EUSER00001", "enduser@example.com", "hash", "End User", now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(getTenantsByEndUserQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id"}))

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	resp, err := client.UnsuspendEndUser(context.Background(), newAuthedRequest(publirasplatformv1.UnsuspendEndUserRequest{PublicId: "EUSER00001"}))
	if err != nil {
		t.Fatalf("UnsuspendEndUser: %v", err)
	}
	if resp.Msg.User.Status != "active" {
		t.Fatalf("status = %v, want active", resp.Msg.User.Status)
	}
	assertExpectations(t, mock)
}

// TestDeleteEndUser はエンドユーザーの物理削除が正常に動作することを検証する。
func TestDeleteEndUser(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("EUSER00001").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "active", now))

	// ロール確認（エンドユーザーはロールなし）
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	// テナントメンバーシップ確認（件数0）
	mock.ExpectQuery(regexp.QuoteMeta(countTenantMembershipsByUserIDQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	mock.ExpectExec(regexp.QuoteMeta(deleteUserByIDQuery)).
		WithArgs(endUserID).
		WillReturnResult(sqlmock.NewResult(1, 1))

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	resp, err := client.DeleteEndUser(context.Background(), newAuthedRequest(publirasplatformv1.DeleteEndUserRequest{PublicId: "EUSER00001"}))
	if err != nil {
		t.Fatalf("DeleteEndUser: %v", err)
	}
	if resp.Msg.PublicId != "EUSER00001" {
		t.Fatalf("public_id = %v, want EUSER00001", resp.Msg.PublicId)
	}
	assertExpectations(t, mock)
}

// TestDeleteEndUserWithPlatformRole はプラットフォームロール保持ユーザーの削除が拒否されることを検証する。
func TestDeleteEndUserWithPlatformRole(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("PLATUSER002").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(endUserID, "PLATUSER002", "Platform User 2", "platform2@example.com", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(listPlatformUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("platform_operator"))

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	_, err := client.DeleteEndUser(context.Background(), newAuthedRequest(publirasplatformv1.DeleteEndUserRequest{PublicId: "PLATUSER002"}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeleteEndUser code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestUnsuspendEndUserWithTenantMembership はテナントメンバー保持ユーザーの停止解除が拒否されることを検証する。
func TestUnsuspendEndUserWithTenantMembership(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectPlatformGuard(mock, tenantID, userID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("TENANTUSER01").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(endUserID, "TENANTUSER01", "Tenant User", "tenantuser@example.com", "suspended", now))

	mock.ExpectQuery(regexp.QuoteMeta(listPlatformUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	mock.ExpectQuery(regexp.QuoteMeta(countTenantMembershipsByUserIDQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	client := publirasplatformv1connect.NewPlatformUserServiceClient(ts.Client(), ts.URL)
	_, err := client.UnsuspendEndUser(context.Background(), newAuthedRequest(publirasplatformv1.UnsuspendEndUserRequest{PublicId: "TENANTUSER01"}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UnsuspendEndUser code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

func tenantMemberColumns() []string {
	return []string{"user_id", "public_id", "name", "email", "role", "status", "created_at"}
}

// TestListTenantMembersSuccess はテナントメンバー一覧の正常系を検証する。
func TestListTenantMembersSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	tenantID := uuid.Must(uuid.NewV7())
	member1ID := uuid.Must(uuid.NewV7())
	member2ID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(listTenantMembershipsQuery)).
		WithArgs(tenantID, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(tenantMemberColumns()).
			AddRow(member1ID, "USER000001", "Alice", "alice@example.com", "tenant_admin", "active", now).
			AddRow(member2ID, "USER000002", "Bob", "bob@example.com", "tenant_editor", "active", now))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenantMembers(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantMembersRequest{TenantPublicId: "TENANT001"}))
	if err != nil {
		t.Fatalf("ListTenantMembers: %v", err)
	}
	if len(resp.Msg.Members) != 2 {
		t.Fatalf("member count = %d, want 2", len(resp.Msg.Members))
	}
	if resp.Msg.Members[0].UserPublicId != "USER000001" {
		t.Fatalf("members[0].user_public_id = %q, want USER000001", resp.Msg.Members[0].UserPublicId)
	}
	if resp.Msg.Members[0].Role != "tenant_admin" {
		t.Fatalf("members[0].role = %q, want tenant_admin", resp.Msg.Members[0].Role)
	}
	assertExpectations(t, mock)
}

// TestListTenantMembersEmptyList はメンバーが存在しない場合に空リストを返すことを検証する。
func TestListTenantMembersEmptyList(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	tenantID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(listTenantMembershipsQuery)).
		WithArgs(tenantID, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(tenantMemberColumns()))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenantMembers(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantMembersRequest{TenantPublicId: "TENANT001"}))
	if err != nil {
		t.Fatalf("ListTenantMembers: %v", err)
	}
	if len(resp.Msg.Members) != 0 {
		t.Fatalf("member count = %d, want 0", len(resp.Msg.Members))
	}
	assertExpectations(t, mock)
}

// TestListTenantMembersTenantNotFound は存在しないテナントの場合 NotFound を返すことを検証する。
func TestListTenantMembersTenantNotFound(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("NOTFOUND").
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.ListTenantMembers(context.Background(), newAuthedRequest(publirasplatformv1.ListTenantMembersRequest{TenantPublicId: "NOTFOUND"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ListTenantMembers code = %v, want not_found", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestAddTenantMemberSuccess はテナントメンバー追加の正常系を検証する。
func TestAddTenantMemberSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())
	membershipID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("USER000001").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(getTenantMembershipByUserAndTenantQuery)).
		WithArgs(targetUserID, tenantID).
		WillReturnError(sql.ErrNoRows)

	mock.ExpectBegin()

	mock.ExpectQuery(regexp.QuoteMeta(createTenantMembershipQuery)).
		WithArgs(sqlmock.AnyArg(), targetUserID, tenantID, "active").
		WillReturnRows(sqlmock.NewRows(tenantMembershipColumns()).
			AddRow(membershipID, targetUserID, tenantID, "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(createTenantMemberRoleQuery)).
		WithArgs(sqlmock.AnyArg(), membershipID, "tenant_admin").
		WillReturnRows(sqlmock.NewRows(tenantMemberRoleColumns()).
			AddRow(uuid.Must(uuid.NewV7()), membershipID, "tenant_admin", now))

	mock.ExpectCommit()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.AddTenantMember(context.Background(), newAuthedRequest(publirasplatformv1.AddTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
		Role:           "tenant_admin",
	}))
	if err != nil {
		t.Fatalf("AddTenantMember: %v", err)
	}
	if resp.Msg.Member.UserPublicId != "USER000001" {
		t.Fatalf("member.user_public_id = %q, want USER000001", resp.Msg.Member.UserPublicId)
	}
	if resp.Msg.Member.Role != "tenant_admin" {
		t.Fatalf("member.role = %q, want tenant_admin", resp.Msg.Member.Role)
	}
	assertExpectations(t, mock)
}

// TestAddTenantMemberTenantNotFound は存在しないテナントの場合 NotFound を返すことを検証する。
func TestAddTenantMemberTenantNotFound(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("NOTFOUND").
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.AddTenantMember(context.Background(), newAuthedRequest(publirasplatformv1.AddTenantMemberRequest{
		TenantPublicId: "NOTFOUND",
		UserPublicId:   "USER000001",
		Role:           "tenant_admin",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("AddTenantMember code = %v, want not_found", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestAddTenantMemberUserNotFound は存在しないユーザーの場合 NotFound を返すことを検証する。
func TestAddTenantMemberUserNotFound(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	tenantID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("NOTFOUND").
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.AddTenantMember(context.Background(), newAuthedRequest(publirasplatformv1.AddTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "NOTFOUND",
		Role:           "tenant_admin",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("AddTenantMember code = %v, want not_found", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestAddTenantMemberAlreadyExists は既にメンバーのユーザーを追加した場合 AlreadyExists を返すことを検証する。
func TestAddTenantMemberAlreadyExists(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())
	existingMembershipID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("USER000001").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(getTenantMembershipByUserAndTenantQuery)).
		WithArgs(targetUserID, tenantID).
		WillReturnRows(sqlmock.NewRows(tenantMembershipColumns()).
			AddRow(existingMembershipID, targetUserID, tenantID, "active", now))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.AddTenantMember(context.Background(), newAuthedRequest(publirasplatformv1.AddTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
		Role:           "tenant_admin",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("AddTenantMember code = %v, want already_exists", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestUpdateTenantMemberRoleSuccess はロール変更の正常系を検証する。
func TestUpdateTenantMemberRoleSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())
	membershipID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("USER000001").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(getTenantMembershipByUserAndTenantQuery)).
		WithArgs(targetUserID, tenantID).
		WillReturnRows(sqlmock.NewRows(tenantMembershipColumns()).
			AddRow(membershipID, targetUserID, tenantID, "active", now))

	mock.ExpectBegin()

	mock.ExpectExec(regexp.QuoteMeta(deleteTenantMemberRolesByMembershipIDQuery)).
		WithArgs(membershipID).
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectQuery(regexp.QuoteMeta(createTenantMemberRoleQuery)).
		WithArgs(sqlmock.AnyArg(), membershipID, "tenant_editor").
		WillReturnRows(sqlmock.NewRows(tenantMemberRoleColumns()).
			AddRow(uuid.Must(uuid.NewV7()), membershipID, "tenant_editor", now))

	mock.ExpectCommit()

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.UpdateTenantMemberRole(context.Background(), newAuthedRequest(publirasplatformv1.UpdateTenantMemberRoleRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
		Role:           "tenant_editor",
	}))
	if err != nil {
		t.Fatalf("UpdateTenantMemberRole: %v", err)
	}
	if resp.Msg.Member.Role != "tenant_editor" {
		t.Fatalf("member.role = %q, want tenant_editor", resp.Msg.Member.Role)
	}
	assertExpectations(t, mock)
}

// TestUpdateTenantMemberRoleMemberNotFound は存在しないメンバーの場合 NotFound を返すことを検証する。
func TestUpdateTenantMemberRoleMemberNotFound(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("USER000001").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(getTenantMembershipByUserAndTenantQuery)).
		WithArgs(targetUserID, tenantID).
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.UpdateTenantMemberRole(context.Background(), newAuthedRequest(publirasplatformv1.UpdateTenantMemberRoleRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
		Role:           "tenant_editor",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateTenantMemberRole code = %v, want not_found", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestRemoveTenantMemberSuccess はテナントメンバー削除の正常系を検証する。
func TestRemoveTenantMemberSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())
	membershipID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("USER000001").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(getTenantMembershipByUserAndTenantQuery)).
		WithArgs(targetUserID, tenantID).
		WillReturnRows(sqlmock.NewRows(tenantMembershipColumns()).
			AddRow(membershipID, targetUserID, tenantID, "active", now))

	mock.ExpectExec(regexp.QuoteMeta(deleteTenantMembershipQuery)).
		WithArgs(membershipID).
		WillReturnResult(sqlmock.NewResult(1, 1))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.RemoveTenantMember(context.Background(), newAuthedRequest(publirasplatformv1.RemoveTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
	}))
	if err != nil {
		t.Fatalf("RemoveTenantMember: %v", err)
	}
	if resp.Msg.UserPublicId != "USER000001" {
		t.Fatalf("user_public_id = %q, want USER000001", resp.Msg.UserPublicId)
	}
	assertExpectations(t, mock)
}

// TestRemoveTenantMemberNotFound は存在しないメンバーの場合 NotFound を返すことを検証する。
func TestRemoveTenantMemberNotFound(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	sessionTenantID := uuid.Must(uuid.NewV7())
	sessionUserID := uuid.Must(uuid.NewV7())
	expectPlatformGuard(mock, sessionTenantID, sessionUserID, testPlatformRole, now)

	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(tenantID, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByPublicIDQuery)).
		WithArgs("USER000001").
		WillReturnRows(sqlmock.NewRows(endUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", now))

	mock.ExpectQuery(regexp.QuoteMeta(getTenantMembershipByUserAndTenantQuery)).
		WithArgs(targetUserID, tenantID).
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.RemoveTenantMember(context.Background(), newAuthedRequest(publirasplatformv1.RemoveTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("RemoveTenantMember code = %v, want not_found", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}
