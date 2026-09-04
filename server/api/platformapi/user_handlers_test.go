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

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/pagination"
)

// The columns GetUserByPublicID returns: id, public_id, name, email, status,
// tenant_id, created_at.
func endUserGetByPublicIDColumns() []string {
	return []string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}
}

// The columns ListEndUsers returns; the tenant a user belongs to comes along
// through a JOIN.
func listEndUsersResultColumns() []string {
	return []string{"id", "public_id", "name", "email", "status", "created_at", "tenant_public_id", "tenant_name"}
}

func getTenantByUserIDColumns() []string {
	return []string{"id", "public_id", "name", "created_at"}
}

// The columns UpdateUserStatus returns.
func updateUserStatusResultColumns() []string {
	return []string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at", "credentials_version"}
}

// TestListEndUsers asserts the success path of listing end users.
func TestListEndUsers(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	mock.ExpectQuery(regexp.QuoteMeta(testListEndUsersDescQuery)).
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

func TestListEndUsersDatabaseErrorIsHidden(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, userID, "platform_operator", now)
	mock.ExpectQuery(regexp.QuoteMeta(testListEndUsersDescQuery)).
		WillReturnError(errors.New(`pq: relation "users" does not exist`))

	_, err := server.ListEndUsers(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListEndUsersRequest{}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListEndUsers code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestListEndUsersUnauthenticated asserts that an unauthenticated caller gets
// Unauthenticated.
func TestListEndUsersUnauthenticated(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	_, err := server.ListEndUsers(context.Background(), connect.NewRequest(&publirasplatformv1.ListEndUsersRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListEndUsers code = %v, want unauthenticated", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestGetEndUser asserts the success path of reading one end user.
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

// TestGetEndUserNotFound asserts that an unknown user yields NotFound.
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

// TestSuspendEndUser asserts that suspending an end user also invalidates
// their sessions.
func TestSuspendEndUser(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	userID := uuid.Must(uuid.NewV7())
	endUserID := uuid.Must(uuid.NewV7())

	expectOperatorAuth(mock, userID, "platform_operator", now)

	// ensureManageableEndUser: read the user.
	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDQuery)).
		WithArgs("EUSER00001").
		WillReturnRows(sqlmock.NewRows(endUserGetByPublicIDColumns()).
			AddRow(endUserID, "EUSER00001", "End User", "enduser@example.com", "active", nil, now))

	// ensureManageableEndUser: check tenant membership, of which there is none.
	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	// Update the status to suspended.
	mock.ExpectQuery(regexp.QuoteMeta(testUpdateUserStatusQuery)).
		WithArgs("EUSER00001", "suspended").
		WillReturnRows(sqlmock.NewRows(updateUserStatusResultColumns()).
			AddRow(endUserID, "EUSER00001", "enduser@example.com", "hash", "End User", now, "suspended", nil, nil, int32(1)))

	// Invalidate the sessions.
	mock.ExpectQuery(regexp.QuoteMeta(testBumpUserCredentialsVersionQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows(updateUserStatusResultColumns()).
			AddRow(endUserID, "EUSER00001", "enduser@example.com", "hash", "End User", now, "suspended", nil, nil, int32(2)))

	// Read the tenant, of which there is none.
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

// TestSuspendEndUserWithPlatformRole asserts that suspending a tenant member
// is refused.
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

	// Refused because the user holds a tenant role.
	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(endUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_admin"))

	_, err := server.SuspendEndUser(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.SuspendEndUserRequest{PublicId: "PLATUSER002"}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("SuspendEndUser code = %v, want permission_denied", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

// TestUnsuspendEndUser asserts the success path of lifting a suspension.
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

// TestUnsuspendEndUserWithTenantMembership asserts that lifting the
// suspension of a user who is a tenant member is refused.
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

// TestDeleteEndUser asserts that deleting an end user row works.
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

// TestDeleteEndUserWithPlatformRole asserts that deleting a user who is a
// tenant member is refused.
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

func addEndUserRow(rows *sqlmock.Rows, id uuid.UUID, publicID, name string, createdAt time.Time) *sqlmock.Rows {
	return rows.AddRow(id, publicID, name, publicID+"@example.com", userStatusActive, createdAt, "TENANT000001", "Readers")
}

func endUserNames(users []*publirasplatformv1.EndUser) []string {
	names := make([]string, 0, len(users))
	for _, user := range users {
		names = append(names, user.Name)
	}
	return names
}

func TestListEndUsersFirstPageReportsNextToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	userID := uuid.Must(uuid.NewV7())
	newerID := uuid.Must(uuid.NewV7())
	olderID := uuid.Must(uuid.NewV7())
	extraID := uuid.Must(uuid.NewV7())
	olderAt := now.Add(-2 * time.Minute)
	expectOperatorAuth(mock, userID, "platform_operator", now)

	// The handler over-fetches by one row; that extra row is what says another
	// page exists, and it must not reach the response.
	rows := addEndUserRow(
		addEndUserRow(
			addEndUserRow(sqlmock.NewRows(listEndUsersResultColumns()), newerID, "EUSER00001", "Newer", now.Add(-time.Minute)),
			olderID, "EUSER00002", "Older", olderAt),
		extraID, "EUSER00003", "Extra", now.Add(-3*time.Minute))
	mock.ExpectQuery(regexp.QuoteMeta(testListEndUsersDescQuery)).
		WithArgs(sql.NullTime{}, sql.NullTime{}, sql.NullString{}, sqlmock.AnyArg(), sql.NullString{}, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(rows)

	resp, err := server.ListEndUsers(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListEndUsersRequest{Limit: 2}))
	if err != nil {
		t.Fatalf("ListEndUsers: %v", err)
	}
	if got := endUserNames(resp.Msg.Users); !slices.Equal(got, []string{"Newer", "Older"}) {
		t.Fatalf("users = %v, want the first page only", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	next, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantNext := []string{olderAt.Format(time.RFC3339Nano), olderID.String()}
	if next.Direction != pagination.Forward || !slices.Equal(next.Keys, wantNext) {
		t.Fatalf("next_token = %+v, want forward keys %v", next, wantNext)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListEndUsersFollowsPreviousTokenBackwards(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	userID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	newerID := uuid.Must(uuid.NewV7())
	olderID := uuid.Must(uuid.NewV7())
	olderAt := now.Add(-2 * time.Minute)
	expectOperatorAuth(mock, userID, "platform_operator", now)

	rows := addEndUserRow(
		addEndUserRow(sqlmock.NewRows(listEndUsersResultColumns()), olderID, "EUSER00002", "Older", olderAt),
		newerID, "EUSER00001", "Newer", now.Add(-time.Minute))
	mock.ExpectQuery(regexp.QuoteMeta(testListEndUsersAscQuery)).
		WithArgs(sql.NullTime{}, sql.NullTime{}, sql.NullString{}, sqlmock.AnyArg(), sql.NullString{}, uuid.NullUUID{UUID: boundaryID, Valid: true}, false, sqlmock.AnyArg(), int32(3)).
		WillReturnRows(rows)

	resp, err := server.ListEndUsers(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListEndUsersRequest{
		Limit: 2,
		Token: pagination.EncodeTimeUUID(pagination.Backward, boundaryAt, boundaryID),
	}))
	if err != nil {
		t.Fatalf("ListEndUsers: %v", err)
	}
	if got := endUserNames(resp.Msg.Users); !slices.Equal(got, []string{"Newer", "Older"}) {
		t.Fatalf("users = %v, want the backward page restored to descending order", got)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	next, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantNext := []string{olderAt.Format(time.RFC3339Nano), olderID.String()}
	if next.Direction != pagination.Forward || !slices.Equal(next.Keys, wantNext) {
		t.Fatalf("next_token = %+v, want forward keys %v", next, wantNext)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListEndUsersEmptyPageKeepsAWayBack(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	userID := uuid.Must(uuid.NewV7())
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	expectOperatorAuth(mock, userID, "platform_operator", now)

	mock.ExpectQuery(regexp.QuoteMeta(testListEndUsersDescQuery)).
		WithArgs(sql.NullTime{}, sql.NullTime{}, sql.NullString{}, sqlmock.AnyArg(), sql.NullString{}, uuid.NullUUID{UUID: boundaryID, Valid: true}, false, sqlmock.AnyArg(), int32(defaultListLimit+1)).
		WillReturnRows(sqlmock.NewRows(listEndUsersResultColumns()))

	resp, err := server.ListEndUsers(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListEndUsersRequest{
		Token: pagination.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID),
	}))
	if err != nil {
		t.Fatalf("ListEndUsers: %v", err)
	}
	if len(resp.Msg.Users) != 0 {
		t.Fatalf("users count = %d, want 0", len(resp.Msg.Users))
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on an emptied page", resp.Msg.NextToken)
	}
	previous, err := pagination.Decode(resp.Msg.PreviousToken)
	if err != nil {
		t.Fatalf("decode previous_token: %v", err)
	}
	wantKeys := []string{boundaryAt.Format(time.RFC3339Nano), boundaryID.String(), "inclusive"}
	if previous.Direction != pagination.Backward || !slices.Equal(previous.Keys, wantKeys) {
		t.Fatalf("previous_token = %+v, want backward recovery keys %v", previous, wantKeys)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListEndUsersRejectsBrokenToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	userID := uuid.Must(uuid.NewV7())
	expectOperatorAuth(mock, userID, "platform_operator", now)

	_, err := server.ListEndUsers(context.Background(), newAuthedOperatorRequest(&publirasplatformv1.ListEndUsersRequest{
		Token: "not-a-token",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListEndUsers code = %v, want invalid_argument", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}
