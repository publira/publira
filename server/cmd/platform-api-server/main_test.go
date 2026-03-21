package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/platformapi"
	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
	dbmodels "github.com/publira/publira/server/internal/db"
)

const (
	getTenantByPublicIDQuery = "-- name: GetTenantByPublicID :one\nSELECT id, public_id, domain, subdomain, name, default_reading_period_hours, created_at, status\nFROM tenants\nWHERE public_id = $1\nLIMIT 1\n"
	listTenantsQuery         = "-- name: ListTenants :many\nSELECT id, public_id, domain, subdomain, name, default_reading_period_hours, created_at, status\nFROM tenants\nORDER BY created_at DESC\nLIMIT $1 OFFSET $2\n"
	createTenantQuery        = "-- name: CreateTenant :one\nINSERT INTO tenants (id, public_id, name, status)\nVALUES ($1, $2, $3, 'active')\nRETURNING id, public_id, domain, subdomain, name, default_reading_period_hours, created_at, status\n"
	updateTenantStatusQuery  = "-- name: UpdateTenantStatus :one\nUPDATE tenants\nSET status = $2\nWHERE public_id = $1\nRETURNING id, public_id, domain, subdomain, name, default_reading_period_hours, created_at, status\n"
)

func tenantColumns() []string {
	return []string{"id", "public_id", "domain", "subdomain", "name", "default_reading_period_hours", "created_at", "status"}
}

func newTestPlatformServer(t *testing.T) (*httptest.Server, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	server := httptest.NewServer(platformapi.NewHandler(dbmodels.New(db)))
	t.Cleanup(server.Close)
	return server, mock
}

