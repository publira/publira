package adminapi

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

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	listCreatorsByTenantAscQuery       = "-- name: ListCreatorsByTenantAsc :many\n"
	listCreatorsByTenantDescQuery      = "-- name: ListCreatorsByTenantDesc :many\n"
	getCreatorByPublicIDForTenantQuery = "-- name: GetCreatorByPublicIDForTenant :one\n"
	listLabelsByTenantAscQuery         = "-- name: ListLabelsByTenantAsc :many\n"
	listLabelsByTenantDescQuery        = "-- name: ListLabelsByTenantDesc :many\n"
)

func creatorColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"tenant_id",
		"public_id",
		"name",
		"profile_text",
		"created_at",
		"icon_image_id",
		"icon_image_updated_at",
		"icon_image_file_size_bytes",
		"icon_image_width",
		"icon_image_height",
	})
}

func addCreatorRow(
	rows *sqlmock.Rows,
	id, tenantID uuid.UUID,
	publicID, name string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(id, tenantID, publicID, name, "profile", createdAt, nil, nil, int64(0), int32(0), int32(0))
}

func newCreatorClient(
	t *testing.T,
	tenantID, userID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminCreatorServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	return publiraadminv1connect.NewAdminCreatorServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newCreatorRequest(tenantID uuid.UUID, sessionToken string) *connect.Request[publiraadminv1.ListCreatorsRequest] {
	req := connect.NewRequest(&publiraadminv1.ListCreatorsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func labelColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"tenant_id",
		"public_id",
		"name",
		"created_at",
		"eye_catch_image_id",
		"eye_catch_image_updated_at",
	})
}

func addLabelRow(
	rows *sqlmock.Rows,
	id, tenantID uuid.UUID,
	publicID, name string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(id, tenantID, publicID, name, createdAt, nil, nil)
}

