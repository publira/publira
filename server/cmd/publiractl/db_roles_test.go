package main

import (
	"database/sql"
	"maps"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/dbroles"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBRolesRefusesWithoutDBURL(t *testing.T) {
	code, output := testutil.RunMain(t, []string{}, "db", "roles")
	if code == 0 {
		t.Fatalf("exit code = 0, want a failure\n%s", output)
	}
	if !strings.Contains(output, "PUBLIRA_DB_URL") {
		t.Fatalf("output does not name the missing variable:\n%s", output)
	}
}

func TestDBRolesTakesAMigratedClusterToRolesEveryProcessConnectsAs(t *testing.T) {
	superuser := testutil.StartBarePostgres(t)
	// A half-set encryption key pair is a configuration db roles never reads.
	env := testutil.Env(map[string]string{
		"PUBLIRA_DB_URL": superuser,
		"PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID": "k1",
	})
	if code, output := testutil.RunMain(t, env, "db", "migrate"); code != 0 {
		t.Fatalf("db migrate exit code = %d\n%s", code, output)
	}
	passwords := map[string]string{
		"publira_public":        "public-" + t.Name(),
		"publira_admin":         "admin-" + t.Name(),
		"publira_platform":      "platform-" + t.Name(),
		"publira_outbox":        "outbox-" + t.Name(),
		"publira_ticker":        "ticker-" + t.Name(),
		"publira_content_stats": "content-stats-" + t.Name(),
	}

	// A role left without a password is refused before anything is created.
	partial := maps.Clone(passwords)
	delete(partial, "publira_ticker")
	code, output := testutil.RunMain(t, env, append([]string{"db", "roles"}, passwordFlags(t, partial)...)...)
	if code != 2 || !strings.Contains(output, "--ticker-password-file") {
		t.Fatalf("exit code = %d, want 2 naming --ticker-password-file\n%s", code, output)
	}
	if got := loginRoles(t, superuser); len(got) != 0 {
		t.Fatalf("roles after the refused run = %v, want none", got)
	}

	code, output = testutil.RunMain(t, env, append([]string{"db", "roles"}, passwordFlags(t, passwords)...)...)
	if code != 0 {
		t.Fatalf("db roles exit code = %d\n%s", code, output)
	}
	for _, role := range dbroles.LoginRoles {
		if !strings.Contains(output, role+": created\n") {
			t.Fatalf("output does not report %s created:\n%s", role, output)
		}
		assertConnects(t, superuser, role, passwords[role])
	}

	// Run again with nothing given, every role and grant stays as it is.
	before := catalog(t, superuser)
	if code, output := testutil.RunMain(t, env, "db", "roles"); code != 0 {
		t.Fatalf("db roles rerun exit code = %d\n%s", code, output)
	}
	after := catalog(t, superuser)
	for key := range mergedKeys(before, after) {
		if before[key] != after[key] {
			t.Errorf("a rerun with no password changed %s:\nbefore %q\nafter  %q", key, before[key], after[key])
		}
	}
	if t.Failed() {
		t.FailNow()
	}

	// A password given for one role rotates that password and nothing else.
	rotated := map[string]string{"publira_admin": "rotated-" + t.Name()}
	code, output = testutil.RunMain(t, env, append([]string{"db", "roles"}, passwordFlags(t, rotated)...)...)
	if code != 0 || !strings.Contains(output, "publira_admin: set its password\n") {
		t.Fatalf("db roles rotation exit code = %d, want 0 reporting the new password\n%s", code, output)
	}
	after = catalog(t, superuser)
	for key, value := range before {
		changed := after[key] != value
		if changed != (key == "password publira_admin") {
			t.Fatalf("rotating publira_admin's password changed %q = %t, want only its password changed", key, changed)
		}
	}
	assertConnects(t, superuser, "publira_admin", rotated["publira_admin"])
}

func mergedKeys(a, b map[string]string) map[string]struct{} {
	keys := map[string]struct{}{}
	for k := range a {
		keys[k] = struct{}{}
	}
	for k := range b {
		keys[k] = struct{}{}
	}
	return keys
}

// passwordFlags writes each password to a file of its own and returns the
// flags naming them.
func passwordFlags(t *testing.T, passwords map[string]string) []string {
	t.Helper()
	dir := t.TempDir()
	var flags []string
	for role, password := range passwords {
		path := filepath.Join(dir, role)
		if err := os.WriteFile(path, []byte(password+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		name := strings.ReplaceAll(strings.TrimPrefix(role, "publira_"), "_", "-")
		flags = append(flags, "--"+name+"-password-file", path)
	}
	return flags
}

// assertConnects logs in as role with password and reads a table every
// process reads, which takes both the login and the grants.
func assertConnects(t *testing.T, superuser, role, password string) {
	t.Helper()
	u, err := url.Parse(superuser)
	if err != nil {
		t.Fatal(err)
	}
	u.User = url.UserPassword(role, password)
	db, err := sql.Open("pgx", u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close() //nolint:errcheck
	var n int
	if err := db.QueryRowContext(t.Context(), "SELECT count(*) FROM tenants").Scan(&n); err != nil {
		t.Fatalf("%s cannot read tenants with its password: %v", role, err)
	}
}

func loginRoles(t *testing.T, superuser string) []string {
	t.Helper()
	db := openSuperuser(t, superuser)
	rows, err := db.QueryContext(t.Context(), "SELECT rolname FROM pg_roles WHERE rolname LIKE 'publira\\_%' ORDER BY rolname")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close() //nolint:errcheck
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	return names
}

// catalog is what db roles writes: each role's attributes and stored password,
// the grants on every relation, the default privileges, and the event trigger.
// Each ACL is sorted, since revoking and granting back again reorders it.
func catalog(t *testing.T, superuser string) map[string]string {
	t.Helper()
	db := openSuperuser(t, superuser)
	rows, err := db.QueryContext(t.Context(), `
		SELECT 'role ' || rolname, concat_ws(' ', rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls)
		FROM pg_authid WHERE rolname LIKE 'publira\_%'
		UNION ALL
		SELECT 'password ' || rolname, coalesce(rolpassword, '') FROM pg_authid WHERE rolname LIKE 'publira\_%'
		UNION ALL
		SELECT 'acl ' || c.relname, coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(c.relacl) a), '') || ' owner ' || c.relowner::regrole::text
		FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
		UNION ALL
		SELECT 'default acl ' || d.defaclrole::regrole::text || ' ' || d.defaclobjtype::text, (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(d.defaclacl) a) FROM pg_default_acl d
		UNION ALL
		SELECT 'event trigger ' || evtname, evtfoid::regproc::text FROM pg_event_trigger
		UNION ALL
		SELECT 'database', coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(datacl) a), '') FROM pg_database WHERE datname = current_database()`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close() //nolint:errcheck
	got := map[string]string{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			t.Fatal(err)
		}
		got[key] = value
	}
	return got
}

func openSuperuser(t *testing.T, superuser string) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", superuser)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}
