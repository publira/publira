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

	publiraadminv1 "github.com/publira/publira/server/internal/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/pagination"
)

func auditLogColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"tenant_id",
		"actor_user_id",
		"actor_role",
		"action",
		"target_type",
		"target_id",
		"outcome",
		"reason",
		"client_ip",
		"created_at",
		"actor_public_id",
		"actor_name",
	})
}

func addAuditLogRow(
	rows *sqlmock.Rows,
	id, tenantID, userID uuid.UUID,
	action, outcome string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(
		id,
		tenantID,
		userID,
		"editor",
		action,
		"series",
		"SERIES001",
		outcome,
		nil,
		"127.0.0.1",
		createdAt,
		"USER001",
		"User One",
	)
}

func newAuditLogClient(
	t *testing.T,
	tenantID, userID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminAuditLogServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	return publiraadminv1connect.NewAdminAuditLogServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newAuditLogRequest(tenantID uuid.UUID, sessionToken string) *connect.Request[publiraadminv1.ListAuditLogsRequest] {
	req := connect.NewRequest(&publiraadminv1.ListAuditLogsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func TestListAuditLogsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAuditLogClient(t, tenantID, userID, now)

	firstLogID := uuid.Must(uuid.NewV7())
	secondLogID := uuid.Must(uuid.NewV7())
	mock.ExpectQuery(regexp.QuoteMeta(listAuditLogsByTenantDescQuery)).
		WithArgs(
			tenantID,
			sql.NullString{},
			sql.NullString{},
			sql.NullTime{},
			sql.NullTime{},
			uuid.NullUUID{},
			false,
			sql.NullTime{},
			int32(21),
		).
		WillReturnRows(addAuditLogRow(
			addAuditLogRow(auditLogColumns(), firstLogID, tenantID, userID, "series_created", "success", now),
			secondLogID,
			tenantID,
			userID,
			"series_updated",
			"failure",
			now.Add(-time.Minute),
		))

	resp, err := client.ListAuditLogs(context.Background(), newAuditLogRequest(tenantID, sessionToken))
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	if len(resp.Msg.AuditLogs) != 2 {
		t.Fatalf("audit_logs count = %d, want 2", len(resp.Msg.AuditLogs))
	}
	if resp.Msg.AuditLogs[0].ActorUserPublicId != "USER001" {
		t.Fatalf("audit_logs[0].actor_user_public_id = %q, want USER001", resp.Msg.AuditLogs[0].ActorUserPublicId)
	}
	if resp.Msg.AuditLogs[1].Outcome != "failure" {
		t.Fatalf("audit_logs[1].outcome = %q, want failure", resp.Msg.AuditLogs[1].Outcome)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListAuditLogsFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAuditLogClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(listAuditLogsByTenantDescQuery)).
		WithArgs(tenantID, sql.NullString{}, sql.NullString{}, sql.NullTime{}, sql.NullTime{}, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addAuditLogRow(
			addAuditLogRow(
				addAuditLogRow(auditLogColumns(), ids[0], tenantID, userID, "first", "success", now),
				ids[1], tenantID, userID, "second", "success", now.Add(-time.Minute),
			),
			ids[2], tenantID, userID, "third", "success", now.Add(-2*time.Minute),
		))

	req := newAuditLogRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	resp, err := client.ListAuditLogs(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	if len(resp.Msg.AuditLogs) != 2 {
		t.Fatalf("audit_logs count = %d, want the over-fetched row dropped", len(resp.Msg.AuditLogs))
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

func TestListAuditLogsFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	client, mock, sessionToken := newAuditLogClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAuditLogsByTenantDescQuery)).
		WithArgs(tenantID, sql.NullString{}, sql.NullString{}, sql.NullTime{}, sql.NullTime{}, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addAuditLogRow(auditLogColumns(), uuid.Must(uuid.NewV7()), tenantID, userID, "last", "success", now.Add(-2*time.Minute)))

	req := newAuditLogRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Forward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAuditLogs(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListAuditLogsFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	client, mock, sessionToken := newAuditLogClient(t, tenantID, userID, now)
	olderID := uuid.Must(uuid.NewV7())
	newerID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(listAuditLogsByTenantAscQuery)).
		WithArgs(tenantID, sql.NullString{}, sql.NullString{}, sql.NullTime{}, sql.NullTime{}, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addAuditLogRow(
			addAuditLogRow(auditLogColumns(), olderID, tenantID, userID, "older", "success", now.Add(-2*time.Minute)),
			newerID, tenantID, userID, "newer", "success", now.Add(-time.Minute),
		))

	req := newAuditLogRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Backward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAuditLogs(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	actions := make([]string, 0, len(resp.Msg.AuditLogs))
	for _, log := range resp.Msg.AuditLogs {
		actions = append(actions, log.Action)
	}
	if !slices.Equal(actions, []string{"newer", "older"}) {
		t.Fatalf("actions = %v, want backward page restored to descending order", actions)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertExpectations(t, mock)
}

func TestListAuditLogsEmptyPageKeepsAWayBack(t *testing.T) {
	tests := []struct {
		name                 string
		direction            pagination.Direction
		wantQuery            string
		wantRecoveryQuery    string
		wantRecoveredActions []string
	}{
		{
			name:                 "forward",
			direction:            pagination.Forward,
			wantQuery:            listAuditLogsByTenantDescQuery,
			wantRecoveryQuery:    listAuditLogsByTenantAscQuery,
			wantRecoveredActions: []string{"newer", "boundary"},
		},
		{
			name:                 "backward",
			direction:            pagination.Backward,
			wantQuery:            listAuditLogsByTenantAscQuery,
			wantRecoveryQuery:    listAuditLogsByTenantDescQuery,
			wantRecoveredActions: []string{"boundary", "older"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newAuditLogClient(t, tenantID, userID, now)
			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, sql.NullString{}, sql.NullString{}, sql.NullTime{}, sql.NullTime{}, boundaryID, false, now, int32(21)).
				WillReturnRows(auditLogColumns())

			req := newAuditLogRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.Encode(test.direction, now.Format(time.RFC3339Nano), boundaryID.String())
			resp, err := client.ListAuditLogs(context.Background(), req)
			if err != nil {
				t.Fatalf("ListAuditLogs: %v", err)
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
			recoveryRows := auditLogColumns()
			if test.direction == pagination.Forward {
				recoveryRows = addAuditLogRow(recoveryRows, boundaryID, tenantID, userID, "boundary", "success", now)
				recoveryRows = addAuditLogRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, userID, "newer", "success", now.Add(time.Minute))
			} else {
				recoveryRows = addAuditLogRow(recoveryRows, boundaryID, tenantID, userID, "boundary", "success", now)
				recoveryRows = addAuditLogRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, userID, "older", "success", now.Add(-time.Minute))
			}
			mock.ExpectQuery(regexp.QuoteMeta(test.wantRecoveryQuery)).
				WithArgs(tenantID, sql.NullString{}, sql.NullString{}, sql.NullTime{}, sql.NullTime{}, boundaryID, true, now, int32(21)).
				WillReturnRows(recoveryRows)

			recoveryReq := newAuditLogRequest(tenantID, sessionToken)
			recoveryReq.Msg.Token = recoveryToken
			recovered, err := client.ListAuditLogs(context.Background(), recoveryReq)
			if err != nil {
				t.Fatalf("ListAuditLogs recovery: %v", err)
			}
			actions := make([]string, 0, len(recovered.Msg.AuditLogs))
			for _, log := range recovered.Msg.AuditLogs {
				actions = append(actions, log.Action)
			}
			if !slices.Equal(actions, test.wantRecoveredActions) {
				t.Fatalf("recovered actions = %v, want %v", actions, test.wantRecoveredActions)
			}
			assertExpectations(t, mock)
		})
	}
}

// Recovery happens once. When the boundary row itself is gone the recovery
// query is empty too, and both tokens stay empty so the client falls back to
// the first page instead of bouncing between empty pages.
func TestListAuditLogsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		wantQuery string
	}{
		{
			name:      "recovering backward",
			direction: pagination.Backward,
			wantQuery: listAuditLogsByTenantAscQuery,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: listAuditLogsByTenantDescQuery,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newAuditLogClient(t, tenantID, userID, now)
			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, sql.NullString{}, sql.NullString{}, sql.NullTime{}, sql.NullTime{}, boundaryID, true, now, int32(21)).
				WillReturnRows(auditLogColumns())

			req := newAuditLogRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.EncodeTimeUUIDRecovery(test.direction, now, boundaryID)
			resp, err := client.ListAuditLogs(context.Background(), req)
			if err != nil {
				t.Fatalf("ListAuditLogs: %v", err)
			}
			if len(resp.Msg.AuditLogs) != 0 {
				t.Fatalf("audit_logs = %d rows, want an empty page", len(resp.Msg.AuditLogs))
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

func TestListAuditLogsInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAuditLogClient(t, tenantID, userID, now)
	req := newAuditLogRequest(tenantID, sessionToken)
	req.Msg.Token = "not-a-valid-token"

	_, err := client.ListAuditLogs(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListAuditLogs code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("error = %q, want token internals hidden", err)
	}
	assertExpectations(t, mock)
}

func TestListAuditLogsDatabaseErrorIsHidden(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAuditLogClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAuditLogsByTenantDescQuery)).
		WithArgs(
			tenantID,
			sql.NullString{},
			sql.NullString{},
			sql.NullTime{},
			sql.NullTime{},
			uuid.NullUUID{},
			false,
			sql.NullTime{},
			int32(21),
		).
		WillReturnError(errors.New(`pq: relation "audit_logs" does not exist`))

	_, err := client.ListAuditLogs(context.Background(), newAuditLogRequest(tenantID, sessionToken))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListAuditLogs code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}
