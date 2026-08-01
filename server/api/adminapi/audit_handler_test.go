package adminapi

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
)

func TestListAuditLogsSuccess(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken("TENANT", testUserPublicID, "editor")
	firstLogID := uuid.Must(uuid.NewV7())
	secondLogID := uuid.Must(uuid.NewV7())

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)
	mock.ExpectQuery(regexp.QuoteMeta(listAuditLogsByTenantQuery)).
		WithArgs(
			tenantID,
			sql.NullString{},
			sql.NullString{},
			sql.NullTime{},
			sql.NullTime{},
			sql.NullTime{},
			uuid.NullUUID{},
			int32(21),
		).
		WillReturnRows(sqlmock.NewRows([]string{
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
		}).
			AddRow(firstLogID, tenantID, userID, "editor", "series_created", "series", "SERIES001", "success", nil, "127.0.0.1", now, "USER001", "User One").
			AddRow(secondLogID, tenantID, userID, "editor", "series_updated", "series", "SERIES002", "failure", "validation_failed", "127.0.0.1", now.Add(-time.Minute), "USER001", "User One"))

	client := publiraadminv1connect.NewAdminAuditLogServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ListAuditLogsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.ListAuditLogs(context.Background(), req)
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
	if resp.Msg.NextCursor != "" {
		t.Fatalf("next_cursor = %q, want empty", resp.Msg.NextCursor)
	}
	assertExpectations(t, mock)
}

func TestListAuditLogsInvalidCursor(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken("TENANT", testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminAuditLogServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ListAuditLogsRequest{
		Cursor: "not-a-valid-cursor",
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.ListAuditLogs(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListAuditLogs code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}