func newRequest[T any](msg T) *connect.Request[T] {
	return connect.NewRequest(&msg)
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
	ts := httptest.NewServer(platformapi.NewHandler(nil))
	t.Cleanup(ts.Close)

	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformTenantService/ListTenants", false)
	assertRouteStatus(t, ts, "/publira.platform.v1.PlatformTenantService/CreateTenant", false)
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

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs(int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenants(context.Background(), newRequest(publirasplatformv1.ListTenantsRequest{}))
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
	id1 := uuid.Must(uuid.NewV7())
	id2 := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs(int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id1, "TENANT001", nil, nil, "Tenant One", nil, now, "active").
			AddRow(id2, "TENANT002", nil, nil, "Tenant Two", nil, now, "suspended"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListTenants(context.Background(), newRequest(publirasplatformv1.ListTenantsRequest{}))
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

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs(int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.ListTenants(context.Background(), newRequest(publirasplatformv1.ListTenantsRequest{Limit: 0}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	assertExpectations(t, mock)
}

// TestListTenantsClampMaxLimit は limit が 100 以上の場合 100 に丸められることを検証する。
func TestListTenantsClampMaxLimit(t *testing.T) {
	ts, mock := newTestPlatformServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantsQuery)).
		WithArgs(int32(100), int32(0)).
		WillReturnRows(sqlmock.NewRows(tenantColumns()))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.ListTenants(context.Background(), newRequest(publirasplatformv1.ListTenantsRequest{Limit: 200}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	assertExpectations(t, mock)
}

// TestGetTenantSuccess はテナント詳細取得の正常系を検証する。
func TestGetTenantSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id, "TENANT001", nil, nil, "Test Tenant", nil, now, "active"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetTenant(context.Background(), newRequest(publirasplatformv1.GetTenantRequest{PublicId: "TENANT001"}))
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

	mock.ExpectQuery(regexp.QuoteMeta(getTenantByPublicIDQuery)).
		WithArgs("NOTFOUND").
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.GetTenant(context.Background(), newRequest(publirasplatformv1.GetTenantRequest{PublicId: "NOTFOUND"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetTenant code = %v, want not_found", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestGetTenantRequiresPublicID は public_id が空の場合 InvalidArgument を返すことを検証する。
func TestGetTenantRequiresPublicID(t *testing.T) {
	ts, _ := newTestPlatformServer(t)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.GetTenant(context.Background(), newRequest(publirasplatformv1.GetTenantRequest{PublicId: "   "}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("GetTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
}

// TestCreateTenantSuccess はテナント作成の正常系を検証する。
func TestCreateTenantSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(createTenantQuery)).
		WithArgs(sqlmock.AnyArg(), "NEW001", "New Tenant").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id, "NEW001", nil, nil, "New Tenant", nil, now, "active"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.CreateTenant(context.Background(), newRequest(publirasplatformv1.CreateTenantRequest{
		PublicId: "NEW001",
		Name:     "New Tenant",
	}))
	if err != nil {
		t.Fatalf("CreateTenant: %v", err)
	}
	if resp.Msg.Tenant.PublicId != "NEW001" {
		t.Fatalf("tenant.public_id = %q, want NEW001", resp.Msg.Tenant.PublicId)
	}
	if resp.Msg.Tenant.Status != "active" {
		t.Fatalf("tenant.status = %q, want active", resp.Msg.Tenant.Status)
	}
	assertExpectations(t, mock)
}

// TestCreateTenantRequiresPublicID は public_id が空の場合 InvalidArgument を返すことを検証する。
func TestCreateTenantRequiresPublicID(t *testing.T) {
	ts, _ := newTestPlatformServer(t)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newRequest(publirasplatformv1.CreateTenantRequest{
		PublicId: "",
		Name:     "Valid Name",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
}

// TestCreateTenantRequiresName は name が空の場合 InvalidArgument を返すことを検証する。
func TestCreateTenantRequiresName(t *testing.T) {
	ts, _ := newTestPlatformServer(t)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newRequest(publirasplatformv1.CreateTenantRequest{
		PublicId: "VALID01",
		Name:     "   ",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateTenant code = %v, want invalid_argument", connect.CodeOf(err))
	}
}

// TestCreateTenantDuplicateReturnsAlreadyExists は public_id が重複する場合 AlreadyExists を返すことを検証する。
func TestCreateTenantDuplicateReturnsAlreadyExists(t *testing.T) {
	ts, mock := newTestPlatformServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(createTenantQuery)).
		WithArgs(sqlmock.AnyArg(), "DUP001", "Duplicate Tenant").
		WillReturnError(fmt.Errorf("pq: duplicate key value violates unique constraint %q (SQLSTATE 23505)", "tenants_public_id_key"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.CreateTenant(context.Background(), newRequest(publirasplatformv1.CreateTenantRequest{
		PublicId: "DUP001",
		Name:     "Duplicate Tenant",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateTenant code = %v, want already_exists", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestSuspendTenantSuccess はテナント停止の正常系を検証する。
func TestSuspendTenantSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(updateTenantStatusQuery)).
		WithArgs("ACTIVE01", "suspended").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id, "ACTIVE01", nil, nil, "Active Tenant", nil, now, "suspended"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.SuspendTenant(context.Background(), newRequest(publirasplatformv1.SuspendTenantRequest{PublicId: "ACTIVE01"}))
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

	mock.ExpectQuery(regexp.QuoteMeta(updateTenantStatusQuery)).
		WithArgs("NOTFOUND", "suspended").
		WillReturnError(sql.ErrNoRows)

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	_, err := client.SuspendTenant(context.Background(), newRequest(publirasplatformv1.SuspendTenantRequest{PublicId: "NOTFOUND"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("SuspendTenant code = %v, want not_found", connect.CodeOf(err))
	}
	assertExpectations(t, mock)
}

// TestResumeTenantSuccess はテナント再開の正常系を検証する。
func TestResumeTenantSuccess(t *testing.T) {
	ts, mock := newTestPlatformServer(t)
	now := time.Now()
	id := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(updateTenantStatusQuery)).
		WithArgs("SUSP001", "active").
		WillReturnRows(sqlmock.NewRows(tenantColumns()).
			AddRow(id, "SUSP001", nil, nil, "Suspended Tenant", nil, now, "active"))

	client := publirasplatformv1connect.NewPlatformTenantServiceClient(ts.Client(), ts.URL)
	resp, err := client.ResumeTenant(context.Background(), newRequest(publirasplatformv1.ResumeTenantRequest{PublicId: "SUSP001"}))
	if err != nil {
		t.Fatalf("ResumeTenant: %v", err)
	}
	if resp.Msg.Tenant.Status != "active" {
		t.Fatalf("tenant.status = %q, want active", resp.Msg.Tenant.Status)
	}
	assertExpectations(t, mock)
}
