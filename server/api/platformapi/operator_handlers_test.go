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

func TestCreateOperatorSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	adminID := uuid.Must(uuid.NewV7())
	newOperatorID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformUserByEmailQuery)).
		WithArgs("new-operator@example.com").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformUserQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "new-operator@example.com", sqlmock.AnyArg(), "New Operator").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(newOperatorID, "PLATNEW001", "new-operator@example.com", "hash", "New Operator", "active", now))
	mock.ExpectQuery(regexp.QuoteMeta(testListPlatformUserRolesQuery)).
		WithArgs(newOperatorID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))
	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), newOperatorID, "platform_operator").
		WillReturnRows(sqlmock.NewRows([]string{"id", "role", "created_at", "platform_user_id"}).
			AddRow(uuid.Must(uuid.NewV7()), "platform_operator", now, newOperatorID))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATNEW001").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(newOperatorID, "PLATNEW001", "new-operator@example.com", "New Operator", "platform_operator", "active", now))
	mock.ExpectCommit()
	expectOperatorAuditLogInsert(mock)

	resp, err := server.CreateOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.CreateOperatorRequest{
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
	assertOperatorHandlerExpectations(t, mock)
}

func TestCreateOperatorRequiresSuperAdmin(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	operatorID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, operatorID, "platform_operator", now)

	_, err := server.CreateOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.CreateOperatorRequest{
		Name:  "New Operator",
		Email: "new-operator@example.com",
		Role:  "platform_operator",
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateOperator code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUpdateOperatorRoleSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	adminID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER002").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(targetID, "PLATUSER002", "operator2@example.com", "Operator Two", "platform_operator", "active", now))
	mock.ExpectExec(regexp.QuoteMeta(testDeletePlatformUserRolesByPlatformUserID)).
		WithArgs(targetID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), targetID, "platform_auditor").
		WillReturnRows(sqlmock.NewRows([]string{"id", "role", "created_at", "platform_user_id"}).
			AddRow(uuid.Must(uuid.NewV7()), "platform_auditor", now, targetID))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER002").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(targetID, "PLATUSER002", "operator2@example.com", "Operator Two", "platform_auditor", "active", now))
	mock.ExpectCommit()
	expectOperatorAuditLogInsert(mock)

	resp, err := server.UpdateOperatorRole(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.UpdateOperatorRoleRequest{
		PublicId: "PLATUSER002",
		Role:     "platform_auditor",
	}))
	if err != nil {
		t.Fatalf("UpdateOperatorRole: %v", err)
	}
	if resp.Msg.Operator == nil || resp.Msg.Operator.Role != "platform_auditor" {
		t.Fatalf("operator.role = %v, want platform_auditor", resp.Msg.Operator)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestSuspendOperatorSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	adminID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER003").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(targetID, "PLATUSER003", "operator3@example.com", "Operator Three", "platform_operator", "active", now))
	mock.ExpectQuery(regexp.QuoteMeta(testUpdatePlatformUserStatusQuery)).
		WithArgs("PLATUSER003", "suspended").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(targetID, "PLATUSER003", "operator3@example.com", "hash", "Operator Three", "suspended", now))
	mock.ExpectExec(regexp.QuoteMeta(testTerminatePlatformUserSessionsQuery)).
		WithArgs(targetID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER003").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(targetID, "PLATUSER003", "operator3@example.com", "Operator Three", "platform_operator", "suspended", now))
	mock.ExpectCommit()
	expectOperatorAuditLogInsert(mock)

	resp, err := server.SuspendOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.SuspendOperatorRequest{PublicId: "PLATUSER003"}))
	if err != nil {
		t.Fatalf("SuspendOperator: %v", err)
	}
	if resp.Msg.Operator == nil || resp.Msg.Operator.Status != "suspended" {
		t.Fatalf("operator.status = %v, want suspended", resp.Msg.Operator)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestUnsuspendOperatorRejectsInvalidState(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	adminID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER004").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(targetID, "PLATUSER004", "operator4@example.com", "Operator Four", "platform_operator", "active", now))
	mock.ExpectRollback()

	_, err := server.UnsuspendOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.UnsuspendOperatorRequest{PublicId: "PLATUSER004"}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UnsuspendOperator code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestDeactivateOperatorSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	adminID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER005").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(targetID, "PLATUSER005", "operator5@example.com", "Operator Five", "platform_operator", "active", now))
	mock.ExpectQuery(regexp.QuoteMeta(testUpdatePlatformUserStatusQuery)).
		WithArgs("PLATUSER005", "inactive").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(targetID, "PLATUSER005", "operator5@example.com", "hash", "Operator Five", "inactive", now))
	mock.ExpectExec(regexp.QuoteMeta(testTerminatePlatformUserSessionsQuery)).
		WithArgs(targetID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER005").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(targetID, "PLATUSER005", "operator5@example.com", "Operator Five", "platform_operator", "inactive", now))
	mock.ExpectCommit()
	expectOperatorAuditLogInsert(mock)

	resp, err := server.DeactivateOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.DeactivateOperatorRequest{PublicId: "PLATUSER005"}))
	if err != nil {
		t.Fatalf("DeactivateOperator: %v", err)
	}
	if resp.Msg.Operator == nil || resp.Msg.Operator.Status != "inactive" {
		t.Fatalf("operator.status = %v, want inactive", resp.Msg.Operator)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestDeactivateOperatorRequiresSuperAdmin(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	operatorID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, operatorID, "platform_operator", now)

	_, err := server.DeactivateOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.DeactivateOperatorRequest{PublicId: "PLATUSER005"}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeactivateOperator code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestDeactivateOperatorSelfDeactivationForbidden(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	adminID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER001").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(adminID, "PLATUSER001", "platform@example.com", "Platform User", "platform_super_admin", "active", now))
	mock.ExpectRollback()

	_, err := server.DeactivateOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.DeactivateOperatorRequest{PublicId: "PLATUSER001"}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeactivateOperator code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestDeactivateOperatorAlreadyInactiveRejected(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	adminID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, adminID, "platform_super_admin", now)

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER006").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(targetID, "PLATUSER006", "operator6@example.com", "Operator Six", "platform_operator", "inactive", now))
	mock.ExpectRollback()

	_, err := server.DeactivateOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.DeactivateOperatorRequest{PublicId: "PLATUSER006"}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeactivateOperator code = %v, want failed_precondition", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}