func newLabelClient(
	t *testing.T,
	tenantID, userID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminLabelServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	return publiraadminv1connect.NewAdminLabelServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newLabelRequest(tenantID uuid.UUID, sessionToken string) *connect.Request[publiraadminv1.ListLabelsRequest] {
	req := connect.NewRequest(&publiraadminv1.ListLabelsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func TestListCreatorsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newCreatorClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listCreatorsByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addCreatorRow(creatorColumns(), uuid.Must(uuid.NewV7()), tenantID, "CREATOR001", "Creator One", now))

	resp, err := client.ListCreators(context.Background(), newCreatorRequest(tenantID, sessionToken))
	if err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	if len(resp.Msg.Creators) != 1 {
		t.Fatalf("creators count = %d, want 1", len(resp.Msg.Creators))
	}
	if resp.Msg.Creators[0].PublicId != "CREATOR001" {
		t.Fatalf("creator public_id = %q, want CREATOR001", resp.Msg.Creators[0].PublicId)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListCreatorsFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newCreatorClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(listCreatorsByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addCreatorRow(
			addCreatorRow(
				addCreatorRow(creatorColumns(), ids[0], tenantID, "CREATOR001", "First", now),
				ids[1], tenantID, "CREATOR002", "Second", now.Add(-time.Minute),
			),
			ids[2], tenantID, "CREATOR003", "Third", now.Add(-2*time.Minute),
		))

	req := newCreatorRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	resp, err := client.ListCreators(context.Background(), req)
	if err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	if len(resp.Msg.Creators) != 2 {
		t.Fatalf("creators count = %d, want the over-fetched row dropped", len(resp.Msg.Creators))
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

func TestListCreatorsFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	client, mock, sessionToken := newCreatorClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listCreatorsByTenantDescQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addCreatorRow(creatorColumns(), uuid.Must(uuid.NewV7()), tenantID, "CREATOR003", "Last", now.Add(-2*time.Minute)))

	req := newCreatorRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID)
	resp, err := client.ListCreators(context.Background(), req)
	if err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListCreatorsFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	client, mock, sessionToken := newCreatorClient(t, tenantID, userID, now)
	olderID := uuid.Must(uuid.NewV7())
	newerID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(listCreatorsByTenantAscQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addCreatorRow(
			addCreatorRow(creatorColumns(), olderID, tenantID, "CREATOR002", "Older", now.Add(-2*time.Minute)),
			newerID, tenantID, "CREATOR001", "Newer", now.Add(-time.Minute),
		))

	req := newCreatorRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.EncodeTimeUUID(pagination.Backward, boundaryAt, boundaryID)
	resp, err := client.ListCreators(context.Background(), req)
	if err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	publicIDs := make([]string, 0, len(resp.Msg.Creators))
	for _, creator := range resp.Msg.Creators {
		publicIDs = append(publicIDs, creator.PublicId)
	}
	if !slices.Equal(publicIDs, []string{"CREATOR001", "CREATOR002"}) {
		t.Fatalf("public_ids = %v, want backward page restored to descending order", publicIDs)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertExpectations(t, mock)
}

func TestListCreatorsEmptyPageKeepsAWayBack(t *testing.T) {
	tests := []struct {
		name              string
		direction         pagination.Direction
		wantQuery         string
		recoveryDirection pagination.Direction
	}{
		{
			name:              "forward",
			direction:         pagination.Forward,
			wantQuery:         listCreatorsByTenantDescQuery,
			recoveryDirection: pagination.Backward,
		},
		{
			name:              "backward",
			direction:         pagination.Backward,
			wantQuery:         listCreatorsByTenantAscQuery,
			recoveryDirection: pagination.Forward,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newCreatorClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, false, now, int32(21)).
				WillReturnRows(creatorColumns())

			req := newCreatorRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.EncodeTimeUUID(test.direction, now, boundaryID)
			resp, err := client.ListCreators(context.Background(), req)
			if err != nil {
				t.Fatalf("ListCreators: %v", err)
			}
			recoveryToken := resp.Msg.PreviousToken
			if test.direction == pagination.Backward {
				recoveryToken = resp.Msg.NextToken
			}
			wantRecoveryToken := pagination.EncodeTimeUUIDRecovery(test.recoveryDirection, now, boundaryID)
			if recoveryToken != wantRecoveryToken {
				t.Fatalf("recovery token = %q, want %q", recoveryToken, wantRecoveryToken)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestListCreatorsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	client, mock, sessionToken := newCreatorClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listCreatorsByTenantAscQuery)).
		WithArgs(tenantID, boundaryID, true, now, int32(21)).
		WillReturnRows(creatorColumns())

	req := newCreatorRequest(tenantID, sessionToken)
	req.Msg.Token = pagination.EncodeTimeUUIDRecovery(pagination.Backward, now, boundaryID)
	resp, err := client.ListCreators(context.Background(), req)
	if err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	if len(resp.Msg.Creators) != 0 {
		t.Fatalf("creators = %d rows, want an empty page", len(resp.Msg.Creators))
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty once recovery also came back empty", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListCreatorsRejectsInvalidToken(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "invalid encoding", token: "not-a-valid-token"},
		{name: "invalid key", token: pagination.Encode(pagination.Forward, "not-a-time", uuid.Must(uuid.NewV7()).String())},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			client, mock, sessionToken := newCreatorClient(t, tenantID, userID, now)
			req := newCreatorRequest(tenantID, sessionToken)
			req.Msg.Token = test.token

			_, err := client.ListCreators(context.Background(), req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("ListCreators code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
			}
			if err.Error() != "invalid_argument: token is invalid" {
				t.Fatalf("error = %q, want token internals hidden", err)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestListCreatorsDatabaseErrorIsHidden(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newCreatorClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listCreatorsByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnError(errors.New(`pq: relation "creators" does not exist`))

	_, err := client.ListCreators(context.Background(), newCreatorRequest(tenantID, sessionToken))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListCreators code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}

func TestListCreatorsLimitOutOfRangeUsesDefault(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newCreatorClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listCreatorsByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(creatorColumns())

	req := newCreatorRequest(tenantID, sessionToken)
	req.Msg.Limit = 101
	if _, err := client.ListCreators(context.Background(), req); err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	assertExpectations(t, mock)
}

func TestCreateCreatorValidationAndSuccess(t *testing.T) {
	tests := []struct {
		name     string
		request  *publiraadminv1.CreateCreatorRequest
		setup    func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time)
		wantCode connect.Code
	}{
		{
			name: "invalid-name",
			request: &publiraadminv1.CreateCreatorRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: ""},
				Name:   "   ",
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "success",
			request: &publiraadminv1.CreateCreatorRequest{
				Tenant:      &publirattypesv1.TenantContext{TenantId: ""},
				Name:        "Creator One",
				ProfileText: "profile",
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time) {
				mock.ExpectQuery("INSERT INTO creators").
					WithArgs(sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), "Creator One", sql.NullString{String: "profile", Valid: true}, uuid.NullUUID{}).
					WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id"}).
						AddRow(uuid.Must(uuid.NewV7()), tenantID, "CREATOR001", "Creator One", "profile", now, nil))
				mock.ExpectQuery("FROM creators").
					WithArgs(tenantID, "CREATOR001").
					WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id", "icon_image_updated_at", "icon_image_file_size_bytes", "icon_image_width", "icon_image_height"}).
						AddRow(uuid.Must(uuid.NewV7()), tenantID, "CREATOR001", "Creator One", "profile", now, nil, nil, int64(0), int32(0), int32(0)))
				expectAdminAuditLogInsert(mock)
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

			expectTenantLookup(mock, tenantID, "TENANT", now)
			if tc.request != nil && tc.request.Tenant != nil {
				tc.request.Tenant.TenantId = tenantID.String()
			}
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminCreatorServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(tc.request)
			req.Header().Set("Authorization", "Bearer "+sessionToken)

			resp, err := client.CreateCreator(context.Background(), req)
			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("CreateCreator: %v", err)
				}
				if resp.Msg.Creator == nil {
					t.Fatalf("creator is nil")
				}
				if resp.Msg.Creator.PublicId != "CREATOR001" {
					t.Fatalf("creator public_id = %q, want CREATOR001", resp.Msg.Creator.PublicId)
				}
			} else if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("CreateCreator code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestUpdateCreatorSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	creatorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, "CREATOR001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id", "icon_image_updated_at", "icon_image_file_size_bytes", "icon_image_width", "icon_image_height"}).
			AddRow(creatorID, tenantID, "CREATOR001", "Before", "old", now, nil, nil, int64(0), int32(0), int32(0)))
	mock.ExpectExec("UPDATE creators").
		WithArgs(creatorID, "After", sql.NullString{String: "new", Valid: true}, uuid.NullUUID{}).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("FROM creators").
		WithArgs(tenantID, "CREATOR001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id", "icon_image_updated_at", "icon_image_file_size_bytes", "icon_image_width", "icon_image_height"}).
			AddRow(creatorID, tenantID, "CREATOR001", "After", "new", now, nil, nil, int64(0), int32(0), int32(0)))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminCreatorServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateCreatorRequest{
		Tenant:      &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId:    "CREATOR001",
		Name:        "After",
		ProfileText: "new",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.UpdateCreator(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateCreator: %v", err)
	}
	if resp.Msg.Creator == nil {
		t.Fatalf("creator is nil")
	}
	if resp.Msg.Creator.Name != "After" {
		t.Fatalf("creator name = %q, want After", resp.Msg.Creator.Name)
	}
	assertExpectations(t, mock)
}

func TestGetCreatorSuccessAndNotFound(t *testing.T) {
	tests := []struct {
		name          string
		publicID      string
		rows          *sqlmock.Rows
		wantCode      connect.Code
		wantCreatorID string
	}{
		{
			name:     "normal",
			publicID: "CREATOR001",
			rows: sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id", "icon_image_updated_at", "icon_image_file_size_bytes", "icon_image_width", "icon_image_height"}).
				AddRow(uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), "CREATOR001", "Aoi Sakura", "Draws things", time.Now(), nil, nil, int64(0), int32(0), int32(0)),
			wantCreatorID: "CREATOR001",
		},
		{
			// Another tenant's creator is filtered out by tenant_id, so it is
			// indistinguishable from a missing one.
			name:     "cross-tenant",
			publicID: "CREATOR_OTHER_TENANT",
			rows:     sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id", "icon_image_updated_at", "icon_image_file_size_bytes", "icon_image_width", "icon_image_height"}),
			wantCode: connect.CodeNotFound,
		},
		{
			name:     "not-found",
			publicID: "CREATOR_MISSING",
			rows:     sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "profile_text", "created_at", "icon_image_id", "icon_image_updated_at", "icon_image_file_size_bytes", "icon_image_width", "icon_image_height"}),
			wantCode: connect.CodeNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now()
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			mock.ExpectQuery(regexp.QuoteMeta(getCreatorByPublicIDForTenantQuery)).
				WithArgs(tenantID, tc.publicID).
				WillReturnRows(tc.rows)

			client := publiraadminv1connect.NewAdminCreatorServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(&publiraadminv1.GetCreatorRequest{
				Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
				PublicId: tc.publicID,
			})
			req.Header().Set("Authorization", "Bearer "+sessionToken)

			resp, err := client.GetCreator(context.Background(), req)
			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("GetCreator: %v", err)
				}
				if resp.Msg.Creator == nil {
					t.Fatalf("creator is nil")
				}
				if resp.Msg.Creator.PublicId != tc.wantCreatorID {
					t.Fatalf("creator public_id = %q, want %q", resp.Msg.Creator.PublicId, tc.wantCreatorID)
				}
			} else if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("GetCreator code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestListLabelsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newLabelClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listLabelsByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addLabelRow(labelColumns(), uuid.Must(uuid.NewV7()), tenantID, "LABEL001", "Weekly", now))

	resp, err := client.ListLabels(context.Background(), newLabelRequest(tenantID, sessionToken))
	if err != nil {
		t.Fatalf("ListLabels: %v", err)
	}
	if len(resp.Msg.Labels) != 1 {
		t.Fatalf("labels count = %d, want 1", len(resp.Msg.Labels))
	}
	if resp.Msg.Labels[0].PublicId != "LABEL001" {
		t.Fatalf("label public_id = %q, want LABEL001", resp.Msg.Labels[0].PublicId)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListLabelsFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newLabelClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(listLabelsByTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addLabelRow(
			addLabelRow(
				addLabelRow(labelColumns(), ids[0], tenantID, "LABEL001", "First", now),
				ids[1], tenantID, "LABEL002", "Second", now.Add(-time.Minute),
			),
			ids[2], tenantID, "LABEL003", "Third", now.Add(-2*time.Minute),
		))

	req := newLabelRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	resp, err := client.ListLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListLabels: %v", err)
	}
	if len(resp.Msg.Labels) != 2 {
		t.Fatalf("labels count = %d, want the over-fetched row dropped", len(resp.Msg.Labels))
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

func TestListLabelsFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	client, mock, sessionToken := newLabelClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listLabelsByTenantDescQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addLabelRow(labelColumns(), uuid.Must(uuid.NewV7()), tenantID, "LABEL003", "Last", now.Add(-2*time.Minute)))

	req := newLabelRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Forward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListLabels: %v", err)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListLabelsFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	client, mock, sessionToken := newLabelClient(t, tenantID, userID, now)
	olderID := uuid.Must(uuid.NewV7())
	newerID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(listLabelsByTenantAscQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addLabelRow(
			addLabelRow(labelColumns(), olderID, tenantID, "LABEL002", "Older", now.Add(-2*time.Minute)),
			newerID, tenantID, "LABEL001", "Newer", now.Add(-time.Minute),
		))

	req := newLabelRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Backward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListLabels(context.Background(), req)
	if err != nil {
		t.Fatalf("ListLabels: %v", err)
	}
	publicIDs := make([]string, 0, len(resp.Msg.Labels))
	for _, label := range resp.Msg.Labels {
		publicIDs = append(publicIDs, label.PublicId)
	}
	if !slices.Equal(publicIDs, []string{"LABEL001", "LABEL002"}) {
		t.Fatalf("public_ids = %v, want backward page restored to descending order", publicIDs)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertExpectations(t, mock)
}

func TestListLabelsEmptyPageKeepsAWayBack(t *testing.T) {
	tests := []struct {
		name                string
		direction           pagination.Direction
		wantQuery           string
		wantRecoveryQuery   string
		wantRecoveredLabels []string
	}{
		{
			name:                "forward",
			direction:           pagination.Forward,
			wantQuery:           listLabelsByTenantDescQuery,
			wantRecoveryQuery:   listLabelsByTenantAscQuery,
			wantRecoveredLabels: []string{"LABEL001", "LABEL002"},
		},
		{
			name:                "backward",
			direction:           pagination.Backward,
			wantQuery:           listLabelsByTenantAscQuery,
			wantRecoveryQuery:   listLabelsByTenantDescQuery,
			wantRecoveredLabels: []string{"LABEL002", "LABEL003"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newLabelClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, false, now, int32(21)).
				WillReturnRows(labelColumns())

			req := newLabelRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.Encode(test.direction, now.Format(time.RFC3339Nano), boundaryID.String())
			resp, err := client.ListLabels(context.Background(), req)
			if err != nil {
				t.Fatalf("ListLabels: %v", err)
			}
			recoveryToken := resp.Msg.PreviousToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.Msg.NextToken
				recoveryDirection = pagination.Forward
			}
			wantRecoveryToken := pagination.EncodeTimeUUIDRecovery(recoveryDirection, now, boundaryID)
			if recoveryToken != wantRecoveryToken {
				t.Fatalf("recovery token = %q, want %q", recoveryToken, wantRecoveryToken)
			}

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			recoveryRows := labelColumns()
			if test.direction == pagination.Forward {
				recoveryRows = addLabelRow(recoveryRows, boundaryID, tenantID, "LABEL002", "Boundary", now)
				recoveryRows = addLabelRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, "LABEL001", "Newer", now.Add(time.Minute))
			} else {
				recoveryRows = addLabelRow(recoveryRows, boundaryID, tenantID, "LABEL002", "Boundary", now)
				recoveryRows = addLabelRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, "LABEL003", "Older", now.Add(-time.Minute))
			}
			mock.ExpectQuery(regexp.QuoteMeta(test.wantRecoveryQuery)).
				WithArgs(tenantID, boundaryID, true, now, int32(21)).
				WillReturnRows(recoveryRows)

			recoveryReq := newLabelRequest(tenantID, sessionToken)
			recoveryReq.Msg.Token = recoveryToken
			recovered, err := client.ListLabels(context.Background(), recoveryReq)
			if err != nil {
				t.Fatalf("ListLabels recovery: %v", err)
			}
			publicIDs := make([]string, 0, len(recovered.Msg.Labels))
			for _, label := range recovered.Msg.Labels {
				publicIDs = append(publicIDs, label.PublicId)
			}
			if !slices.Equal(publicIDs, test.wantRecoveredLabels) {
				t.Fatalf("recovered public_ids = %v, want %v", publicIDs, test.wantRecoveredLabels)
			}
			assertExpectations(t, mock)
		})
	}
}

