package platformapi

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/pagination"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
)

const (
	listPlatformOperatorsAscQuery  = "-- name: ListPlatformOperatorsAsc :many\n"
	listPlatformOperatorsDescQuery = "-- name: ListPlatformOperatorsDesc :many\n"
)

func addOperatorRow(
	rows *sqlmock.Rows,
	id uuid.UUID,
	publicID string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(
		id,
		publicID,
		publicID+"@example.com",
		publicID,
		rolePlatformOperator,
		"active",
		createdAt,
	)
}

func TestListOperatorsFirstPageReportsNextToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	actorID := uuid.Must(uuid.NewV7())
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}
	expectOperatorAuth(mock, actorID, rolePlatformOperator, now)
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformOperatorsDescQuery)).
		WithArgs(uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addOperatorRow(
			addOperatorRow(
				addOperatorRow(sqlmock.NewRows(operatorTestColumns()), ids[0], "PLATUSER001", now),
				ids[1], "PLATUSER002", now.Add(-time.Minute),
			),
			ids[2], "PLATUSER003", now.Add(-2*time.Minute),
		))

	resp, err := server.ListOperators(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListOperatorsRequest{Limit: 2}))
	if err != nil {
		t.Fatalf("ListOperators: %v", err)
	}
	if len(resp.Msg.Operators) != 2 {
		t.Fatalf("operator count = %d, want the over-fetched row dropped", len(resp.Msg.Operators))
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantKeys := []string{now.Add(-time.Minute).Format(time.RFC3339Nano), ids[1].String()}
	if cursor.Direction != pagination.Forward || !slices.Equal(cursor.Keys, wantKeys) {
		t.Fatalf("next_token = %+v, want forward keys %v", cursor, wantKeys)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListOperatorsFollowsNextToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	actorID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	resultID := uuid.Must(uuid.NewV7())
	resultAt := now.Add(-2 * time.Minute)
	expectOperatorAuth(mock, actorID, rolePlatformOperator, now)
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformOperatorsDescQuery)).
		WithArgs(boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addOperatorRow(
			sqlmock.NewRows(operatorTestColumns()), resultID, "PLATUSER003", resultAt,
		))

	resp, err := server.ListOperators(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListOperatorsRequest{
		Limit: 2,
		Token: pagination.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID),
	}))
	if err != nil {
		t.Fatalf("ListOperators: %v", err)
	}
	if len(resp.Msg.Operators) != 1 || resp.Msg.Operators[0].PublicId != "PLATUSER003" {
		t.Fatalf("operators = %+v, want PLATUSER003", resp.Msg.Operators)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the previous page")
	}
	cursor, err := pagination.Decode(resp.Msg.PreviousToken)
	if err != nil {
		t.Fatalf("decode previous_token: %v", err)
	}
	wantKeys := []string{resultAt.Format(time.RFC3339Nano), resultID.String()}
	if cursor.Direction != pagination.Backward || !slices.Equal(cursor.Keys, wantKeys) {
		t.Fatalf("previous_token = %+v, want backward keys %v", cursor, wantKeys)
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListOperatorsFollowsPreviousTokenBackwards(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	actorID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	expectOperatorAuth(mock, actorID, rolePlatformOperator, now)
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformOperatorsAscQuery)).
		WithArgs(boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addOperatorRow(
			addOperatorRow(sqlmock.NewRows(operatorTestColumns()), uuid.Must(uuid.NewV7()), "PLATUSER002", now.Add(-2*time.Minute)),
			uuid.Must(uuid.NewV7()), "PLATUSER001", now.Add(-time.Minute),
		))

	resp, err := server.ListOperators(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListOperatorsRequest{
		Limit: 2,
		Token: pagination.EncodeTimeUUID(pagination.Backward, boundaryAt, boundaryID),
	}))
	if err != nil {
		t.Fatalf("ListOperators: %v", err)
	}
	publicIDs := []string{resp.Msg.Operators[0].PublicId, resp.Msg.Operators[1].PublicId}
	if !slices.Equal(publicIDs, []string{"PLATUSER001", "PLATUSER002"}) {
		t.Fatalf("public IDs = %v, want backward page restored to descending order", publicIDs)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListOperatorsEmptyPageReturnsOneRecoveryToken(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		query     string
	}{
		{name: "forward", direction: pagination.Forward, query: listPlatformOperatorsDescQuery},
		{name: "backward", direction: pagination.Backward, query: listPlatformOperatorsAscQuery},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)
			now := time.Now().UTC().Truncate(time.Microsecond)
			actorID := uuid.Must(uuid.NewV7())
			boundaryID := uuid.Must(uuid.NewV7())
			expectOperatorAuth(mock, actorID, rolePlatformOperator, now)
			mock.ExpectQuery(regexp.QuoteMeta(test.query)).
				WithArgs(boundaryID, false, now, int32(21)).
				WillReturnRows(sqlmock.NewRows(operatorTestColumns()))

			resp, err := server.ListOperators(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListOperatorsRequest{
				Token: pagination.EncodeTimeUUID(test.direction, now, boundaryID),
			}))
			if err != nil {
				t.Fatalf("ListOperators: %v", err)
			}
			if test.direction == pagination.Forward {
				want := pagination.EncodeTimeUUIDRecovery(pagination.Backward, now, boundaryID)
				if resp.Msg.PreviousToken != want || resp.Msg.NextToken != "" {
					t.Fatalf("tokens = (%q, %q), want recovery previous token %q", resp.Msg.PreviousToken, resp.Msg.NextToken, want)
				}
			} else {
				want := pagination.EncodeTimeUUIDRecovery(pagination.Forward, now, boundaryID)
				if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != want {
					t.Fatalf("tokens = (%q, %q), want recovery next token %q", resp.Msg.PreviousToken, resp.Msg.NextToken, want)
				}
			}
			assertOperatorHandlerExpectations(t, mock)
		})
	}
}

func TestListOperatorsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	actorID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, actorID, rolePlatformOperator, now)
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformOperatorsDescQuery)).
		WithArgs(boundaryID, true, now, int32(21)).
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()))

	resp, err := server.ListOperators(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListOperatorsRequest{
		Token: pagination.EncodeTimeUUIDRecovery(pagination.Forward, now, boundaryID),
	}))
	if err != nil {
		t.Fatalf("ListOperators: %v", err)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty after one recovery", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListOperatorsRejectsInvalidToken(t *testing.T) {
	tests := []string{
		"not-base64",
		pagination.Encode(pagination.Forward, "not-a-time", uuid.Must(uuid.NewV7()).String()),
		pagination.Encode(pagination.Forward, time.Now().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String(), "not-inclusive"),
	}

	for _, token := range tests {
		server, mock := newOperatorHandlerTestServer(t)
		now := time.Now().UTC().Truncate(time.Microsecond)
		expectOperatorAuth(mock, uuid.Must(uuid.NewV7()), rolePlatformOperator, now)
		_, err := server.ListOperators(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListOperatorsRequest{Token: token}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("ListOperators code = %v, want invalid_argument", connect.CodeOf(err))
		}
		if err.Error() != "invalid_argument: token is invalid" {
			t.Fatalf("error = %q, want token internals hidden", err)
		}
		assertOperatorHandlerExpectations(t, mock)
	}
}

func TestListOperatorsHidesDatabaseError(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectOperatorAuth(mock, uuid.Must(uuid.NewV7()), rolePlatformOperator, now)
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformOperatorsDescQuery)).
		WithArgs(uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnError(errors.New("relation platform_users does not exist"))

	_, err := server.ListOperators(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListOperatorsRequest{}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListOperators code = %v, want internal", connect.CodeOf(err))
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListOperatorsPreservesContextCanceled(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectOperatorAuth(mock, uuid.Must(uuid.NewV7()), rolePlatformOperator, now)
	mock.ExpectQuery(regexp.QuoteMeta(listPlatformOperatorsDescQuery)).
		WithArgs(uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnError(context.Canceled)

	_, err := server.ListOperators(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListOperatorsRequest{}))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("ListOperators error = %v, want context.Canceled", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestGetOperator(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	actorID := uuid.Must(uuid.NewV7())
	targetID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, actorID, rolePlatformOperator, now)
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("PLATUSER002").
		WillReturnRows(sqlmock.NewRows(operatorTestColumns()).
			AddRow(targetID, "PLATUSER002", "operator2@example.com", "Operator Two", rolePlatformOperator, "active", now))

	resp, err := server.GetOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.GetOperatorRequest{PublicId: "PLATUSER002"}))
	if err != nil {
		t.Fatalf("GetOperator: %v", err)
	}
	if resp.Msg.Operator == nil || resp.Msg.Operator.PublicId != "PLATUSER002" {
		t.Fatalf("operator = %v, want public_id=PLATUSER002", resp.Msg.Operator)
	}
	if resp.Msg.Operator.Email != "operator2@example.com" {
		t.Fatalf("email = %q, want operator2@example.com", resp.Msg.Operator.Email)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestGetOperatorNotFound(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectOperatorAuth(mock, uuid.Must(uuid.NewV7()), rolePlatformOperator, now)
	mock.ExpectQuery(regexp.QuoteMeta(testGetPlatformOperatorByPublicIDQuery)).
		WithArgs("MISSINGUSER1").
		WillReturnError(sql.ErrNoRows)

	_, err := server.GetOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.GetOperatorRequest{PublicId: "MISSINGUSER1"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetOperator code = %v, want not_found", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestGetOperatorRequiresPublicID(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	expectOperatorAuth(mock, uuid.Must(uuid.NewV7()), rolePlatformOperator, now)

	_, err := server.GetOperator(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.GetOperatorRequest{PublicId: "   "}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("GetOperator code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

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
	expectPublicIDAttempt(mock)
	mock.ExpectQuery(regexp.QuoteMeta(testCreatePlatformUserQuery)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "new-operator@example.com", sqlmock.AnyArg(), "New Operator").
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(newOperatorID, "PLATNEW001", "new-operator@example.com", "hash", "New Operator", "active", now, int32(1)))
	expectPublicIDAttemptReleased(mock)
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
			AddRow(targetID, "PLATUSER003", "operator3@example.com", "hash", "Operator Three", "suspended", now, int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(testBumpPlatformUserCredentialsVersionQuery)).
		WithArgs(targetID).
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(targetID, "PLATUSER001", "platform@example.com", "hash", "User", "active", now, int32(2)))
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
			AddRow(targetID, "PLATUSER005", "operator5@example.com", "hash", "Operator Five", "inactive", now, int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(testBumpPlatformUserCredentialsVersionQuery)).
		WithArgs(targetID).
		WillReturnRows(sqlmock.NewRows(operatorTestUserColumns()).
			AddRow(targetID, "PLATUSER001", "platform@example.com", "hash", "User", "active", now, int32(2)))
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
