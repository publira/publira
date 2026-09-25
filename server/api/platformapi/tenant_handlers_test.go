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

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/platformtenants"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/tenanttz"
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
	return rows.AddRow(id, publicID, publicID+".example.com", name, nil, createdAt, platformtenants.StatusActive, nil, tenanttz.Default, "ja")
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
				Status:    platformtenants.StatusActive,
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantsDesc)).
		WithArgs(
			sql.NullString{String: "Acme", Valid: true},
			sql.NullString{String: "TENANT", Valid: true},
			sql.NullString{String: platformtenants.StatusActive, Valid: true},
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
	wantKeys := []string{"created_at_desc+name:Acme+public_id:TENANT+status:active", now.Add(-time.Minute).Format(time.RFC3339Nano), ids[1].String()}
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantsDesc)).
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantsAsc)).
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
		{name: "forward", direction: pagination.Forward, query: dbmodels.ListTenantsDesc},
		{name: "backward", direction: pagination.Backward, query: dbmodels.ListTenantsAsc},
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantsDesc)).
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

func TestListTenantsRejectsAnotherFiltersToken(t *testing.T) {
	boundaryAt := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	active := pagination.NewListKey("created_at_desc").Value("status", platformtenants.StatusActive)

	tests := map[string]struct {
		token string
		req   *publirasplatformv1.ListTenantsRequest
	}{
		"another status": {
			token: active.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID),
			req:   &publirasplatformv1.ListTenantsRequest{Status: "suspended"},
		},
		"a filter added": {
			token: active.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID),
			req:   &publirasplatformv1.ListTenantsRequest{Name: "Acme", Status: platformtenants.StatusActive},
		},
		"a filter removed": {
			token: active.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID),
			req:   &publirasplatformv1.ListTenantsRequest{},
		},
		"an unfiltered token": {
			token: pagination.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID),
			req:   &publirasplatformv1.ListTenantsRequest{Status: platformtenants.StatusActive},
		},
		"a recovery token": {
			token: active.EncodeTimeUUIDRecovery(pagination.Backward, boundaryAt, boundaryID),
			req:   &publirasplatformv1.ListTenantsRequest{Status: "suspended"},
		},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)
			tt.req.Token = tt.token
			_, err := server.ListTenants(context.Background(), connect.NewRequest(tt.req))
			if err == nil || err.Error() != "invalid_argument: token was issued for another filter" {
				t.Fatalf("ListTenants error = %v, want invalid_argument for another filter", err)
			}
			assertOperatorHandlerExpectations(t, mock)
		})
	}
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantsDesc)).
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantMembersDesc)).
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

func TestListTenantMembersRejectsAnotherTenantsToken(t *testing.T) {
	boundaryAt := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	otherTenant := pagination.NewListKey("created_at_desc").Value("tenant_public_id", "TENANT002")

	for name, token := range map[string]string{
		"boundary": otherTenant.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID),
		"recovery": otherTenant.EncodeTimeUUIDRecovery(pagination.Backward, boundaryAt, boundaryID),
	} {
		t.Run(name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)
			_, err := server.ListTenantMembers(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantMembersRequest{
				TenantPublicId: "TENANT001",
				Token:          token,
			}))
			if err == nil || err.Error() != "invalid_argument: token was issued for another filter" {
				t.Fatalf("ListTenantMembers with another tenant's token error = %v, want invalid_argument", err)
			}
			assertOperatorHandlerExpectations(t, mock)
		})
	}
}

// TestListTenantMembersEmptyList asserts that a tenant with no members yields
// an empty list.
func TestListTenantMembersEmptyList(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantMembersDesc)).
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

