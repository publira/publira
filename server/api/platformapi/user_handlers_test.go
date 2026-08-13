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

// GetUserByPublicID の RETURNING カラム（id, public_id, name, email, status, tenant_id, created_at）
func endUserGetByPublicIDColumns() []string {
	return []string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}
}

// ListEndUsers の結果カラム（所属テナントは JOIN で同梱）
func listEndUsersResultColumns() []string {
	return []string{"id", "public_id", "name", "email", "status", "created_at", "tenant_public_id", "tenant_name"}
}

func getTenantByUserIDColumns() []string {
	return []string{"id", "public_id", "name", "created_at"}
}

// UpdateUserStatus の RETURNING カラム
func updateUserStatusResultColumns() []string {
	return []string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at", "credentials_version"}
}

// TestListEndUsers はエンドユーザー一覧の正常系を検証する。
func TestListEndUsers(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	mock.ExpectQuery(regexp.QuoteMeta(testListEndUsersQuery)).
		WillReturnRows(sqlmock.NewRows(listEndUsersResultColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "active", now, "TENANT000001", "Readers"))

	resp, err := server.ListEndUsers(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListEndUsersRequest{}))
	if err != nil {
		t.Fatalf("ListEndUsers: %v", err)
	}
	if len(resp.Msg.Users) != 1 {
		t.Fatalf("len(users) = %d, want 1", len(resp.Msg.Users))
	}
	if resp.Msg.Users[0].PublicId != "EUSER00001" {
		t.Fatalf("public_id = %v, want EUSER00001", resp.Msg.Users[0].PublicId)
	}
	if got := resp.Msg.Users[0].TenantIds; len(got) != 1 || got[0] != "TENANT000001" {
		t.Fatalf("tenant_ids = %v, want [TENANT000001]", got)
	}
	if resp.Msg.Users[0].TenantName != "Readers" {
		t.Fatalf("tenant_name = %q, want Readers", resp.Msg.Users[0].TenantName)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestListEndUsersUnauthenticated は未認証の場合 Unauthenticated を返すことを検証する。
func TestListEndUsersUnauthenticated(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	_, err := server.ListEndUsers(context.Background(), connect.NewRequest(&publirasplatformv1.ListEndUsersRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListEndUsers code = %v, want unauthenticated", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestGetEndUser はエンドユーザー詳細の正常系を検証する。
func TestGetEndUser(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDQuery)).
		WithArgs("EUSER00001").
		WillReturnRows(sqlmock.NewRows(endUserGetByPublicIDColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "active", nil, now))

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByUserIDQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows(getTenantByUserIDColumns()))

	resp, err := server.GetEndUser(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.GetEndUserRequest{PublicId: "EUSER00001"}))
	if err != nil {
		t.Fatalf("GetEndUser: %v", err)
	}
	if resp.Msg.User.PublicId != "EUSER00001" {
		t.Fatalf("public_id = %v, want EUSER00001", resp.Msg.User.PublicId)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestGetEndUserNotFound は存在しないユーザーの場合 NotFound を返すことを検証する。
func TestGetEndUserNotFound(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDQuery)).
		WithArgs("NOTEXIST01").
		WillReturnError(sql.ErrNoRows)

	_, err := server.GetEndUser(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.GetEndUserRequest{PublicId: "NOTEXIST01"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetEndUser code = %v, want not_found", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestSuspendEndUser はエンドユーザーを停止しセッションが失効することを検証する。
func TestSuspendEndUser(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	// ensureManageableEndUser: ユーザー取得
	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDQuery)).
		WithArgs("EUSER00001").
		WillReturnRows(sqlmock.NewRows(endUserGetByPublicIDColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "active", nil, now))

	// ensureManageableEndUser: テナントメンバーシップ確認（なし）
	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	// ステータスを suspended に更新
	mock.ExpectQuery(regexp.QuoteMeta(testUpdateUserStatusQuery)).
		WithArgs("EUSER00001", "suspended").
		WillReturnRows(sqlmock.NewRows(updateUserStatusResultColumns()).
			AddRow(endUserID, "EUSER00001", "enduser@example.com", "hash", "End User", now, "suspended", nil, nil, int32(1)))

	// セッション失効
	mock.ExpectQuery(regexp.QuoteMeta(testBumpUserCredentialsVersionQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows(updateUserStatusResultColumns()).
			AddRow(endUserID, "EUSER00001", "enduser@example.com", "hash", "End User", now, "suspended", nil, nil, int32(2)))

	// テナント情報取得（なし）
	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByUserIDQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows(getTenantByUserIDColumns()))

	expectOperatorAuditLogInsert(mock)

	resp, err := server.SuspendEndUser(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.SuspendEndUserRequest{PublicId: "EUSER00001"}))
	if err != nil {
		t.Fatalf("SuspendEndUser: %v", err)
	}
	if resp.Msg.User.Status != "suspended" {
		t.Fatalf("status = %v, want suspended", resp.Msg.User.Status)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestSuspendEndUserWithPlatformRole はテナントメンバーの停止が拒否されることを検証する。
func TestSuspendEndUserWithPlatformRole(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDQuery)).
		WithArgs("PLATUSER002").
		WillReturnRows(sqlmock.NewRows(endUserGetByPublicIDColumns()).
			AddRow(endUserID, "PLATUSER002", "Platform User 2", "platform2@example.com", "active", nil, now))

	// テナントロールを持っているため拒否
	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_admin"))

	_, err := server.SuspendEndUser(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.SuspendEndUserRequest{PublicId: "PLATUSER002"}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("SuspendEndUser code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestUnsuspendEndUser は停止解除の正常系を検証する。
func TestUnsuspendEndUser(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDQuery)).
		WithArgs("EUSER00001").
		WillReturnRows(sqlmock.NewRows(endUserGetByPublicIDColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "suspended", nil, now))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	mock.ExpectQuery(regexp.QuoteMeta(testUpdateUserStatusQuery)).
		WithArgs("EUSER00001", "active").
		WillReturnRows(sqlmock.NewRows(updateUserStatusResultColumns()).
			AddRow(endUserID, "EUSER00001", "enduser@example.com", "hash", "End User", now, "active", nil, nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByUserIDQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows(getTenantByUserIDColumns()))

	expectOperatorAuditLogInsert(mock)

	resp, err := server.UnsuspendEndUser(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.UnsuspendEndUserRequest{PublicId: "EUSER00001"}))
	if err != nil {
		t.Fatalf("UnsuspendEndUser: %v", err)
	}
	if resp.Msg.User.Status != "active" {
		t.Fatalf("status = %v, want active", resp.Msg.User.Status)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestUnsuspendEndUserWithTenantMembership はテナントメンバー保持ユーザーの停止解除が拒否されることを検証する。
func TestUnsuspendEndUserWithTenantMembership(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDQuery)).
		WithArgs("TENANTUSER01").
		WillReturnRows(sqlmock.NewRows(endUserGetByPublicIDColumns()).
			AddRow(endUserID, "TENANTUSER01", "Tenant User", "tenantuser@example.com", "suspended", nil, now))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_editor"))

	_, err := server.UnsuspendEndUser(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.UnsuspendEndUserRequest{PublicId: "TENANTUSER01"}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("UnsuspendEndUser code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestDeleteEndUser はエンドユーザーの物理削除が正常に動作することを検証する。
func TestDeleteEndUser(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDQuery)).
		WithArgs("EUSER00001").
		WillReturnRows(sqlmock.NewRows(endUserGetByPublicIDColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "active", nil, now))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	mock.ExpectExec(regexp.QuoteMeta(testDeleteUserByIDQuery)).
		WithArgs(endUserID).
		WillReturnResult(sqlmock.NewResult(1, 1))

	expectOperatorAuditLogInsert(mock)

	resp, err := server.DeleteEndUser(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.DeleteEndUserRequest{PublicId: "EUSER00001"}))
	if err != nil {
		t.Fatalf("DeleteEndUser: %v", err)
	}
	if resp.Msg.PublicId != "EUSER00001" {
		t.Fatalf("public_id = %v, want EUSER00001", resp.Msg.PublicId)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestDeleteEndUserWithPlatformRole はテナントメンバー保持ユーザーの削除が拒否されることを検証する。
func TestDeleteEndUserWithPlatformRole(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDQuery)).
		WithArgs("PLATUSER002").
		WillReturnRows(sqlmock.NewRows(endUserGetByPublicIDColumns()).
			AddRow(endUserID, "PLATUSER002", "Platform User 2", "platform2@example.com", "active", nil, now))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_admin"))

	_, err := server.DeleteEndUser(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.DeleteEndUserRequest{PublicId: "PLATUSER002"}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeleteEndUser code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}