// Recovery happens once. When the boundary row itself is gone the recovery
// query is empty too, and both tokens stay empty so the client falls back to
// the first page instead of bouncing between empty pages.
func TestListLabelsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		wantQuery string
	}{
		{
			name:      "recovering backward",
			direction: pagination.Backward,
			wantQuery: listLabelsByTenantAscQuery,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: listLabelsByTenantDescQuery,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newLabelClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, true, now, int32(21)).
				WillReturnRows(labelColumns())

			req := newLabelRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.EncodeTimeUUIDRecovery(test.direction, now, boundaryID)
			resp, err := client.ListLabels(context.Background(), req)
			if err != nil {
				t.Fatalf("ListLabels: %v", err)
			}
			if len(resp.Msg.Labels) != 0 {
				t.Fatalf("labels = %d rows, want an empty page", len(resp.Msg.Labels))
			}
			if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
				t.Fatalf(
					"previous_token = %q / next_token = %q, want both empty once recovery also came back empty",
					resp.Msg.PreviousToken, resp.Msg.NextToken,
				)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestListLabelsInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newLabelClient(t, tenantID, userID, now)
	req := newLabelRequest(tenantID, sessionToken)
	req.Msg.Token = "not-a-valid-token"

	_, err := client.ListLabels(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListLabels code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("error = %q, want token internals hidden", err)
	}
	assertExpectations(t, mock)
}

