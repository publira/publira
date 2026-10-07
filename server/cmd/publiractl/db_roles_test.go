package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"maps"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dbroles"
	"github.com/publira/publira/server/internal/maintenancejobs"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
	"github.com/publira/publira/server/internal/tickerjobs"
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

// River's tables exist only once the worker has started, so the first db roles
// of a fresh install never sees them, and every one after it does: each upgrade
// runs it again, and so does a restore. The blanket grants of those later runs
// must not reach the job queue, or the storefront and both consoles could
// enqueue, rewrite, or delete the worker's jobs for every tenant.
func TestDBRolesLeavesRiversTablesToTheWorkerOnceItHasStarted(t *testing.T) {
	superuser := testutil.StartBarePostgres(t)
	env := testutil.Env(map[string]string{"PUBLIRA_DB_URL": superuser})
	if code, output := testutil.RunMain(t, env, "db", "migrate"); code != 0 {
		t.Fatalf("db migrate exit code = %d\n%s", code, output)
	}
	passwords := map[string]string{}
	for _, role := range dbroles.LoginRoles {
		passwords[role] = role + "-" + t.Name()
	}
	if code, output := testutil.RunMain(t, env, append([]string{"db", "roles"}, passwordFlags(t, passwords)...)...); code != 0 {
		t.Fatalf("db roles exit code = %d\n%s", code, output)
	}

	db := openSuperuser(t, superuser)
	outboxDB := openRole(t, superuser, "publira_outbox", passwords["publira_outbox"])
	tickerDB := openRole(t, superuser, "publira_ticker", passwords["publira_ticker"])
	contentStatsDB := openRole(t, superuser, "publira_content_stats", passwords["publira_content_stats"])

	stop := startWorker(t, outboxDB, tickerDB, contentStatsDB)
	waitForRiverJob(t, db, "ticker.", 0)
	stop()

	if code, output := testutil.RunMain(t, env, "db", "roles"); code != 0 {
		t.Fatalf("db roles rerun exit code = %d\n%s", code, output)
	}

	relations := riverRelations(t, db)
	for _, role := range dbroles.LoginRoles {
		if role == "publira_outbox" {
			continue
		}
		for _, relation := range relations {
			var held bool
			if err := db.QueryRowContext(t.Context(), `
				SELECT CASE WHEN c.relkind = 'S'
					THEN has_sequence_privilege($1, c.oid, 'USAGE, SELECT, UPDATE')
					ELSE has_table_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
				END
				FROM pg_class c WHERE c.oid = ('public.' || quote_ident($2))::regclass`,
				role, relation,
			).Scan(&held); err != nil {
				t.Fatalf("read %s's privileges on %s: %v", role, relation, err)
			}
			if held {
				t.Errorf("%s holds a privilege on %s after db roles ran again", role, relation)
			}
		}
	}
	if t.Failed() {
		t.FailNow()
	}

	// The worker that owns them still drains the outbox and runs its ticker and
	// maintenance jobs, through River's leader election, on the tables the
	// revoke left it.
	var lastJob int64
	if err := db.QueryRowContext(t.Context(), "SELECT coalesce(max(id), 0) FROM river_job").Scan(&lastJob); err != nil {
		t.Fatalf("read the last river_job id: %v", err)
	}
	queries := dbmodels.New(db)
	event, err := queries.InsertOutboxEvent(t.Context(), dbmodels.InsertOutboxEventParams{
		ID:             uuid.Must(uuid.NewV7()),
		EventType:      outbox.EventTypeTest,
		Payload:        json.RawMessage(`{}`),
		IdempotencyKey: "test:" + t.Name(),
		AvailableAt:    time.Now().UTC().Add(-time.Second),
	})
	if err != nil {
		t.Fatalf("insert an outbox event: %v", err)
	}
	stop = startWorker(t, outboxDB, tickerDB, contentStatsDB)
	defer stop()
	waitForRiverJob(t, db, "ticker.", lastJob)
	waitForRiverJob(t, db, "maintenance.", lastJob)
	waitFor(t, "the outbox event to be drained", func() bool {
		got, err := queries.GetOutboxEvent(t.Context(), event.ID)
		if err != nil {
			t.Fatalf("read the outbox event: %v", err)
		}
		return got.Status == outbox.StatusDone
	})
}

// startWorker boots the worker the way `publira worker` does, on the worker's
// own login, which creates River's schema the first time, with the ticker and
// maintenance jobs on theirs. It returns the function that stops it.
func startWorker(t *testing.T, outboxDB, tickerDB, contentStatsDB *sql.DB) func() {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	jobs, err := tickerjobs.New(tickerjobs.Config{
		DB:                 tickerDB,
		Logger:             logger,
		PublishInterval:    100 * time.Millisecond,
		FreeWindowInterval: 100 * time.Millisecond,
		TenantDayInterval:  100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("build the ticker jobs: %v", err)
	}
	maintenance, err := maintenancejobs.New(maintenancejobs.Config{DB: contentStatsDB, Logger: logger})
	if err != nil {
		t.Fatalf("build the maintenance jobs: %v", err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	t.Cleanup(cancel)
	worker, err := outbox.Start(ctx, outboxDB, outbox.Config{
		Logger:            logger,
		Periodic:          []outbox.PeriodicRegistrar{jobs, maintenance},
		DrainInterval:     50 * time.Millisecond,
		FetchCooldown:     10 * time.Millisecond,
		FetchPollInterval: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("start the worker: %v", err)
	}
	stopped := false
	stop := func() {
		if stopped {
			return
		}
		stopped = true
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer stopCancel()
		if err := worker.Stop(stopCtx); err != nil {
			t.Errorf("stop the worker: %v", err)
		}
	}
	t.Cleanup(stop)
	return stop
}

// waitForRiverJob waits for a periodic job whose kind starts with prefix,
// enqueued after the row after, to complete, which takes River's leader
// election and its queue both.
func waitForRiverJob(t *testing.T, db *sql.DB, prefix string, after int64) {
	t.Helper()
	waitFor(t, "a completed "+prefix+"* job in river_job", func() bool {
		var n int
		if err := db.QueryRowContext(t.Context(),
			"SELECT count(*) FROM river_job WHERE id > $1 AND starts_with(kind, $2) AND state = 'completed'", after, prefix,
		).Scan(&n); err != nil {
			t.Fatalf("read river_job: %v", err)
		}
		return n > 0
	})
}

func waitFor(t *testing.T, what string, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for !done() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// riverRelations names River's tables and sequences, by the prefix River gives
// them rather than by owner, so the assertion does not lean on the rule it
// checks.
func riverRelations(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), `
		SELECT c.relname
		FROM pg_class c
		WHERE c.relnamespace = 'public'::regnamespace
			AND c.relkind IN ('r', 'p', 'S')
			AND c.relname LIKE 'river\_%'
		ORDER BY c.relname`)
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
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"river_job", "river_job_id_seq", "river_leader", "river_queue"} {
		if !slices.Contains(names, want) {
			t.Fatalf("River's relations = %v, want %s among them", names, want)
		}
	}
	return names
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
	db := openRole(t, superuser, role, password)
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

// openRole opens a connection as one login role, closed when the test ends.
func openRole(t *testing.T, superuser, role, password string) *sql.DB {
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
	t.Cleanup(func() { _ = db.Close() })
	return db
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
