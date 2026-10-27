package platformapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1/publirasplatformv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

// csvFile is the bytes a CSV export should hold: the byte order mark, then
// each line ended by CRLF.
func csvFile(lines ...string) string {
	file := "\xEF\xBB\xBF"
	for _, line := range lines {
		file += line + "\r\n"
	}
	return file
}

// An export holds every entry of the install's days, oldest first, with the
// times in the install's zone, and nothing either side of them. Every
// operator role may take one, an auditor included, and each is recorded
// about the tenant it was narrowed to.
func TestDBPlatformExportAuditLogsWritesThePeriodOldestFirst(t *testing.T) {
	t.Parallel()

	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	auditor := pg.SeedPlatformAuditor(t, "PLATAUDIT01", "auditor@example.com", "Platform Auditor")
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	audit := publirasplatformv1connect.NewPlatformAuditLogServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	ctx := context.Background()
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO platform_config (default_timezone, default_locale) VALUES ('Asia/Tokyo', 'en')
		ON CONFLICT (singleton) DO UPDATE SET default_timezone = EXCLUDED.default_timezone
	`); err != nil {
		t.Fatalf("set the install's time zone: %v", err)
	}
	seed := func(action, targetType, targetID string, tenantID uuid.NullUUID, at time.Time) {
		t.Helper()
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO platform_audit_logs (id, actor_platform_user_id, actor_role, action, target_type, target_id, outcome, tenant_id, created_at)
			VALUES ($1, $2, 'platform_operator', $3, $4, $5, 'success', $6, $7)
		`, uuid.New(), operator.ID, action, targetType, targetID, tenantID, at); err != nil {
			t.Fatalf("seed the %s entry: %v", action, err)
		}
	}
	tenantID := uuid.NullUUID{UUID: tenant.ID, Valid: true}
	// The install's 2026-01-10 starts at 2026-01-09T15:00Z, and its
	// 2026-01-11 ends at 2026-01-11T15:00Z. The entries are written out of
	// order, so the file's order is the export's own.
	seed("platform_settings_updated", "platform_config", "platform", uuid.NullUUID{}, time.Date(2026, 1, 11, 14, 59, 59, 0, time.UTC))
	seed("tenant_created", "tenant", tenant.ID.String(), tenantID, time.Date(2026, 1, 9, 14, 59, 59, 0, time.UTC))
	seed("tenant_info_updated", "tenant", tenant.ID.String(), tenantID, time.Date(2026, 1, 9, 15, 0, 0, 0, time.UTC))
	seed("tenant_suspended", "tenant", tenant.ID.String(), tenantID, time.Date(2026, 1, 11, 15, 0, 0, 0, time.UTC))

	export := func(as testutil.PlatformOperator, tenantFilter string) string {
		t.Helper()
		res, err := audit.ExportAuditLogs(testutil.WithBearer(ctx, issueDBIntegrationToken(as)), &publirasplatformv1.ExportAuditLogsRequest{
			StartDate: "2026-01-10",
			EndDate:   "2026-01-11",
			TenantId:  tenantFilter,
		})
		if err != nil {
			t.Fatalf("ExportAuditLogs as %s: %v", as.Role, err)
		}
		return string(res.Csv)
	}
	const header = "time,actor_public_id,actor_name,actor_role,action,outcome,reason,target_type,target_id,client_ip,tenant_public_id,tenant_name,target_public_id,target_name"
	tenantRow := "2026-01-10T00:00:00+09:00,PLATUSER001,Platform Operator,platform_operator,tenant_info_updated,success,,tenant," + tenant.ID.String() + ",,TENANTA,Tenant A,TENANTA,Tenant A"

	if got, want := export(auditor, ""), csvFile(
		header,
		tenantRow,
		"2026-01-11T23:59:59+09:00,PLATUSER001,Platform Operator,platform_operator,platform_settings_updated,success,,platform_config,platform,,,,,",
	); got != want {
		t.Fatalf("csv =\n%q\nwant\n%q", got, want)
	}
	if got, want := export(operator, tenant.ID.String()), csvFile(header, tenantRow); got != want {
		t.Fatalf("csv narrowed to the tenant =\n%q\nwant\n%q", got, want)
	}

	var whole, narrowed int
	if err := pg.DB.QueryRowContext(ctx, `
		SELECT count(*) FILTER (WHERE actor_platform_user_id = $1 AND tenant_id IS NULL),
			count(*) FILTER (WHERE actor_platform_user_id = $2 AND tenant_id = $3)
		FROM platform_audit_logs
		WHERE action = 'audit_log_exported' AND target_type = 'audit_log' AND target_id = '2026-01-10/2026-01-11'
	`, auditor.ID, operator.ID, tenant.ID).Scan(&whole, &narrowed); err != nil {
		t.Fatalf("count the export entries: %v", err)
	}
	if whole != 1 || narrowed != 1 {
		t.Fatalf("export entries = %d whole and %d narrowed, want one of each", whole, narrowed)
	}
}

// A period the server would not read in one file is refused, and records
// nothing.
func TestDBPlatformExportAuditLogsRefusesAPeriodLongerThanAYear(t *testing.T) {
	t.Parallel()

	ts, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "operator@example.com", "Platform Operator")
	audit := publirasplatformv1connect.NewPlatformAuditLogServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	ctx := testutil.WithBearer(context.Background(), issueDBIntegrationToken(operator))

	for _, period := range []struct{ start, end string }{
		{"2025-01-01", "2026-01-02"},
		{"2026-01-31", "2026-01-01"},
		{"", ""},
	} {
		_, err := audit.ExportAuditLogs(ctx, &publirasplatformv1.ExportAuditLogsRequest{StartDate: period.start, EndDate: period.end})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("ExportAuditLogs %s..%s error = %v, want invalid_argument", period.start, period.end, err)
		}
	}
	_, err := audit.ExportAuditLogs(ctx, &publirasplatformv1.ExportAuditLogsRequest{StartDate: "2026-01-01", EndDate: "2026-01-31", TenantId: "not-a-tenant"})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ExportAuditLogs with a malformed tenant_id error = %v, want invalid_argument", err)
	}

	var count int
	if err := pg.DB.QueryRowContext(context.Background(), "SELECT count(*) FROM platform_audit_logs WHERE action = 'audit_log_exported'").Scan(&count); err != nil {
		t.Fatalf("count the export entries: %v", err)
	}
	if count != 0 {
		t.Fatalf("audit entries of refused exports = %d, want none", count)
	}
}
