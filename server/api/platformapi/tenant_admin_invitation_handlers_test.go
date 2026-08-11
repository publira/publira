package platformapi

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

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	listTenantAdminInvitationsAscQuery  = "-- name: ListTenantAdminInvitationsAsc :many\n"
	listTenantAdminInvitationsDescQuery = "-- name: ListTenantAdminInvitationsDesc :many\n"
)

func tenantAdminInvitationColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"tenant_id",
		"email",
		"token_hash",
		"expires_at",
		"accepted_at",
		"canceled_at",
		"created_at",
		"updated_at",
	})
}

func addTenantAdminInvitationRow(
	rows *sqlmock.Rows,
	id, tenantID uuid.UUID,
	email string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(id, tenantID, email, "token-hash-"+id.String(), createdAt.Add(time.Hour), nil, nil, createdAt, createdAt)
}

func expectTenantForInvitationList(mock sqlmock.Sqlmock, tenantID uuid.UUID, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(testGetTenantByPublicIDQuery)).
		WithArgs("TENANT001").
		WillReturnRows(sqlmock.NewRows(tenantTestColumns()).
			AddRow(tenantID, "TENANT001", "tenant.example.com", "Test Tenant", nil, now, "active", nil, "Asia/Tokyo"))
}

func newTenantAdminInvitationListRequest() *connect.Request[publirasplatformv1.ListTenantAdminInvitationsRequest] {
	return connect.NewRequest(&publirasplatformv1.ListTenantAdminInvitationsRequest{TenantPublicId: "TENANT001"})
}

func TestListTenantAdminInvitationsFirstPageReportsNextToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}
	expectTenantForInvitationList(mock, tenantID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantAdminInvitationsDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addTenantAdminInvitationRow(
			addTenantAdminInvitationRow(
				addTenantAdminInvitationRow(tenantAdminInvitationColumns(), ids[0], tenantID, "first@example.com", now),
				ids[1], tenantID, "second@example.com", now.Add(-time.Minute),
			),
			ids[2], tenantID, "third@example.com", now.Add(-2*time.Minute),
		))

	req := newTenantAdminInvitationListRequest()
	req.Msg.Limit = 2
	resp, err := server.ListTenantAdminInvitations(context.Background(), req)
	if err != nil {
		t.Fatalf("ListTenantAdminInvitations: %v", err)
	}
	if len(resp.Msg.Invitations) != 2 {
		t.Fatalf("invitation count = %d, want the over-fetched row dropped", len(resp.Msg.Invitations))
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

func TestListTenantAdminInvitationsFollowsNextToken(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	expectTenantForInvitationList(mock, tenantID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantAdminInvitationsDescQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addTenantAdminInvitationRow(
			tenantAdminInvitationColumns(), uuid.Must(uuid.NewV7()), tenantID, "last@example.com", now.Add(-2*time.Minute),
		))

	req := newTenantAdminInvitationListRequest()
	req.Msg.Limit = 2
	req.Msg.Token = pagination.EncodeTimeUUID(pagination.Forward, boundaryAt, boundaryID)
	resp, err := server.ListTenantAdminInvitations(context.Background(), req)
	if err != nil {
		t.Fatalf("ListTenantAdminInvitations: %v", err)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the previous page")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListTenantAdminInvitationsFollowsPreviousTokenBackwards(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	expectTenantForInvitationList(mock, tenantID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listTenantAdminInvitationsAscQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addTenantAdminInvitationRow(
			addTenantAdminInvitationRow(
				tenantAdminInvitationColumns(), uuid.Must(uuid.NewV7()), tenantID, "older@example.com", now.Add(-2*time.Minute),
			),
			uuid.Must(uuid.NewV7()), tenantID, "newer@example.com", now.Add(-time.Minute),
		))

	req := newTenantAdminInvitationListRequest()
	req.Msg.Limit = 2
	req.Msg.Token = pagination.EncodeTimeUUID(pagination.Backward, boundaryAt, boundaryID)
	resp, err := server.ListTenantAdminInvitations(context.Background(), req)
	if err != nil {
		t.Fatalf("ListTenantAdminInvitations: %v", err)
	}
	emails := make([]string, 0, len(resp.Msg.Invitations))
	for _, invitation := range resp.Msg.Invitations {
		emails = append(emails, invitation.Email)
	}
	if !slices.Equal(emails, []string{"newer@example.com", "older@example.com"}) {
		t.Fatalf("emails = %v, want backward page restored to descending order", emails)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertOperatorHandlerExpectations(t, mock)
}

func TestListTenantAdminInvitationsEmptyPageReturnsOneRecoveryToken(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		query     string
	}{
		{name: "forward", direction: pagination.Forward, query: listTenantAdminInvitationsDescQuery},
		{name: "backward", direction: pagination.Backward, query: listTenantAdminInvitationsAscQuery},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)
			tenantID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			expectTenantForInvitationList(mock, tenantID, now)
			mock.ExpectQuery(regexp.QuoteMeta(test.query)).
				WithArgs(tenantID, boundaryID, false, now, int32(21)).
				WillReturnRows(tenantAdminInvitationColumns())

			req := newTenantAdminInvitationListRequest()
			req.Msg.Token = pagination.EncodeTimeUUID(test.direction, now, boundaryID)
			resp, err := server.ListTenantAdminInvitations(context.Background(), req)
			if err != nil {
				t.Fatalf("ListTenantAdminInvitations: %v", err)
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

func TestListTenantAdminInvitationsRejectsInvalidToken(t *testing.T) {
	tests := []string{
		"not-base64",
		pagination.Encode(pagination.Forward, "not-a-time", uuid.Must(uuid.NewV7()).String()),
		pagination.Encode(pagination.Forward, time.Now().Format(time.RFC3339Nano), uuid.Must(uuid.NewV7()).String(), "not-inclusive"),
	}

	for _, token := range tests {
		server, mock := newOperatorHandlerTestServer(t)
		req := newTenantAdminInvitationListRequest()
		req.Msg.Token = token
		_, err := server.ListTenantAdminInvitations(context.Background(), req)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("ListTenantAdminInvitations code = %v, want invalid_argument", connect.CodeOf(err))
		}
		assertOperatorHandlerExpectations(t, mock)
	}
}
