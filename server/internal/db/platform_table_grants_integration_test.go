package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/publira/publira/server/internal/testutil"
)

// The platform console's tables carry no row-level security, and correctly so:
// the console spans tenants, so a tenant isolation policy would have nothing to
// isolate on. The grant is therefore the only thing in front of the operators'
// password hashes and the platform SMTP credentials, and the baseline seed takes
// it away from every role that is not the platform API.
//
// These tests read the table list out of the catalog rather than repeating it,
// because the ALTER DEFAULT PRIVILEGES in the seed re-grants whatever a later
// migration adds: a list written here would keep passing the day a tenth
// platform_ table lands.

// platformTables answers with every table the platform_ prefix covers, so a
// table added after this test was written is covered the day it is created.
func platformTables(t *testing.T, ctx context.Context, db *sql.DB) []string {
	t.Helper()
	rows, err := db.QueryContext(ctx, `
		SELECT c.relname
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'
			AND c.relkind IN ('r', 'p')
			AND c.relname LIKE 'platform\_%'
		ORDER BY c.relname
	`)
	if err != nil {
		t.Fatalf("list the platform tables: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan a platform table name: %v", err)
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read the platform table names: %v", err)
	}
	if len(tables) == 0 {
		t.Fatal("found no platform_ tables, so this test would assert nothing")
	}
	return tables
}

// assertRefused runs one statement and insists PostgreSQL refused it for want of
// a privilege. The SQLSTATE rather than any error: a syntax mistake or a table
// that went away would otherwise pass for a grant that is no longer there.
func assertRefused(t *testing.T, ctx context.Context, conn *sql.DB, role, statement string) {
	t.Helper()
	_, err := conn.ExecContext(ctx, statement)
	if err == nil {
		t.Fatalf("%q as %s succeeded, want permission denied", statement, role)
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != insufficientPrivilegeCode {
		t.Fatalf("%q as %s error = %v, want SQLSTATE %s", statement, role, err, insufficientPrivilegeCode)
	}
}

// tenantReadableTables are the platform tables the storefront and the tenant
// console read: the policy their rate limits and the tenant-admin MFA
// requirement come from. It holds no secret.
var tenantReadableTables = []string{
	"platform_policy_config",
}

// The storefront and the tenant console reach the database as publira_public and
// publira_admin. Neither serves the platform console, so neither may write a row
// of it or read one past the policy they enforce — an injection or a handler bug
// on either would otherwise be the ability to create a platform console account
// for itself.
func TestPlatformTablesAreOutOfReachOfTheTenantRoles(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tables := platformTables(t, ctx, pg.DB)

	for role, conn := range map[string]*sql.DB{
		"publira_public":        pg.OpenPublicDB(t),
		"publira_admin":         pg.OpenAdminDB(t),
		"publira_content_stats": pg.OpenContentStatsDB(t),
	} {
		for _, table := range tables {
			query := fmt.Sprintf("SELECT count(*) FROM %s", table)
			if role != "publira_content_stats" && slices.Contains(tenantReadableTables, table) {
				var count int
				if err := conn.QueryRowContext(ctx, query).Scan(&count); err != nil {
					t.Fatalf("read %s as %s: %v", table, role, err)
				}
			} else {
				assertRefused(t, ctx, conn, role, query)
			}
			assertRefused(t, ctx, conn, role, fmt.Sprintf("INSERT INTO %s DEFAULT VALUES", table))
			assertRefused(t, ctx, conn, role, fmt.Sprintf("DELETE FROM %s", table))
		}
	}
}

const outboxDBRole = "publira_outbox"

// outboxReadableTables are the platform tables the mail paths in internal/outbox
// read: the console's own password reset and email change mail, and the platform
// relay every mail leaves over when the tenant overrides nothing.
var outboxReadableTables = []string{
	"platform_config",
	"platform_smtp_config",
	"platform_user_email_change_tokens",
	"platform_user_password_reset_tokens",
	"platform_users",
}

// The outbox worker composes the platform console's own mail, so it keeps the
// reads those paths need and nothing else. The second half is what makes the
// list a boundary: it writes none of them, and a platform table added later
// reaches this role only when someone puts it in the seed.
func TestOutboxRoleReadsOnlyThePlatformTablesItsMailNeeds(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tables := platformTables(t, ctx, pg.DB)
	outbox := pg.OpenOutboxDB(t)

	for _, table := range tables {
		query := fmt.Sprintf("SELECT count(*) FROM %s", table)
		if slices.Contains(outboxReadableTables, table) {
			var count int
			if err := outbox.QueryRowContext(ctx, query).Scan(&count); err != nil {
				t.Fatalf("read %s as the outbox role: %v", table, err)
			}
		} else {
			assertRefused(t, ctx, outbox, outboxDBRole, query)
		}
		assertRefused(t, ctx, outbox, outboxDBRole, fmt.Sprintf("INSERT INTO %s DEFAULT VALUES", table))
		assertRefused(t, ctx, outbox, outboxDBRole, fmt.Sprintf("DELETE FROM %s", table))
	}
}

// The platform API is the one role these tables belong to, so the revoke above
// must not have reached it.
func TestPlatformRoleKeepsThePlatformTables(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tables := platformTables(t, ctx, pg.DB)
	platform := pg.OpenPlatformDB(t)

	for _, table := range tables {
		var count int
		if err := platform.QueryRowContext(ctx, fmt.Sprintf("SELECT count(*) FROM %s", table)).Scan(&count); err != nil {
			t.Fatalf("read %s as the platform role: %v", table, err)
		}
	}

	operator := pg.SeedPlatformOperator(t, "PLATGRANT001", "grants-operator@example.com", "Grants Operator")
	if _, err := platform.ExecContext(ctx,
		"UPDATE platform_users SET name = $1 WHERE id = $2", "Renamed Operator", operator.ID,
	); err != nil {
		t.Fatalf("rename an operator as the platform role: %v", err)
	}
}