func TestCreateLabelValidationAndSuccess(t *testing.T) {
	tests := []struct {
		name     string
		request  *publiraadminv1.CreateLabelRequest
		setup    func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time)
		wantCode connect.Code
	}{
		{
			name: "invalid-name",
			request: &publiraadminv1.CreateLabelRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: ""},
				Name:   "   ",
			},
			wantCode: connect.CodeInvalidArgument,
		},
		{
			name: "success",
			request: &publiraadminv1.CreateLabelRequest{
				Tenant: &publirattypesv1.TenantContext{TenantId: ""},
				Name:   "Weekly",
			},
			setup: func(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time) {
				mock.ExpectQuery("INSERT INTO labels").
					WithArgs(sqlmock.AnyArg(), tenantID, sqlmock.AnyArg(), "Weekly", uuid.NullUUID{}).
					WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id"}).
						AddRow(uuid.Must(uuid.NewV7()), tenantID, "LABEL001", "Weekly", now, nil))
				mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
					WithArgs(tenantID, "LABEL001").
					WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"}).
						AddRow(uuid.Must(uuid.NewV7()), tenantID, "LABEL001", "Weekly", now, nil, nil))
				expectAdminAuditLogInsert(mock)
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			testServer, mock := newTestAdminServer(t)

			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

			expectTenantLookup(mock, tenantID, "TENANT", now)
			if tc.request != nil && tc.request.Tenant != nil {
				tc.request.Tenant.TenantId = tenantID.String()
			}
			expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
			if tc.setup != nil {
				tc.setup(mock, tenantID, now)
			}

			client := publiraadminv1connect.NewAdminLabelServiceClient(testServer.Client(), testServer.URL)
			req := connect.NewRequest(tc.request)
			req.Header().Set("Authorization", "Bearer "+sessionToken)

			resp, err := client.CreateLabel(context.Background(), req)
			if tc.wantCode == 0 {
				if err != nil {
					t.Fatalf("CreateLabel: %v", err)
				}
				if resp.Msg.Label == nil {
					t.Fatalf("label is nil")
				}
				if resp.Msg.Label.PublicId != "LABEL001" {
					t.Fatalf("label public_id = %q, want LABEL001", resp.Msg.Label.PublicId)
				}
			} else if connect.CodeOf(err) != tc.wantCode {
				t.Fatalf("CreateLabel code = %v, want %v", connect.CodeOf(err), tc.wantCode)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestUpdateLabelSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	labelID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
		WithArgs(tenantID, "LABEL001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"}).
			AddRow(labelID, tenantID, "LABEL001", "Before", now, nil, nil))
	mock.ExpectExec("UPDATE labels").
		WithArgs(labelID, "After", uuid.NullUUID{}).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(getLabelByPublicIDForTenantQuery)).
		WithArgs(tenantID, "LABEL001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "public_id", "name", "created_at", "eye_catch_image_id", "eye_catch_image_updated_at"}).
			AddRow(labelID, tenantID, "LABEL001", "After", now, nil, nil))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminLabelServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateLabelRequest{
		Tenant:   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId: "LABEL001",
		Name:     "After",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.UpdateLabel(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdateLabel: %v", err)
	}
	if resp.Msg.Label == nil {
		t.Fatalf("label is nil")
	}
	if resp.Msg.Label.Name != "After" {
		t.Fatalf("label name = %q, want After", resp.Msg.Label.Name)
	}
	assertExpectations(t, mock)
}

func TestUpdateLabelRejectsClearAndImageTogether(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminLabelServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.UpdateLabelRequest{
		Tenant:                   &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PublicId:                 "LABEL001",
		Name:                     "After",
		ClearEyeCatchImage:       true,
		EyeCatchImageData:        oneByOnePNG,
		EyeCatchImageContentType: "image/png",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.UpdateLabel(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateLabel code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}
