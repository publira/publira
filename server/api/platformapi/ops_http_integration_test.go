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
	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
)

func TestListOperators(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(integrationListPlatformOperatorsQuery)).
		WillReturnRows(sqlmock.NewRows(integrationOperatorColumns()).
			AddRow("PLATUSER001", "operator1@example.com", "Operator One", "platform_operator", "active", now).
			AddRow("PLATUSER002", "operator2@example.com", "Operator Two", "platform_auditor", "suspended", now))

	client := publirasplatformv1connect.NewPlatformOperatorServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListOperators(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.ListOperatorsRequest{}))
	if err != nil {
		t.Fatalf("ListOperators: %v", err)
	}
	if len(resp.Msg.Operators) != 2 {
		t.Fatalf("len(operators) = %d, want 2", len(resp.Msg.Operators))
	}
	if resp.Msg.Operators[1].Status != "suspended" {
		t.Fatalf("status = %q, want suspended", resp.Msg.Operators[1].Status)
	}
	assertIntegrationExpectations(t, mock)
}

func TestListAuditLogs(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	actorID1 := uuid.Must(uuid.NewV7())
	actorID2 := uuid.Must(uuid.NewV7())
	targetOperatorID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(integrationListAdminAuditLogsQuery)).
		WithArgs(sql.NullString{}, sql.NullString{}, sql.NullString{}, int32(0), int32(20)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "actor_platform_user_id", "actor_role", "action", "target_type", "target_id", "outcome", "reason", "client_ip", "created_at", "actor_name", "actor_public_id", "tenant_name", "tenant_public_id", "target_public_id", "target_name"}).
			AddRow(uuid.Must(uuid.NewV7()), actorID1, "platform_operator", "tenant_created", "tenant", tenantID.String(), "success", nil, "203.0.113.10", now, "Operator One", "PLATUSER001", "Tenant One", "TENANT001", "TENANT001", "Tenant One").
			AddRow(uuid.Must(uuid.NewV7()), actorID2, "platform_super_admin", "operator_updated", "operator", targetOperatorID.String(), "success", nil, nil, now.Add(-time.Minute), "Operator Two", "PLATUSER002", "", "", "PLATUSER003", "Operator Three"))

	client := publirasplatformv1connect.NewPlatformAuditLogServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListAuditLogs(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.ListAuditLogsRequest{}))
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	if len(resp.Msg.AuditLogs) != 2 {
		t.Fatalf("len(audit_logs) = %d, want 2", len(resp.Msg.AuditLogs))
	}
	if resp.Msg.AuditLogs[0].TenantPublicId != "TENANT001" {
		t.Fatalf("audit_logs[0].tenant_public_id = %q, want TENANT001", resp.Msg.AuditLogs[0].TenantPublicId)
	}
	if resp.Msg.AuditLogs[1].TargetId != targetOperatorID.String() {
		t.Fatalf("audit_logs[1].target_id = %q, want %s", resp.Msg.AuditLogs[1].TargetId, targetOperatorID.String())
	}
	assertIntegrationExpectations(t, mock)
}

func TestListAuditLogsWithFilters(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(integrationListAdminAuditLogsQuery)).
		WithArgs(sql.NullString{String: "PLATUSER001", Valid: true}, sql.NullString{String: "TENANT001", Valid: true}, sql.NullString{String: "tenant_created", Valid: true}, int32(5), int32(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "actor_platform_user_id", "actor_role", "action", "target_type", "target_id", "outcome", "reason", "client_ip", "created_at", "actor_name", "actor_public_id", "tenant_name", "tenant_public_id", "target_public_id", "target_name"}).
			AddRow(uuid.Must(uuid.NewV7()), actorID, "platform_operator", "tenant_created", "tenant", tenantID.String(), "success", nil, nil, now, "Operator One", "PLATUSER001", "Tenant One", "TENANT001", "TENANT001", "Tenant One"))

	client := publirasplatformv1connect.NewPlatformAuditLogServiceClient(ts.Client(), ts.URL)
	resp, err := client.ListAuditLogs(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.ListAuditLogsRequest{Limit: 10, Offset: 5, TenantPublicId: "TENANT001", ActorUserPublicId: "PLATUSER001", Action: "tenant_created"}))
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	if len(resp.Msg.AuditLogs) != 1 {
		t.Fatalf("len(audit_logs) = %d, want 1", len(resp.Msg.AuditLogs))
	}
	if resp.Msg.AuditLogs[0].Action != "tenant_created" {
		t.Fatalf("audit_logs[0].action = %q, want tenant_created", resp.Msg.AuditLogs[0].Action)
	}
	assertIntegrationExpectations(t, mock)
}