// TestListTenantMembersTenantNotFound asserts that an unknown tenant yields
// NotFound.
func TestListTenantMembersTenantNotFound(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("NOTFOUND").
		WillReturnError(sql.ErrNoRows)

	_, err := server.ListTenantMembers(context.Background(), connect.NewRequest(&publirasplatformv1.ListTenantMembersRequest{TenantPublicId: "NOTFOUND"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ListTenantMembers code = %v, want not_found", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

// expectTenantMemberAuditLogInsert expects the entry a member change files
// inside its transaction, under the operator and naming the user.
func expectTenantMemberAuditLogInsert(mock sqlmock.Sqlmock, operatorID uuid.UUID, action string, userID uuid.UUID) {
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.InsertPlatformAuditLog)).
		WithArgs(sqlmock.AnyArg(), uuid.NullUUID{UUID: operatorID, Valid: true}, "platform_operator", action, "user", userID.String(), auditlog.OutcomeSuccess, nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
}

func TestAddTenantMemberSuccess(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())
	operatorID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByPublicIDForTenant)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantUserRoles)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateTenantUserRole)).
		WithArgs(sqlmock.AnyArg(), tenantID, targetUserID, "tenant_admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), targetUserID, "tenant_admin", now, tenantID))
	expectTenantMemberAuditLogInsert(mock, operatorID, "tenant_member_added", targetUserID)
	mock.ExpectCommit()

	resp, err := server.AddTenantMember(newOperatorActorContext(operatorID), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
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
	operatorID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByEmailForTenant)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "alice@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at", "credentials_version", "birth_date"}).
			AddRow(targetUserID, "USER000001", "alice@example.com", "hashed", "Alice", now, "active", tenantID, nil, int32(1), nil))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantUserRoles)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateTenantUserRole)).
		WithArgs(sqlmock.AnyArg(), tenantID, targetUserID, "tenant_admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), targetUserID, "tenant_admin", now, tenantID))
	expectTenantMemberAuditLogInsert(mock, operatorID, "tenant_member_added", targetUserID)
	mock.ExpectCommit()

	resp, err := server.AddTenantMember(newOperatorActorContext(operatorID), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
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

	_, err := server.AddTenantMember(newOperatorActorContext(uuid.Must(uuid.NewV7())), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnError(sql.ErrNoRows)

	_, err := server.AddTenantMember(newOperatorActorContext(uuid.Must(uuid.NewV7())), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByPublicIDForTenant)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "NOTFOUND").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	_, err := server.AddTenantMember(newOperatorActorContext(uuid.Must(uuid.NewV7())), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByPublicIDForTenant)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantUserRoles)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_admin"))
	mock.ExpectRollback()

	_, err := server.AddTenantMember(newOperatorActorContext(uuid.Must(uuid.NewV7())), connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{
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
	operatorID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByPublicIDForTenant)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantUserRoles)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_admin"))

	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteTenantUserRolesByUserID)).
		WithArgs(targetUserID).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateTenantUserRole)).
		WithArgs(sqlmock.AnyArg(), tenantID, targetUserID, "tenant_editor").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role", "created_at", "tenant_id"}).
			AddRow(uuid.Must(uuid.NewV7()), targetUserID, "tenant_editor", now, tenantID))
	expectTenantMemberAuditLogInsert(mock, operatorID, "tenant_member_role_updated", targetUserID)
	mock.ExpectCommit()

	resp, err := server.UpdateTenantMemberRole(newOperatorActorContext(operatorID), connect.NewRequest(&publirasplatformv1.UpdateTenantMemberRoleRequest{
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByPublicIDForTenant)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantUserRoles)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}))
	mock.ExpectRollback()

	_, err := server.UpdateTenantMemberRole(newOperatorActorContext(uuid.Must(uuid.NewV7())), connect.NewRequest(&publirasplatformv1.UpdateTenantMemberRoleRequest{
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
	operatorID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByPublicIDForTenant)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantUserRoles)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_admin"))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteTenantUserRolesByUserID)).
		WithArgs(targetUserID).
		WillReturnResult(sqlmock.NewResult(1, 1))
	expectTenantMemberAuditLogInsert(mock, operatorID, "tenant_member_removed", targetUserID)
	mock.ExpectCommit()

	resp, err := server.RemoveTenantMember(newOperatorActorContext(operatorID), connect.NewRequest(&publirasplatformv1.RemoveTenantMemberRequest{
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

// A change whose entry cannot be written is not committed either.
func TestRemoveTenantMemberRollsBackWhenItsEntryFails(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	targetUserID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByPublicIDForTenant)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnRows(sqlmock.NewRows(tenantScopedUserColumns()).
			AddRow(targetUserID, "USER000001", "Alice", "alice@example.com", "active", tenantID, now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListTenantUserRoles)).
		WithArgs(targetUserID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_admin"))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.DeleteTenantUserRolesByUserID)).
		WithArgs(targetUserID).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(dbmodels.InsertPlatformAuditLog)).
		WillReturnError(errors.New("connection reset"))
	mock.ExpectRollback()

	_, err := server.RemoveTenantMember(newOperatorActorContext(uuid.Must(uuid.NewV7())), connect.NewRequest(&publirasplatformv1.RemoveTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("RemoveTenantMember code = %v, want internal", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestRemoveTenantMemberNotFound(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantByPublicID)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "UTC", "ja"))

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetUserByPublicIDForTenant)).
		WithArgs(sql.NullString{String: tenantID.String(), Valid: true}, "USER000001").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	_, err := server.RemoveTenantMember(newOperatorActorContext(uuid.Must(uuid.NewV7())), connect.NewRequest(&publirasplatformv1.RemoveTenantMemberRequest{
		TenantPublicId: "TENANT001",
		UserPublicId:   "USER000001",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("RemoveTenantMember code = %v, want not_found", connect.CodeOf(err))
	}
	assertOperatorHandlerExpectations(t, mock)
}

// Each refusal names the request field publiractl names as a flag, and reads
// nothing first.
func TestPlatformTenantRPCsNameTheRefusedField(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name  string
		call  func(*platformServer) error
		field string
	}{
		{name: "get with no public ID", field: "public_id", call: func(s *platformServer) error {
			_, err := s.GetTenant(ctx, connect.NewRequest(&publirasplatformv1.GetTenantRequest{}))
			return err
		}},
		{name: "suspend with no public ID", field: "public_id", call: func(s *platformServer) error {
			_, err := s.SuspendTenant(ctx, connect.NewRequest(&publirasplatformv1.SuspendTenantRequest{PublicId: " "}))
			return err
		}},
		{name: "update with a blank name", field: "name", call: func(s *platformServer) error {
			_, err := s.UpdateTenant(ctx, connect.NewRequest(&publirasplatformv1.UpdateTenantRequest{PublicId: "TENANT001", Domain: "tenant.example.com"}))
			return err
		}},
		{name: "update with a blank domain", field: "domain", call: func(s *platformServer) error {
			_, err := s.UpdateTenant(ctx, connect.NewRequest(&publirasplatformv1.UpdateTenantRequest{PublicId: "TENANT001", Name: "Tenant"}))
			return err
		}},
		{name: "add a member with an unknown role", field: "role", call: func(s *platformServer) error {
			_, err := s.AddTenantMember(ctx, connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{TenantPublicId: "TENANT001", UserPublicId: "USER000001", Role: "owner"}))
			return err
		}},
		{name: "add a member by a malformed email", field: "email", call: func(s *platformServer) error {
			_, err := s.AddTenantMember(ctx, connect.NewRequest(&publirasplatformv1.AddTenantMemberRequest{TenantPublicId: "TENANT001", Email: "nobody", Role: "tenant_admin"}))
			return err
		}},
		{name: "change the role of no user", field: "user_public_id", call: func(s *platformServer) error {
			_, err := s.UpdateTenantMemberRole(ctx, connect.NewRequest(&publirasplatformv1.UpdateTenantMemberRoleRequest{TenantPublicId: "TENANT001", Role: "tenant_admin"}))
			return err
		}},
		{name: "remove no user", field: "user_public_id", call: func(s *platformServer) error {
			_, err := s.RemoveTenantMember(ctx, connect.NewRequest(&publirasplatformv1.RemoveTenantMemberRequest{TenantPublicId: "TENANT001"}))
			return err
		}},
		{name: "invite a malformed email", field: "email", call: func(s *platformServer) error {
			_, err := s.CreateTenantAdminInvitation(ctx, connect.NewRequest(&publirasplatformv1.CreateTenantAdminInvitationRequest{TenantPublicId: "TENANT001", Email: "nobody"}))
			return err
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)
			err := tc.call(server)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want invalid_argument (err = %v)", connect.CodeOf(err), err)
			}
			assertFieldViolation(t, err, tc.field)
			assertOperatorHandlerExpectations(t, mock)
		})
	}
}
