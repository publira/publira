package platformapi

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
)

func tenantTestColumns() []string {
	return []string{"id", "public_id", "domain", "name", "default_reading_period_hours", "created_at", "status", "admin_domain"}
}

func tenantScopedUserColumns() []string {
	return []string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}
}

func tenantMemberColumns() []string {
	return []string{"user_id", "public_id", "name", "email", "role", "status", "created_at"}
}

func TestListTenantMembersSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	member1ID := uuid.Must(uuid.NewV7())
	member2ID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUsersQuery)).
		WithArgs(tenantID, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(tenantMemberColumns()).
			AddRow(member1ID, "USER000001", "Alice", "alice@example.com", "tenant_admin", "active", now).
			AddRow(member2ID, "USER000002", "Bob", "bob@example.com", "tenant_editor", "active", now))

	resp, err := server.ListTenantMembers(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantMembersRequest{TenantPublicId: "TENANT001"}))
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
	assertOperatorHandlerExpectations(t, mock)
}

// TestListTenantMembersEmptyList はメンバーが存在しない場合に空リストを返すことを検証する。
func TestListTenantMembersEmptyList(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUsersQuery)).
		WithArgs(tenantID, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows(tenantMemberColumns()))

	resp, err := server.ListTenantMembers(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantMembersRequest{TenantPublicId: "TENANT001"}))
	if err != nil {
		t.Fatalf("ListTenantMembers: %v", err)
	}
	if len(resp.Msg.Members) != 0 {
		t.Fatalf("member count = %d, want 0", len(resp.Msg.Members))
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestListTenantMembersTenantNotFound は存在しないテナントの場合 NotFound を返すことを検証する。
func TestListTenantMembersTenantNotFound(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("NOTFOUND").
		WillReturnError(sql.ErrNoRows)

	_, err := server.ListTenantMembers(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantMembersRequest{TenantPublicId: "NOTFOUND"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ListTenantMembers code = %v, want not_found", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestAddTenantMemberSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDForTenantQuery)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testCreateTenantUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), targetUserID, "tenant_admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), targetUserID, "tenant_admin", now, tenantID))
	mock.ExpectCommit()

	resp, err := server.AddTenantMember(context.Background(), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
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
	assertOperatorHandlerExpectations(t, mock)
}

func TestAddTenantMemberByEmailSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByEmailForTenantQuery)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "alice@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at"}).
			AddRow(targetUserID, "USER000001", "alice@example.com", "hashed", "Alice", now, "active", tenantID, nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testCreateTenantUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), targetUserID, "tenant_admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), targetUserID, "tenant_admin", now, tenantID))
	mock.ExpectCommit()

	resp, err := server.AddTenantMember(context.Background(), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
		TenantPublicId: "TENANT001",
		Email:          "alice@example.com",
		Role:           "tenant_admin",
	}))
	if err != nil {
		t.Fatalf("AddTenantMember by email: %v", err)
	}
	if resp.Msg.Member.UserPublicId != "USER000001" {
		t.Fatalf("member.user_public_id = %q, want USER000001", resp.Msg.Member.UserPublicId)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestAddTenantMemberRequiresPublicIDOrEmail(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	_, err := server.AddTenantMember(context.Background(), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
		TenantPublicId: "TENANT001",
		Role:           "tenant_admin",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("AddTenantMember code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestAddTenantMemberTenantNotFound(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnError(sql.ErrNoRows)

	_, err := server.AddTenantMember(context.Background(), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
		Role:           "tenant_admin",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("AddTenantMember code = %v, want not_found", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestAddTenantMemberUserNotFound(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDForTenantQuery)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "NOTFOUND").
		WillReturnError(sql.ErrNoRows)

	_, err := server.AddTenantMember(context.Background(), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "NOTFOUND",
		Role:           "tenant_admin",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("AddTenantMember code = %v, want not_found", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestAddTenantMemberAlreadyExists(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDForTenantQuery)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_admin"))

	_, err := server.AddTenantMember(context.Background(), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
		Role:           "tenant_admin",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("AddTenantMember code = %v, want already_exists", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdateTenantMemberRoleSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDForTenantQuery)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_admin"))

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(testDeleteTenantUserRolesByUserIDQuery)).
		WithArgs(targetUserID).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testCreateTenantUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), targetUserID, "tenant_editor").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), targetUserID, "tenant_editor", now, tenantID))
	mock.ExpectCommit()

	resp, err := server.UpdateTenantMemberRole(context.Background(), connect.NewRequest(&publirasplatformv1.UpdateTenantMemberRoleRequest{
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
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdateTenantMemberRoleMemberNotFound(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDForTenantQuery)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	_, err := server.UpdateTenantMemberRole(context.Background(), connect.NewRequest(&publirasplatformv1.UpdateTenantMemberRoleRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
		Role:           "tenant_editor",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateTenantMemberRole code = %v, want not_found", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestRemoveTenantMemberSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDForTenantQuery)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectExec(regexp.QuoteMeta(testDeleteTenantUserRolesByUserIDQuery)).
		WithArgs(targetUserID).
		WillReturnResult(sqlmock.NewResult(1, 1))

	resp, err := server.RemoveTenantMember(context.Background(), connect.NewRequest(&publirasplatformv1.RemoveTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
	}))
	if err != nil {
		t.Fatalf("RemoveTenantMember: %v", err)
	}
	if resp.Msg.UserPublicId != "USER000001" {
		t.Fatalf("user_public_id = %q, want USER000001", resp.Msg.UserPublicId)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestRemoveTenantMemberNotFound(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDForTenantQuery)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnError(sql.ErrNoRows)

	_, err := server.RemoveTenantMember(context.Background(), connect.NewRequest(&publirasplatformv1.RemoveTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("RemoveTenantMember code = %v, want not_found", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}