func TestListAuditLogsClampLimit(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(integrationListAdminAuditLogsQuery)).
		WithArgs(sql.NullString{}, sql.NullString{}, sql.NullString{}, int32(0), int32(100)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "actor_platform_user_id", "actor_role", "action", "target_type", "target_id", "outcome", "reason", "client_ip", "created_at", "actor_name", "actor_public_id", "tenant_name", "tenant_public_id", "target_public_id", "target_name"}))

	client := publirasplatformv1connect.NewPlatformAuditLogServiceClient(ts.Client(), ts.URL)
	_, err := client.ListAuditLogs(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.ListAuditLogsRequest{Limit: 999}))
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	assertIntegrationExpectations(t, mock)
}

func TestListAuditLogsUnauthenticated(t *testing.T) {
	ts, _ := newIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformAuditLogServiceClient(ts.Client(), ts.URL)
	_, err := client.ListAuditLogs(context.Background(), newIntegrationRequest(publirasplatformv1.ListAuditLogsRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListAuditLogs code = %v, want unauthenticated", connect.CodeOf(err))
	}
}

func TestGetDashboardSummary(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(integrationCountAllTenantsQuery)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(50)))
	mock.ExpectQuery(regexp.QuoteMeta(integrationCountActiveTenantsQuery)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(42)))
	mock.ExpectQuery(regexp.QuoteMeta(integrationCountSuspendedTenantsQuery)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(8)))
	mock.ExpectQuery(regexp.QuoteMeta(integrationCountPendingEndUsersQuery)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(3)))
	mock.ExpectQuery(regexp.QuoteMeta(integrationListRecentPlatformEventsQuery)).
		WithArgs(int32(10)).
		WillReturnRows(sqlmock.NewRows([]string{"event_type", "action", "target", "actor", "occurred_at"}).
			AddRow("tenant_created", "Tenant Created", "TENANT001", "", now).
			AddRow("operator_role_granted", "Operator Role Granted", "PLATUSER001", "operator.yamada", now.Add(-time.Minute)))

	client := publirasplatformv1connect.NewPlatformDashboardServiceClient(ts.Client(), ts.URL)
	resp, err := client.GetDashboardSummary(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.GetDashboardSummaryRequest{}))
	if err != nil {
		t.Fatalf("GetDashboardSummary: %v", err)
	}
	if resp.Msg.TotalTenants != 50 {
		t.Fatalf("total_tenants = %d, want 50", resp.Msg.TotalTenants)
	}
	if resp.Msg.ActiveTenants != 42 {
		t.Fatalf("active_tenants = %d, want 42", resp.Msg.ActiveTenants)
	}
	if resp.Msg.PendingEndUsers != 3 {
		t.Fatalf("pending_end_users = %d, want 3", resp.Msg.PendingEndUsers)
	}
	if len(resp.Msg.RecentEvents) != 2 {
		t.Fatalf("recent_events count = %d, want 2", len(resp.Msg.RecentEvents))
	}
	if resp.Msg.RecentEvents[0].Actor != "system" {
		t.Fatalf("recent_events[0].actor = %q, want system", resp.Msg.RecentEvents[0].Actor)
	}
	assertIntegrationExpectations(t, mock)
}

func TestGetDashboardSummaryClampLimit(t *testing.T) {
	ts, mock := newIntegrationTestServer(t)
	now := time.Now()
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	expectIntegrationAuth(mock, tenantID, userID, integrationPlatformRole, now)

	mock.ExpectQuery(regexp.QuoteMeta(integrationCountAllTenantsQuery)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(integrationCountActiveTenantsQuery)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(1)))
	mock.ExpectQuery(regexp.QuoteMeta(integrationCountSuspendedTenantsQuery)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(0)))
	mock.ExpectQuery(regexp.QuoteMeta(integrationCountPendingEndUsersQuery)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int32(0)))
	mock.ExpectQuery(regexp.QuoteMeta(integrationListRecentPlatformEventsQuery)).WithArgs(int32(50)).WillReturnRows(sqlmock.NewRows([]string{"event_type", "action", "target", "actor", "occurred_at"}))

	client := publirasplatformv1connect.NewPlatformDashboardServiceClient(ts.Client(), ts.URL)
	_, err := client.GetDashboardSummary(context.Background(), newAuthedIntegrationRequest(publirasplatformv1.GetDashboardSummaryRequest{RecentEventsLimit: 999}))
	if err != nil {
		t.Fatalf("GetDashboardSummary: %v", err)
	}
	assertIntegrationExpectations(t, mock)
}

func TestGetDashboardSummaryUnauthenticated(t *testing.T) {
	ts, _ := newIntegrationTestServer(t)
	client := publirasplatformv1connect.NewPlatformDashboardServiceClient(ts.Client(), ts.URL)
	_, err := client.GetDashboardSummary(context.Background(), newIntegrationRequest(publirasplatformv1.GetDashboardSummaryRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetDashboardSummary code = %v, want unauthenticated", connect.CodeOf(err))
	}
}
