package main

import (
	"bytes"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/dbroles"
	"github.com/publira/publira/server/internal/tenantorigin"
	"github.com/publira/publira/server/internal/testutil"
)

// bareSetup is an install as the Compose file hands it to setup: an empty
// cluster on PUBLIRA_DB_URL, PUBLIRA_PLATFORM_DB_URL naming a role that does
// not exist yet, and an object store without the bucket.
type bareSetup struct {
	*setupEnv
	superuser string
	passwords map[string]string
	bucket    string
}

func startBareSetup(t *testing.T) *bareSetup {
	t.Helper()
	t.Setenv(tenantorigin.SchemeEnv, "")
	superuser := testutil.StartBarePostgres(t)
	setEncryptionKeys(t)
	passwords := map[string]string{}
	for _, role := range dbroles.LoginRoles {
		passwords[role] = strings.ReplaceAll(role, "_", "-") + "-" + strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	platform, err := url.Parse(superuser)
	if err != nil {
		t.Fatal(err)
	}
	platform.User = url.UserPassword("publira_platform", passwords["publira_platform"])
	t.Setenv("PUBLIRA_DB_URL", superuser)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", platform.String())
	return &bareSetup{
		setupEnv:  &setupEnv{pg: &testutil.PostgresEnv{DB: openDB(t, superuser)}, s3: testutil.StartRustFS(t), smtp: testutil.StartSMTPServer(t)},
		superuser: superuser,
		passwords: passwords,
		// The store is shared by every test of the package, so the bucket is
		// the run's own.
		bucket: fmt.Sprintf("publiractl-setup-%d", time.Now().UnixNano()),
	}
}

// flags are a whole install given as flags, the role passwords among them, but
// for the administrator's password.
func (e *bareSetup) flags(t *testing.T) []string {
	args := append(withoutFlags(e.everyFlag(t), "--bucket"), "--bucket", e.bucket)
	return append(args, dbPasswordFlags(t, e.passwords)...)
}

// dbPasswordFlags gives setup each password from a file of its own.
func dbPasswordFlags(t *testing.T, passwords map[string]string) []string {
	t.Helper()
	dir := t.TempDir()
	var flags []string
	for role, password := range passwords {
		path := filepath.Join(dir, role)
		if err := os.WriteFile(path, []byte(password+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		flags = append(flags, "--db-"+strings.ReplaceAll(strings.TrimPrefix(role, "publira_"), "_", "-")+"-password-file", path)
	}
	return flags
}

func TestSetupRunsTheDatabaseStepsAndCreatesTheBucketAndThenChangesNothing(t *testing.T) {
	env := startBareSetup(t)
	head := strconv.FormatUint(uint64(headVersion(t)), 10)

	var stderr bytes.Buffer
	args := append(env.flags(t), "--create-bucket", "--non-interactive", "--generate-admin-password")
	code, stdout := runSetup(t, pipedConsole("", &stderr), args...)
	if code != 0 {
		t.Fatalf("exit code = %d\n%s", code, stderr.String())
	}
	for _, want := range []string{
		"Database schema      created  version " + head + "\n",
		"Database roles       created  6 login roles\n",
		"Platform defaults    created  en, Asia/Tokyo, EUR\n",
		"Object store         created  " + env.bucket + ", bucket created\n",
		"Tenant               created  Example Comics (comics.example.com)\n",
		"First administrator  created  owner@comics.example.com\n",
	} {
		if !summaryHas(stdout, want) {
			t.Fatalf("summary = \n%s\nwant a line %q", stdout, want)
		}
	}
	for _, role := range dbroles.LoginRoles {
		assertConnects(t, env.superuser, role, env.passwords[role])
	}

	// The same run again applies no migration and creates no role. It sets the
	// passwords it is given, the same ones, and changes no row.
	before := installState(t, env.pg)
	stderr.Reset()
	code, stdout = runSetup(t, pipedConsole("", &stderr), args...)
	if code != 0 {
		t.Fatalf("second run: exit code = %d\n%s", code, stderr.String())
	}
	if after := installState(t, env.pg); after != before {
		t.Fatalf("state after the second run = %s, want %s", after, before)
	}
	for _, want := range []string{
		"Database schema      kept     version " + head + "\n",
		"Database roles       updated  6 login roles, password set again for " + strings.Join(dbroles.LoginRoles, ", ") + "\n",
		"Object store         kept     " + env.bucket + "\n",
	} {
		if !summaryHas(stdout, want) {
			t.Fatalf("second summary = \n%s\nwant a line %q", stdout, want)
		}
	}
	if got := strings.Count(stdout, " kept "); got != 8 {
		t.Fatalf("second summary = \n%s\nwant every step but the roles kept", stdout)
	}
	for _, role := range dbroles.LoginRoles {
		assertConnects(t, env.superuser, role, env.passwords[role])
	}
}

// Without a password for a role it would create, setup stops before the
// migrations change the database, as db roles stops before it creates a role.
func TestSetupStopsBeforeMigratingWhenARolePasswordIsMissing(t *testing.T) {
	env := startBareSetup(t)
	args := withoutFlags(append(env.flags(t), "--non-interactive", "--generate-admin-password"), "--db-ticker-password-file")

	var stderr bytes.Buffer
	code, _ := runSetup(t, pipedConsole("", &stderr), args...)
	if code != 2 || !strings.Contains(stderr.String(), "--db-ticker-password-file") {
		t.Fatalf("exit code = %d, want 2 naming --db-ticker-password-file\n%s", code, stderr.String())
	}
	var migrated bool
	if err := env.pg.DB.QueryRowContext(t.Context(), "SELECT to_regclass('schema_migrations') IS NOT NULL").Scan(&migrated); err != nil {
		t.Fatal(err)
	}
	if migrated {
		t.Fatal("the refused run migrated the database")
	}
	if got := loginRoles(t, env.superuser); len(got) != 0 {
		t.Fatalf("roles after the refused run = %v, want none", got)
	}
}

// On a terminal, a role setup would create without a password is asked for,
// as db roles asks for it.
func TestSetupAsksForTheRolePasswordsNoFlagGives(t *testing.T) {
	env := startBareSetup(t)
	args := append(withoutFlags(env.flags(t), "--db-public-password-file", "--db-admin-password-file"), "--create-bucket", "--generate-admin-password")

	var stderr bytes.Buffer
	// Every other question is answered with what it offers.
	con := terminalConsole(&stderr, strings.Repeat("\n", 20), env.passwords["publira_public"], env.passwords["publira_admin"])
	code, stdout := runSetup(t, con, args...)
	if code != 0 {
		t.Fatalf("exit code = %d\n%s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "publira_public password: ") || !strings.Contains(stderr.String(), "publira_admin password: ") {
		t.Fatalf("stderr = %s\nwant a prompt for each role no flag gave", stderr.String())
	}
	if !summaryHas(stdout, "Database roles       created  6 login roles\n") {
		t.Fatalf("summary = \n%s\nwant every role created", stdout)
	}
	assertConnects(t, env.superuser, "publira_public", env.passwords["publira_public"])
	assertConnects(t, env.superuser, "publira_admin", env.passwords["publira_admin"])
}

func TestSetupRefusesARolePasswordWithoutTheAdministrativeConnection(t *testing.T) {
	env := startSetupEnv(t)
	before := installState(t, env.pg)
	args := append(env.everyFlag(t), "--non-interactive", "--generate-admin-password", "--db-public-password-file", writeSecretFile(t, testSecretValue))

	var stderr bytes.Buffer
	code, _ := runSetup(t, pipedConsole("", &stderr), args...)
	if code != 1 || !strings.Contains(stderr.String(), "--db-public-password-file") || !strings.Contains(stderr.String(), "PUBLIRA_DB_URL") {
		t.Fatalf("exit code = %d, want 1 naming the flag and PUBLIRA_DB_URL\n%s", code, stderr.String())
	}
	if after := installState(t, env.pg); after != before {
		t.Fatalf("state after the refused run = %s, want %s", after, before)
	}
}
