package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

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

// The trigger function runs as the table's owner, so no app role may attach
// it to a table of its own: a forged row deleted from a temporary table would
// otherwise rewrite any tenant's entries.
func TestNoAppRoleCanAttachTheDeletedActorTrigger(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

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
			conn, err := role.open(t).Conn(ctx)
			if err != nil {
				t.Fatalf("open %s connection: %v", role.name, err)
			}
			defer conn.Close() //nolint:errcheck
			if _, err := conn.ExecContext(ctx, "CREATE TEMP TABLE forged_users (tenant_id uuid, id uuid, public_id varchar, name text)"); err != nil {
				t.Fatalf("create a temporary table as %s: %v", role.name, err)
			}
			_, err = conn.ExecContext(ctx, "CREATE TRIGGER forge BEFORE DELETE ON forged_users FOR EACH ROW EXECUTE FUNCTION public.audit_logs_keep_deleted_actor()")
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilegeCode {
				t.Fatalf("attach the trigger function as %s: error = %v, want SQLSTATE %s", role.name, err, insufficientPrivilegeCode)
			}
		})
	}

	// A role that can execute it, such as the owner, still cannot make it
	// run for anything but users.
	conn, err := pg.DB.Conn(ctx)
	if err != nil {
		t.Fatalf("open owner connection: %v", err)
	}
	defer conn.Close() //nolint:errcheck
	for _, statement := range []string{
		"CREATE TEMP TABLE forged_users (tenant_id uuid, id uuid, public_id varchar, name text)",
		"CREATE TRIGGER forge BEFORE DELETE ON forged_users FOR EACH ROW EXECUTE FUNCTION public.audit_logs_keep_deleted_actor()",
		"INSERT INTO forged_users VALUES (gen_random_uuid(), gen_random_uuid(), 'FORGED000001', 'Forged')",
	} {
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			t.Fatalf("%q as the owner: %v", statement, err)
		}
	}
	if _, err := conn.ExecContext(ctx, "DELETE FROM forged_users"); err == nil {
		t.Fatal("the trigger function ran for a delete from another table, want it refused")
	}
}

// Every role may create temporary tables, and a temporary audit_logs must not
// take the update the trigger function makes as the table's owner: its own
// triggers would run with the owner's rights.
func TestATemporaryAuditLogsTableDoesNotTakeTheDeletedActorUpdate(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "AAPTENANT001", "append-temp.example.com", "admin-append-temp.example.com", "Append Temp")
	leaving := mustInsertUser(t, ctx, pg.DB, tenantID, "AAPLEAVING01", "leaving@append-temp.example.com", "Leaving")
	entry := mustInsertAuditLog(t, ctx, pg.DB, tenantID, leaving, time.Now().UTC())

	conn, err := pg.OpenAdminDB(t).Conn(ctx)
	if err != nil {
		t.Fatalf("open admin connection: %v", err)
	}
	defer conn.Close() //nolint:errcheck
	for _, statement := range []string{
		"CREATE TEMP TABLE audit_logs (tenant_id uuid, actor_user_id uuid, actor_public_id varchar, actor_name text)",
		"INSERT INTO pg_temp.audit_logs VALUES ('" + tenantID.String() + "', '" + leaving.String() + "', NULL, NULL)",
	} {
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			t.Fatalf("%q as publira_admin: %v", statement, err)
		}
	}
	if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenantID.String()); err != nil {
		t.Fatalf("scope the connection to the tenant: %v", err)
	}
	if _, err := conn.ExecContext(ctx, "DELETE FROM public.users WHERE id = $1", leaving); err != nil {
		t.Fatalf("delete an account as publira_admin: %v", err)
	}

	var shadowed sql.NullString
	if err := conn.QueryRowContext(ctx, "SELECT actor_public_id FROM pg_temp.audit_logs").Scan(&shadowed); err != nil {
		t.Fatalf("read the temporary table: %v", err)
	}
	if shadowed.Valid {
		t.Fatalf("the temporary audit_logs took the update (actor_public_id = %q), want it left alone", shadowed.String)
	}
	var kept sql.NullString
	mustQueryRow(t, ctx, pg.DB, `SELECT actor_public_id FROM public.audit_logs WHERE id = $1`, &kept, entry)
	if kept.String != "AAPLEAVING01" {
		t.Fatalf("real entry actor_public_id = %v, want the deleted account's public ID", kept)
	}
}
