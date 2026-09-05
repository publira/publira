package adminapi

import (
	"context"
	"database/sql"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	listTenantUsersAscQuery  = "-- name: ListTenantUsersAsc :many\n"
	listTenantUsersDescQuery = "-- name: ListTenantUsersDesc :many\n"
)

func tenantUserColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"user_id", "public_id", "name", "role", "created_at"})
}

func addTenantUserRow(
	rows *sqlmock.Rows,
	id uuid.UUID,
	publicID, name string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(id, publicID, name, "tenant_editor", createdAt)
}

func newTenantUserClient(
	t *testing.T,
	tenantID, actorID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminUserServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")
	return publiraadminv1connect.NewAdminUserServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newTenantUserRequest(tenantID uuid.UUID, sessionToken string) *connect.Request[publiraadminv1.ListTenantUsersRequest] {
	req := connect.NewRequest(&publiraadminv1.ListTenantUsersRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func TestListTenantUsersAppliesRequestedLimit(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newTenantUserClient(t, tenantID, actorID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	// limit 2 must reach the query as limit+1, not the page-size maximum.
	mock.ExpectQuery(regexp.QuoteMeta(listTenantUsersDescQuery)).
		WithArgs(
			uuid.NullUUID{UUID: tenantID, Valid: true},
			sql.NullString{},
			uuid.NullUUID{},
			false,
			sql.NullTime{},
			int32(3),
		).
		WillReturnRows(addTenantUserRow(
			addTenantUserRow(
				addTenantUserRow(tenantUserColumns(), ids[0], "USER001", "First", now),
				ids[1], "USER002", "Second", now.Add(-time.Minute),
			),
			ids[2], "USER003", "Third", now.Add(-2*time.Minute),
		))

	req := newTenantUserRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	resp, err := client.ListTenantUsers(context.Background(), req)
	if err != nil {
		t.Fatalf("ListTenantUsers: %v", err)
	}
	if len(resp.Msg.Users) != 2 {
		t.Fatalf("users count = %d, want the over-fetched row dropped", len(resp.Msg.Users))
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

	assertExpectations(t, mock)
}

func TestListTenantUsersFallsBackToDefaultLimit(t *testing.T) {
	tests := []struct {
		name      string
		requested int32
	}{
		{name: "unset", requested: 0},
		{name: "negative", requested: -1},
		{name: "above maximum", requested: maxTenantUserListLimit + 1},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newTenantUserClient(t, tenantID, actorID, now)

			mock.ExpectQuery(regexp.QuoteMeta(listTenantUsersDescQuery)).
				WithArgs(
					uuid.NullUUID{UUID: tenantID, Valid: true},
					sql.NullString{},
					uuid.NullUUID{},
					false,
					sql.NullTime{},
					defaultTenantUserListLimit+1,
				).
				WillReturnRows(tenantUserColumns())

			req := newTenantUserRequest(tenantID, sessionToken)
			req.Msg.Limit = testCase.requested
			resp, err := client.ListTenantUsers(context.Background(), req)
			if err != nil {
				t.Fatalf("ListTenantUsers: %v", err)
			}

			// An empty first page carries no boundary to recover to, so neither
			// token may be issued: a recovery token built from the zero cursor
			// would point at the epoch.
			if resp.Msg.PreviousToken != "" {
				t.Fatalf("previous_token = %q, want empty on an empty first page", resp.Msg.PreviousToken)
			}
			if resp.Msg.NextToken != "" {
				t.Fatalf("next_token = %q, want empty on an empty first page", resp.Msg.NextToken)
			}

			assertExpectations(t, mock)
		})
	}
}

func TestListTenantUsersFiltersByQueryInSQL(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	userID := uuid.Must(uuid.NewV7())
	client, mock, sessionToken := newTenantUserClient(t, tenantID, actorID, now)

	// The keyword goes to the database so that a match beyond the first page is
	// still found, instead of being filtered out of an already-fetched page.
	mock.ExpectQuery(regexp.QuoteMeta(listTenantUsersDescQuery)).
		WithArgs(
			uuid.NullUUID{UUID: tenantID, Valid: true},
			sql.NullString{String: "Editor", Valid: true},
			uuid.NullUUID{},
			false,
			sql.NullTime{},
			defaultTenantUserListLimit+1,
		).
		WillReturnRows(addTenantUserRow(tenantUserColumns(), userID, "USER001", "Editor Taro", now))

	req := newTenantUserRequest(tenantID, sessionToken)
	req.Msg.Query = "  Editor  "
	resp, err := client.ListTenantUsers(context.Background(), req)
	if err != nil {
		t.Fatalf("ListTenantUsers: %v", err)
	}
	if len(resp.Msg.Users) != 1 || resp.Msg.Users[0].PublicId != "USER001" {
		t.Fatalf("users = %+v, want the matching row", resp.Msg.Users)
	}

	assertExpectations(t, mock)
}

func TestListTenantUsersFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	olderID := uuid.Must(uuid.NewV7())
	newerID := uuid.Must(uuid.NewV7())
	olderAt := now.Add(-2 * time.Minute)
	newerAt := now.Add(-time.Minute)
	client, mock, sessionToken := newTenantUserClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantUsersAscQuery)).
		WithArgs(
			uuid.NullUUID{UUID: tenantID, Valid: true},
			sql.NullString{},
			uuid.NullUUID{UUID: boundaryID, Valid: true},
			false,
			sql.NullTime{Time: boundaryAt, Valid: true},
			int32(3),
		).
		WillReturnRows(addTenantUserRow(
			addTenantUserRow(tenantUserColumns(), olderID, "USER002", "Older", olderAt),
			newerID, "USER001", "Newer", newerAt,
		))

	req := newTenantUserRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Backward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListTenantUsers(context.Background(), req)
	if err != nil {
		t.Fatalf("ListTenantUsers: %v", err)
	}
	names := make([]string, 0, len(resp.Msg.Users))
	for _, user := range resp.Msg.Users {
		names = append(names, user.Name)
	}
	if !slices.Equal(names, []string{"Newer", "Older"}) {
		t.Fatalf("names = %v, want backward page restored to descending order", names)
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

	assertExpectations(t, mock)
}

func TestListTenantUsersEmptyPageKeepsAWayBack(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	client, mock, sessionToken := newTenantUserClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantUsersDescQuery)).
		WithArgs(
			uuid.NullUUID{UUID: tenantID, Valid: true},
			sql.NullString{},
			uuid.NullUUID{UUID: boundaryID, Valid: true},
			false,
			sql.NullTime{Time: boundaryAt, Valid: true},
			defaultTenantUserListLimit+1,
		).
		WillReturnRows(tenantUserColumns())

	req := newTenantUserRequest(tenantID, sessionToken)
	req.Msg.Token = pagination.Encode(pagination.Forward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListTenantUsers(context.Background(), req)
	if err != nil {
		t.Fatalf("ListTenantUsers: %v", err)
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

	assertExpectations(t, mock)
}

func TestListTenantUsersRejectsBrokenToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newTenantUserClient(t, tenantID, actorID, now)

	req := newTenantUserRequest(tenantID, sessionToken)
	req.Msg.Token = "not-a-token"
	if _, err := client.ListTenantUsers(context.Background(), req); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListTenantUsers code = %v, want invalid_argument", connect.CodeOf(err))
	}

	assertExpectations(t, mock)
}
