package adminapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedAuditEntry writes an entry by the tenant's admin, recorded at the
// instant given rather than now.
func (e *adminDBEnv) seedAuditEntry(t *testing.T, tenant adminDBTenant, action, targetID, clientIP string, at time.Time) {
	t.Helper()

	if _, err := e.PG.DB.ExecContext(context.Background(), `
		INSERT INTO audit_logs (id, tenant_id, actor_user_id, actor_role, action, target_type, target_id, outcome, client_ip, created_at)
		VALUES ($1, $2, $3, 'tenant_admin', $4, 'series', $5, 'success', NULLIF($6, ''), $7)
	`, uuid.New(), tenant.Tenant.ID, tenant.User.ID, action, targetID, clientIP, at); err != nil {
		t.Fatalf("seed the %s entry: %v", action, err)
	}
}

// An export holds every entry of the tenant's days, oldest first, with the
// times in the tenant's zone, and nothing either side of them; it is itself
// recorded against its period.
func TestDBAdminExportAuditLogsWritesThePeriodOldestFirst(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "AUDEXP", "audexp.example.com", "Audit Export", "AUDEXPADMIN1", "admin@audexp.example.com")
	other := env.seedTenantWithAdmin(t, "AUDOTH", "audoth.example.com", "Other Tenant", "AUDOTHADMIN1", "admin@audoth.example.com")
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE tenants SET timezone = 'Asia/Tokyo' WHERE id = $1`, tenant.Tenant.ID); err != nil {
		t.Fatalf("set the tenant's time zone: %v", err)
	}
	// The tenant's 2026-01-10 starts at 2026-01-09T15:00Z, and its
	// 2026-01-11 ends at 2026-01-11T15:00Z. The entries are written out of
	// order, so the file's order is the export's own.
	env.seedAuditEntry(t, tenant, "series_updated", "AUDSERIES03", "", time.Date(2026, 1, 11, 14, 59, 59, 0, time.UTC))
	env.seedAuditEntry(t, tenant, "series_created", "AUDSERIES00", "", time.Date(2026, 1, 9, 14, 59, 59, 0, time.UTC))
	env.seedAuditEntry(t, tenant, "series_created", "=HYPERLINK(\"https://example.com\")", "198.51.100.7", time.Date(2026, 1, 10, 3, 0, 0, 0, time.UTC))
	env.seedAuditEntry(t, tenant, "series_created", "AUDSERIES01", "", time.Date(2026, 1, 9, 15, 0, 0, 0, time.UTC))
	env.seedAuditEntry(t, tenant, "series_updated", "AUDSERIES04", "", time.Date(2026, 1, 11, 15, 0, 0, 0, time.UTC))
	env.seedAuditEntry(t, other, "series_created", "AUDOTHSERIES", "", time.Date(2026, 1, 10, 3, 0, 0, 0, time.UTC))

	export := func(action string) string {
		t.Helper()
		res, err := env.auditClient().ExportAuditLogs(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ExportAuditLogsRequest{
			Tenant:    tenant.tenantContext(),
			StartDate: "2026-01-10",
			EndDate:   "2026-01-11",
			Action:    action,
		})
		if err != nil {
			t.Fatalf("ExportAuditLogs: %v", err)
		}
		return string(res.Csv)
	}

	if got, want := export(""), csvFile(
		"time,actor_public_id,actor_name,actor_role,action,outcome,reason,target_type,target_id,client_ip",
		"2026-01-10T00:00:00+09:00,AUDEXPADMIN1,Audit Export Admin,tenant_admin,series_created,success,,series,AUDSERIES01,",
		`2026-01-10T12:00:00+09:00,AUDEXPADMIN1,Audit Export Admin,tenant_admin,series_created,success,,series,"'=HYPERLINK(""https://example.com"")",198.51.100.7`,
		"2026-01-11T23:59:59+09:00,AUDEXPADMIN1,Audit Export Admin,tenant_admin,series_updated,success,,series,AUDSERIES03,",
	); got != want {
		t.Fatalf("csv =\n%q\nwant\n%q", got, want)
	}

	if got, want := export("series_updated"), csvFile(
		"time,actor_public_id,actor_name,actor_role,action,outcome,reason,target_type,target_id,client_ip",
		"2026-01-11T23:59:59+09:00,AUDEXPADMIN1,Audit Export Admin,tenant_admin,series_updated,success,,series,AUDSERIES03,",
	); got != want {
		t.Fatalf("csv narrowed to series_updated =\n%q\nwant\n%q", got, want)
	}

	if count := env.countRows(t, `
		SELECT count(*) FROM audit_logs
		WHERE tenant_id = $1 AND actor_user_id = $2 AND action = 'audit_log_exported'
			AND target_type = 'audit_log' AND target_id = '2026-01-10/2026-01-11'
	`, tenant.Tenant.ID, tenant.User.ID); count != 2 {
		t.Fatalf("export audit entries = %d, want one per export", count)
	}
}

// Only a tenant_admin may export, and a period the server would not read in
// one file is refused. A refused export records nothing.
func TestDBAdminExportAuditLogsRefusesWhatItCannotWrite(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "AUDREF", "audref.example.com", "Audit Refusal", "AUDREFADMIN1", "admin@audref.example.com")
	auditor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "AUDREFAUDIT1", "auditor@audref.example.com", "Auditor", auth.RoleTenantAuditor)
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "AUDREFEDIT01", "editor@audref.example.com", "Editor", auth.RoleTenantEditor)

	for _, refusal := range []struct {
		name       string
		tenant     adminDBTenant
		start, end string
		code       connect.Code
	}{
		{"an editor", tenant.as(editor), "2026-01-01", "2026-01-31", connect.CodePermissionDenied},
		{"a tenant_auditor", tenant.as(auditor), "2026-01-01", "2026-01-31", connect.CodePermissionDenied},
		{"367 days", tenant, "2025-01-01", "2026-01-02", connect.CodeInvalidArgument},
		{"a reversed period", tenant, "2026-01-31", "2026-01-01", connect.CodeInvalidArgument},
		{"no period", tenant, "", "", connect.CodeInvalidArgument},
	} {
		t.Run(refusal.name, func(t *testing.T) {
			_, err := env.auditClient().ExportAuditLogs(testutil.WithBearer(context.Background(), refusal.tenant.token()), &publiraadminv1.ExportAuditLogsRequest{
				Tenant:    refusal.tenant.tenantContext(),
				StartDate: refusal.start,
				EndDate:   refusal.end,
			})
			if connect.CodeOf(err) != refusal.code {
				t.Fatalf("ExportAuditLogs error = %v, want %s", err, refusal.code)
			}
		})
	}
	if count := env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'audit_log_exported'", tenant.Tenant.ID); count != 0 {
		t.Fatalf("audit entries of refused exports = %d, want none", count)
	}

	// 366 days, a leap year's worth, is the longest period one file covers.
	if _, err := env.auditClient().ExportAuditLogs(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ExportAuditLogsRequest{
		Tenant:    tenant.tenantContext(),
		StartDate: "2025-01-01",
		EndDate:   "2026-01-01",
	}); err != nil {
		t.Fatalf("ExportAuditLogs over 366 days: %v", err)
	}
}
