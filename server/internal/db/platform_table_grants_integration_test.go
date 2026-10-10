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

// readablePlatformTables are, per role, the platform tables it reads: the
// policy the storefront's and the tenant console's rate limits and the
// tenant-admin MFA requirement come from, the retention defaults the tenant
// console and the purge batches resolve a tenant's periods from, the object
// store the image server and the orphan image sweep resolve, the search
// engine the maintenance role builds the catalog index on, and the spent
// operator MFA challenges it purges. The object store and the search engine hold
// their secret encrypted under keys the database does not have. The storefront also
// reads the Web Push settings, but only the columns that publish the public
// key, which TestPublicRoleReadsOnlyThePublishedWebPushColumns holds it to, and
// the tenant console the platform relay's from address and nothing else of
// it, which TestAdminRoleReadsOnlyThePlatformSMTPFromAddress holds it to.
var readablePlatformTables = map[string][]string{
	"publira_public":        {"platform_policy_config", "platform_webpush_config"},
	"publira_admin":         {"platform_policy_config", "platform_retention_config", "platform_smtp_config", "platform_storage_config"},
	"publira_content_stats": {"platform_retention_config", "platform_search_config", "platform_storage_config", "platform_user_mfa_used_challenges"},
}

// purgeablePlatformTables are, per role, the platform tables it deletes from:
// the spent MFA challenge purge drains the platform console's spent challenges
// on the maintenance pool. A row there names a token identifier and an
// operator's internal id and nothing an attacker could sign in with.
var purgeablePlatformTables = map[string][]string{
	"publira_content_stats": {"platform_user_mfa_used_challenges"},
}

// The storefront and the tenant console reach the database as publira_public and
// publira_admin, and the daily batches as publira_content_stats. None of them
// serves the platform console, so none may write a row of it or read one past
// the settings they enforce — an injection or a handler bug on either would
// otherwise be the ability to create a platform console account for itself.
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
			if slices.Contains(readablePlatformTables[role], table) {
				var count int
				if err := conn.QueryRowContext(ctx, query).Scan(&count); err != nil {
					t.Fatalf("read %s as %s: %v", table, role, err)
				}
			} else {
				assertRefused(t, ctx, conn, role, query)
			}
			assertRefused(t, ctx, conn, role, fmt.Sprintf("INSERT INTO %s DEFAULT VALUES", table))
			deletion := fmt.Sprintf("DELETE FROM %s", table)
			if slices.Contains(purgeablePlatformTables[role], table) {
				if _, err := conn.ExecContext(ctx, deletion); err != nil {
					t.Fatalf("delete from %s as %s: %v", table, role, err)
				}
			} else {
				assertRefused(t, ctx, conn, role, deletion)
			}
		}
	}
}

// The storefront publishes the VAPID public key from the same row the sealed
// private key is stored in, so its grant names columns rather than the table.
// The private key must stay out of its reach even sealed: a ciphertext beside
// the keys that open it is one leak away from the key itself.
func TestPublicRoleReadsOnlyThePublishedWebPushColumns(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	public := pg.OpenPublicDB(t)
	var count int
	if err := public.QueryRowContext(ctx,
		"SELECT count(*) FROM platform_webpush_config WHERE singleton AND vapid_public_key <> '' AND subject IS NOT NULL",
	).Scan(&count); err != nil {
		t.Fatalf("read the published web push columns as publira_public: %v", err)
	}
	assertRefused(t, ctx, public, "publira_public", "SELECT vapid_private_key_encrypted FROM platform_webpush_config")
	assertRefused(t, ctx, public, "publira_public", "SELECT * FROM platform_webpush_config")
}

