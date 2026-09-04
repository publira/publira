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
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/tenanttz"
)

const (
	listTenantsAscQuery  = "-- name: ListTenantsAsc :many\n"
	listTenantsDescQuery = "-- name: ListTenantsDesc :many\n"
)

func tenantTestColumns() []string {
	return []string{"id", "public_id", "domain", "name", "default_reading_period_hours", "created_at", "status", "admin_domain", "timezone", "default_locale"}
}

func tenantScopedUserColumns() []string {
	return []string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}
}

func tenantMemberColumns() []string {
	return []string{"user_id", "public_id", "name", "email", "role", "status", "created_at"}
}

func addTenantRow(rows *sqlmock.Rows, id uuid.UUID, publicID, name string, createdAt time.Time) *sqlmock.Rows {
	return rows.AddRow(id, publicID, publicID+".example.com", name, nil, createdAt, tenantStatusActive, nil, tenanttz.Default, "ja")
}

func TestTenantToProtoExposesTimezone(t *testing.T) {
	tests := []struct {
		name            string
		stored          string
		platformDefault string
		want            string
	}{
		{name: "configured value", stored: "America/Los_Angeles", platformDefault: "Europe/Berlin", want: "America/Los_Angeles"},
		{name: "blank falls back to the platform default", stored: "", platformDefault: "Europe/Berlin", want: "Europe/Berlin"},
		{name: "blank platform default falls back to the built-in default", stored: "", platformDefault: "", want: tenanttz.Default},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tenantToProto(dbmodels.Tenant{
				PublicID:  "TENANT001",
				Name:      "Test Tenant",
				Status:    tenantStatusActive,
				Domain:    "tenant.example.com",
				CreatedAt: time.Now(),
				Timezone:  tt.stored,
			}, func() string { return tt.platformDefault })
			if got.Timezone != tt.want {
				t.Fatalf("timezone = %q, want %q", got.Timezone, tt.want)
			}
		})
	}
}

func TestListTenantsFirstPageReportsNextToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}
	mock.ExpectQuery(regexp.QuoteMeta(listTenantsDescQuery)).
		WithArgs(
			sql.NullString{String: "Acme", Valid: true},
			sql.NullString{String: "TENANT", Valid: true},
			sql.NullString{String: tenantStatusActive, Valid: true},
			uuid.NullUUID{}, false, sql.NullTime{}, int32(3),
		).
		WillReturnRows(addTenantRow(
			addTenantRow(
				addTenantRow(sqlmock.NewRows(tenantTestColumns()), ids[0], "TENANT001", "Acme One", now),
				ids[1], "TENANT002", "Acme Two", now.Add(-time.Minute),
			),
			ids[2], "TENANT003", "Acme Three", now.Add(-2*time.Minute),
		))

	resp, err := server.ListTenants(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantsRequest{
		Limit:    2,
		Name:     " Acme ",
		PublicId: " TENANT ",
		Status:   " active ",
	}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(resp.Msg.Tenants) != 2 {
		t.Fatalf("tenant count = %d, want the over-fetched row dropped", len(resp.Msg.Tenants))
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

func TestListTenantsFollowsNextToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	mock.ExpectQuery(regexp.QuoteMeta(listTenantsDescQuery)).
		WithArgs(
			sql.NullString{String: "", Valid: true},
			sql.NullString{String: "", Valid: true},
			sql.NullString{String: "", Valid: true},
			boundaryID, false, boundaryAt, int32(3),
		).
		WillReturnRows(addTenantRow(
			sqlmock.NewRows(tenantTestColumns()), uuid.Must(uuid.NewV7()), "TENANT003", "Third", now.Add(-2*time.Minute),
		))

	resp, err := server.ListTenants(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantsRequest{
		Limit: 2,
		Token: pagination.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID),
	}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the previous page")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListTenantsFollowsPreviousTokenBackwards(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	mock.ExpectQuery(regexp.QuoteMeta(listTenantsAscQuery)).
		WithArgs(
			sql.NullString{String: "", Valid: true},
			sql.NullString{String: "", Valid: true},
			sql.NullString{String: "", Valid: true},
			boundaryID, false, boundaryAt, int32(3),
		).
		WillReturnRows(addTenantRow(
			addTenantRow(sqlmock.NewRows(tenantTestColumns()), uuid.Must(uuid.NewV7()), "TENANT002", "Older", now.Add(-2*time.Minute)),
			uuid.Must(uuid.NewV7()), "TENANT001", "Newer", now.Add(-time.Minute),
		))

	resp, err := server.ListTenants(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantsRequest{
		Limit: 2,
		Token: pagination.EncodeTimeUUID(pagination.Backward, boundaryAt, boundaryID),
	}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	publicIDs := []string{resp.Msg.Tenants[0].PublicId, resp.Msg.Tenants[1].PublicId}
	if !slices.Equal(publicIDs, []string{"TENANT001", "TENANT002"}) {
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

func TestListTenantsEmptyPageReturnsOneRecoveryToken(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		query     string
	}{
		{name: "forward", direction: pagination.Forward, query: listTenantsDescQuery},
		{name: "backward", direction: pagination.Backward, query: listTenantsAscQuery},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			mock.ExpectQuery(regexp.QuoteMeta(test.query)).
				WithArgs(
					sql.NullString{String: "", Valid: true},
					sql.NullString{String: "", Valid: true},
					sql.NullString{String: "", Valid: true},
					boundaryID, false, now, int32(21),
				).
				WillReturnRows(sqlmock.NewRows(tenantTestColumns()))

			resp, err := server.ListTenants(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantsRequest{
				Token: pagination.EncodeTimeUUID(test.direction, now, boundaryID),
			}))
			if err != nil {
				t.Fatalf("ListTenants: %v", err)
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

func TestListTenantsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(listTenantsDescQuery)).
		WithArgs(
			sql.NullString{String: "", Valid: true},
			sql.NullString{String: "", Valid: true},
			sql.NullString{String: "", Valid: true},
			boundaryID, true, now, int32(21),
		).
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()))

	resp, err := server.ListTenants(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantsRequest{
		Token: pagination.EncodeTimeUUIDRecovery(pagination.Forward, now, boundaryID),
	}))
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty after one recovery", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListTenantsRejectsInvalidToken(t *testing.T) {
	tests := []string{
		"not-base64",
		pagination.Encode(pagination.Forward, "not-a-time", uuid.Must(uuid.NewV7()).String()),
		pagination.Encode(pagination.Forward, time.Now().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String(), "not-inclusive"),
	}

	for _, token := range tests {
		server, mock := newOperatorHandlerTestServer(t)
		_, err := server.ListTenants(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantsRequest{Token: token}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("ListTenants code = %v, want invalid_argument", connect.CodeOf(err))
		}
		assertOperatorHandlerExpectations(t, mock)
	}
}

func TestListTenantsDatabaseErrorIsHidden(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	mock.ExpectQuery(regexp.QuoteMeta(listTenantsDescQuery)).
		WithArgs(
			sql.NullString{String: "", Valid: true},
			sql.NullString{String: "", Valid: true},
			sql.NullString{String: "", Valid: true},
			uuid.NullUUID{}, false, sql.NullTime{}, int32(21),
		).
		WillReturnError(errors.New(`pq: relation "tenants" does not exist`))

	_, err := server.ListTenants(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantsRequest{}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListTenants code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertOperatorHandlerExpectations(t, mock)
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
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantMembersDescQuery)).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
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
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantMembersDescQuery)).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
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
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByPublicIDForTenantQuery)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testCreateTenantUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), tenantID, targetUserID, "tenant_admin").
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
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))

	mock.ExpectQuery(regexp.QuoteMeta(testGetUserByEmailForTenantQuery)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "alice@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at", "credentials_version"}).
			AddRow(targetUserID, "USER000001", "alice@example.com", "hashed", "Alice", now, "active", tenantID, nil, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(testListTenantUserRolesQuery)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(testCreateTenantUserRoleQuery)).
		WithArgs(sqlmock.AnyArg(), tenantID, targetUserID, "tenant_admin").
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
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))

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
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))

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
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))

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
		WithArgs(sqlmock.AnyArg(), tenantID, targetUserID, "tenant_editor").
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
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))

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
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))

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
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo", "ja"))

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
