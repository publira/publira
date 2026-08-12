package adminapi

import (
	"context"
	"testing"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
)

// TestDBSeriesCreateWritesTenantAuditLog guards the RLS side of audit logging:
// audit_logs is tenant-isolated, so an entry written through a connection that
// carries no app.current_tenant_id is refused by the policy and the event
// disappears with only a log line. Recording has to go through the request's
// tenant-scoped connection, which sqlmock cannot show.
func TestDBSeriesCreateWritesTenantAuditLog(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	created, err := env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant: tenant.tenantContext(),
		Title:  "Audited Series",
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}

	if count := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND target_id = $3",
		tenant.Tenant.ID, "series_created", created.Msg.Series.PublicId,
	); count != 1 {
		t.Fatalf("series_created audit rows = %d, want 1", count)
	}

	listed, err := env.auditClient().ListAuditLogs(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListAuditLogsRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	if len(listed.Msg.AuditLogs) != 1 {
		t.Fatalf("audit log count = %d, want 1", len(listed.Msg.AuditLogs))
	}
	entry := listed.Msg.AuditLogs[0]
	if entry.Action != "series_created" || entry.TargetId != created.Msg.Series.PublicId {
		t.Fatalf("audit entry = %+v, want series_created for %s", entry, created.Msg.Series.PublicId)
	}
	if entry.ActorUserPublicId != tenant.User.PublicID {
		t.Fatalf("audit actor = %q, want %q", entry.ActorUserPublicId, tenant.User.PublicID)
	}
	if entry.Outcome != "success" {
		t.Fatalf("audit outcome = %q, want success", entry.Outcome)
	}
}

func TestDBListAuditLogsExcludesOtherTenants(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	if _, err := env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreateSeriesRequest{
		Tenant: second.tenantContext(),
		Title:  "Tenant B Series",
	})); err != nil {
		t.Fatalf("CreateSeries for tenant B: %v", err)
	}

	if count := env.countRows(t, "SELECT count(*) FROM audit_logs"); count != 1 {
		t.Fatalf("audit rows overall = %d, want 1", count)
	}

	listed, err := env.auditClient().ListAuditLogs(context.Background(), newAdminDBRequest(first, &publiraadminv1.ListAuditLogsRequest{
		Tenant: first.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListAuditLogs for tenant A: %v", err)
	}
	if len(listed.Msg.AuditLogs) != 0 {
		t.Fatalf("tenant A sees %d audit entries, want 0", len(listed.Msg.AuditLogs))
	}
}