// The tenant console names the address a tenant on the platform's mail is sent
// from, which lives in the same row as the relay's credentials, so its grant
// names that column rather than the table.
func TestAdminRoleReadsOnlyThePlatformSMTPFromAddress(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	admin := pg.OpenAdminDB(t)
	var count int
	if err := admin.QueryRowContext(ctx,
		"SELECT count(*) FROM platform_smtp_config WHERE singleton AND from_address <> ''",
	).Scan(&count); err != nil {
		t.Fatalf("read the platform smtp from address as publira_admin: %v", err)
	}
	for _, column := range []string{"host", "port", "username", "password_encrypted", "encryption", "reply_to"} {
		assertRefused(t, ctx, admin, "publira_admin", fmt.Sprintf("SELECT %s FROM platform_smtp_config", column))
	}
	assertRefused(t, ctx, admin, "publira_admin", "SELECT * FROM platform_smtp_config")
	assertRefused(t, ctx, admin, "publira_admin", "UPDATE platform_smtp_config SET from_address = 'attacker@example.com'")
}

const outboxDBRole = "publira_outbox"

// outboxReadableTables are the platform tables the mail paths in internal/outbox
// read: the console's own password reset and email change mail, and the platform
// relay every mail leaves over when the tenant overrides nothing. The member
// push handler reads the VAPID key pair every Web Push delivery is signed with,
// and the catalog index handler the search engine it writes documents into.
var outboxReadableTables = []string{
	"platform_config",
	"platform_search_config",
	"platform_smtp_config",
	"platform_user_email_change_tokens",
	"platform_user_password_reset_tokens",
	"platform_users",
	"platform_webpush_config",
}

// outboxWritableTables are the platform tables the outbox worker writes: the
// password reset request handler replaces an operator's reset tokens with the
// one its mail carries. The insert is exercised by that handler's own tests.
var outboxWritableTables = []string{
	"platform_user_password_reset_tokens",
}

// The outbox worker composes the platform console's own mail, so it keeps the
// reads and writes those paths need and nothing else. The refusals are what make
// the lists a boundary: a platform table added later reaches this role only when
// someone puts it in the seed.
func TestOutboxRoleReachesOnlyThePlatformTablesItsMailNeeds(t *testing.T) {
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
		if slices.Contains(outboxWritableTables, table) {
			if _, err := outbox.ExecContext(ctx, fmt.Sprintf("DELETE FROM %s", table)); err != nil {
				t.Fatalf("delete from %s as the outbox role: %v", table, err)
			}
		} else {
			assertRefused(t, ctx, outbox, outboxDBRole, fmt.Sprintf("INSERT INTO %s DEFAULT VALUES", table))
			assertRefused(t, ctx, outbox, outboxDBRole, fmt.Sprintf("DELETE FROM %s", table))
		}
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

// The search index build moves the serving configuration once it has built the
// index, and records a build that failed, as publira_content_stats. What an
// operator saved stays out of its reach, and the worker, which only reads the
// row to know where to write, may change none of it.
func TestOnlyTheBuildMovesTheServingSearchEngine(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if _, err := pg.OpenPlatformDB(t).ExecContext(ctx,
		`INSERT INTO platform_search_config (engine, url, index_alias) VALUES ('opensearch', 'http://search:9200', 'publira-catalog')`,
	); err != nil {
		t.Fatalf("save the search engine as the platform role: %v", err)
	}

	contentStats := pg.OpenContentStatsDB(t)
	if _, err := contentStats.ExecContext(ctx,
		`UPDATE platform_search_config SET serving_revision = revision, serving_engine = engine, serving_url = url, serving_index_alias = index_alias, serving_analysis = analysis, serving_since = now()`,
	); err != nil {
		t.Fatalf("move the serving configuration as the maintenance role: %v", err)
	}
	if _, err := contentStats.ExecContext(ctx,
		`UPDATE platform_search_config SET build_failed_revision = revision, build_error = 'refused', build_failed_at = now()`,
	); err != nil {
		t.Fatalf("record a failed build as the maintenance role: %v", err)
	}
	assertRefused(t, ctx, contentStats, "publira_content_stats", `UPDATE platform_search_config SET url = 'http://elsewhere:9200'`)
	assertRefused(t, ctx, contentStats, "publira_content_stats", `UPDATE platform_search_config SET revision = revision + 1`)
	assertRefused(t, ctx, contentStats, "publira_content_stats", `UPDATE platform_search_config SET analysis = '{}'`)
	assertRefused(t, ctx, pg.OpenOutboxDB(t), outboxDBRole, `UPDATE platform_search_config SET serving_engine = 'sql'`)
}
