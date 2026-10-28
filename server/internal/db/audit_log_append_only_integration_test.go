package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// Every role Publira's processes connect as may add to the audit logs and
// never change or remove what is there, so a compromised console session or a
// bug cannot rewrite the record. The statements name no row a policy could
// hide: a role holding the privilege would succeed on zero rows, which
// assertRefused fails on, rather than pass for a refusal.
func TestAuditLogsRefuseEveryAppRoleAChangeOrADelete(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "AAOTENANT001", "append-only.example.com", "admin-append-only.example.com", "Append Only")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "AAOMEMBER001", "member@append-only.example.com", "Member")
	mustInsertAuditLog(t, ctx, pg.DB, tenantID, userID, time.Now().UTC())
	mustExec(t, ctx, pg.DB, `
		INSERT INTO platform_audit_logs (id, actor_role, action, outcome)
		VALUES ($1, 'system', 'platform_settings_updated', 'success')
	`, uuid.Must(uuid.NewV7()))

	for _, role := range []struct {
		name string
		open func(*testing.T) *sql.DB
	}{
		{name: "publira_platform", open: pg.OpenPlatformDB},
		{name: "publira_admin", open: pg.OpenAdminDB},
		{name: "publira_public", open: pg.OpenPublicDB},
		{name: "publira_content_stats", open: pg.OpenContentStatsDB},
		{name: "publira_outbox", open: pg.OpenOutboxDB},
		{name: "publira_ticker", open: pg.OpenTickerDB},
	} {
		t.Run(role.name, func(t *testing.T) {
			conn := role.open(t)
			for _, statement := range []string{
				"UPDATE audit_logs SET action = 'series_deleted'",
				"DELETE FROM audit_logs",
				"UPDATE platform_audit_logs SET action = 'platform_policy_updated'",
				"DELETE FROM platform_audit_logs",
			} {
				assertRefused(t, ctx, conn, role.name, statement)
			}
		})
	}
}

// Deleting an account still moves its entries to what is kept of it when the
// connection deleting it holds no UPDATE on audit_logs, because the trigger
// that does it runs with the rights of the table's owner. Another member's
// entry is left as it was.
func TestDeletingAnAccountAsTheConsoleKeepsItsActorInTheAuditLog(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "AADTENANT001", "append-delete.example.com", "admin-append-delete.example.com", "Append Delete")
	leaving := mustInsertUser(t, ctx, pg.DB, tenantID, "AADLEAVING01", "leaving@append-delete.example.com", "Leaving")
	staying := mustInsertUser(t, ctx, pg.DB, tenantID, "AADSTAYING01", "staying@append-delete.example.com", "Staying")
	now := time.Now().UTC()
	leavingEntry := mustInsertAuditLog(t, ctx, pg.DB, tenantID, leaving, now)
	stayingEntry := mustInsertAuditLog(t, ctx, pg.DB, tenantID, staying, now)

	conn, err := pg.OpenAdminDB(t).Conn(ctx)
	if err != nil {
		t.Fatalf("open admin connection: %v", err)
	}
	defer conn.Close() //nolint:errcheck
	if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenantID.String()); err != nil {
		t.Fatalf("scope the connection to the tenant: %v", err)
	}
	if _, err := conn.ExecContext(ctx, "DELETE FROM users WHERE id = $1", leaving); err != nil {
		t.Fatalf("delete an account as publira_admin: %v", err)
	}

	var actorUserID uuid.NullUUID
	var publicID, name sql.NullString
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_user_id FROM audit_logs WHERE id = $1`, &actorUserID, leavingEntry)
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_public_id FROM audit_logs WHERE id = $1`, &publicID, leavingEntry)
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_name FROM audit_logs WHERE id = $1`, &name, leavingEntry)
	if actorUserID.Valid || publicID.String != "AADLEAVING01" || name.String != "Leaving" {
		t.Fatalf("entry of the deleted account = (%v, %v, %v), want no account and its kept public ID and name", actorUserID, publicID, name)
	}
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_user_id FROM audit_logs WHERE id = $1`, &actorUserID, stayingEntry)
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_public_id FROM audit_logs WHERE id = $1`, &publicID, stayingEntry)
	if actorUserID.UUID != staying || publicID.Valid {
		t.Fatalf("entry of the remaining account = (%v, %v), want it still naming the account", actorUserID, publicID)
	}
}

// A tenant's history holds the tenant back: deleting a tenant that has audit
// entries is refused, where it used to take the entries with it.
func TestDeletingATenantWithAuditHistoryIsRefused(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "AATTENANT001", "append-tenant.example.com", "admin-append-tenant.example.com", "Append Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "AATMEMBER001", "member@append-tenant.example.com", "Member")
	mustInsertAuditLog(t, ctx, pg.DB, tenantID, userID, time.Now().UTC())

	_, err := pg.DB.ExecContext(ctx, "DELETE FROM tenants WHERE id = $1", tenantID)
	if !isRestrictViolation(err) || checkName(err) != "audit_logs_tenant_id_fkey" {
		t.Fatalf("delete a tenant with audit entries: error = %v, want audit_logs_tenant_id_fkey to restrict it", err)
	}
	var entries int
	mustQueryRow(t, ctx, pg.DB, `SELECT count(*) FROM audit_logs WHERE tenant_id = $1`, &entries, tenantID)
	if entries != 1 {
		t.Fatalf("entries after the refused delete = %d, want 1", entries)
	}
}
