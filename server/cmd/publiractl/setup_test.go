package main

import (
	"bytes"
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/testutil"
)

// setupEnv is what a setup run reaches: the platform database, an object store
// with a bucket, and an SMTP server.
type setupEnv struct {
	pg   *testutil.PostgresEnv
	s3   *testutil.RustFSEnv
	smtp *testutil.SMTPServer
}

func startSetupEnv(t *testing.T) *setupEnv {
	t.Helper()
	pg := startPlatformDB(t)
	setEncryptionKeys(t)
	s3 := testutil.StartRustFS(t)
	s3.CreateNamedBucket(t, "publiractl-setup")
	return &setupEnv{pg: pg, s3: s3, smtp: testutil.StartSMTPServer(t)}
}

func runSetup(t *testing.T, con console, args ...string) (code int, stdout string) {
	t.Helper()
	var out bytes.Buffer
	code = runCommand("setup", &setupCommand, args, con, &out)
	return code, out.String()
}

// terminalConsole answers the prompts with the lines of answers, and each
// masked prompt with the next of passwords.
func terminalConsole(stderr *bytes.Buffer, answers string, passwords ...string) console {
	return console{
		stdin:      strings.NewReader(answers),
		stderr:     stderr,
		isTerminal: func() bool { return true },
		readPassword: func() ([]byte, error) {
			if len(passwords) == 0 {
				return nil, errors.New("no password left to type")
			}
			next := passwords[0]
			passwords = passwords[1:]
			return []byte(next), nil
		},
	}
}

var columnGap = regexp.MustCompile(` {2,}`)

// summaryHas reports whether the summary holds line, whatever width its columns
// were aligned to.
func summaryHas(summary, line string) bool {
	return strings.Contains(columnGap.ReplaceAllString(summary, " "), columnGap.ReplaceAllString(line, " "))
}

// everyFlag is a whole install given as flags, but for the administrator's
// password.
func (e *setupEnv) everyFlag(t *testing.T) []string {
	return []string{
		"--default-locale", "en",
		"--default-timezone", "Asia/Tokyo",
		"--bucket", "publiractl-setup",
		"--region", e.s3.Region,
		"--endpoint", e.s3.Endpoint,
		"--force-path-style",
		"--access-key-id", e.s3.AccessKey,
		"--secret-access-key-file", writeSecretFile(t, e.s3.SecretKey+"\n"),
		"--host", e.smtp.Host,
		"--port", strconv.Itoa(int(e.smtp.Port)),
		"--encryption", "none",
		"--username", "mailer",
		"--from-address", "no-reply@example.com",
		"--smtp-password-file", writeSecretFile(t, testSecretValue),
		"--smtp-test-to", "operator@example.com",
		"--subject", "mailto:push@example.com",
		"--tenant-name", "Example Comics",
		"--domain", "comics.example.com",
		"--admin-email", "owner@comics.example.com",
		"--admin-name", "Owner",
	}
}

// installState is every row setup writes, as a run on a finished install must
// leave it.
func installState(t *testing.T, pg *testutil.PostgresEnv) string {
	t.Helper()
	var state string
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT concat_ws(',',
		COALESCE((SELECT revision FROM platform_config), 0),
		COALESCE((SELECT revision FROM platform_storage_config), 0),
		COALESCE((SELECT revision FROM platform_smtp_config), 0),
		COALESCE((SELECT revision FROM platform_webpush_config), 0),
		(SELECT count(*) FROM tenants),
		(SELECT count(*) FROM users),
		(SELECT count(*) FROM outbox_events),
		(SELECT count(*) FROM platform_audit_logs))`).Scan(&state); err != nil {
		t.Fatalf("read the install's state: %v", err)
	}
	return state
}

func TestSetupWithEveryFlagAndThenOnTheFinishedInstall(t *testing.T) {
	env := startSetupEnv(t)
	ctx := context.Background()

	var stderr bytes.Buffer
	everyFlag := append(env.everyFlag(t), "--non-interactive", "--generate-admin-password")
	code, stdout := runSetup(t, pipedConsole("", &stderr), everyFlag...)
	if code != 0 {
		t.Fatalf("exit code = %d\n%s", code, stderr.String())
	}
	for _, want := range []string{
		"Platform defaults    created  en, Asia/Tokyo\n",
		"Object store         created  publiractl-setup\n",
		"SMTP                 created  " + env.smtp.Host + ":" + strconv.Itoa(int(env.smtp.Port)) + ", test message sent to operator@example.com\n",
		"Web Push             created  mailto:push@example.com\n",
		"Tenant               created  Example Comics (comics.example.com)\n",
		"First administrator  created  owner@comics.example.com\n",
		"Tenant site:            https://comics.example.com\n",
		"Tenant console:         https://admin.comics.example.com\n",
	} {
		if !summaryHas(stdout, want) {
			t.Fatalf("summary = \n%s\nwant a line %q", stdout, want)
		}
	}
	if strings.Contains(stderr.String(), "Administrator password") {
		t.Fatalf("stderr shows the generated password:\n%s", stderr.String())
	}
	password := regexp.MustCompile(`Administrator password:\s+(\S+)\n`).FindStringSubmatch(stdout)
	if password == nil {
		t.Fatalf("summary = \n%s\nwant the generated password", stdout)
	}

	var passwordHash, role, timezone, defaultLocale string
	if err := env.pg.DB.QueryRowContext(ctx, `
		SELECT u.password_hash, r.role, t.timezone, t.default_locale
		FROM users u JOIN tenants t ON t.id = u.tenant_id JOIN tenant_user_roles r ON r.user_id = u.id
		WHERE u.email = 'owner@comics.example.com' AND u.email_verified_at IS NOT NULL`,
	).Scan(&passwordHash, &role, &timezone, &defaultLocale); err != nil {
		t.Fatalf("read the administrator: %v", err)
	}
	if !auth.VerifyPassword(password[1], passwordHash) || role != auth.RoleTenantAdmin {
		t.Fatalf("administrator role = %s, or the summary's password does not sign in", role)
	}
	// The tenant starts on the platform's defaults when setup names none.
	if timezone != "Asia/Tokyo" || defaultLocale != "en" {
		t.Fatalf("tenant starts on %s, %s; want Asia/Tokyo, en", timezone, defaultLocale)
	}
	if got := len(env.smtp.Messages()); got != 1 {
		t.Fatalf("test messages = %d, want 1", got)
	}
	if got := platformActions(t, env.pg); got != "platform_settings_updated,platform_storage_connection_tested,platform_storage_settings_updated,"+
		"platform_email_settings_updated,platform_smtp_test_email_sent,platform_webpush_subject_updated,tenant_created,tenant_member_created" {
		t.Fatalf("audit actions = %s", got)
	}

	// The same run again finds every step done and changes nothing.
	before := installState(t, env.pg)
	stderr.Reset()
	code, stdout = runSetup(t, pipedConsole("", &stderr), everyFlag...)
	if code != 0 {
		t.Fatalf("second run: exit code = %d\n%s", code, stderr.String())
	}
	if after := installState(t, env.pg); after != before {
		t.Fatalf("state after the second run = %s, want %s", after, before)
	}
	if got := strings.Count(stdout, " kept "); got != 6 {
		t.Fatalf("second summary = \n%s\nwant every step kept", stdout)
	}
	if strings.Contains(stdout, "Administrator password") {
		t.Fatalf("second summary prints a password:\n%s", stdout)
	}
	if got := len(env.smtp.Messages()); got != 1 {
		t.Fatalf("test messages after the second run = %d, want still 1", got)
	}
}

func TestSetupNonInteractiveNamesTheFirstMissingValue(t *testing.T) {
	env := startSetupEnv(t)
	storage := []string{"--bucket", "publiractl-setup", "--region", env.s3.Region, "--endpoint", env.s3.Endpoint, "--force-path-style", "--access-key-id", env.s3.AccessKey}

	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "nothing given", args: []string{"--non-interactive"}, want: "--default-locale is required"},
		// Stdin that is not a terminal asks nothing either.
		{name: "no terminal", args: nil, want: "--default-locale is required"},
		{name: "no bucket", args: []string{"--non-interactive", "--default-locale", "en"}, want: "--bucket is required"},
		{name: "no secret access key", args: append([]string{"--non-interactive"}, storage...), want: "--secret-access-key-file or --secret-access-key-stdin is required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stderr bytes.Buffer
			code, _ := runSetup(t, pipedConsole("", &stderr), tc.args...)
			if code != 2 || !strings.Contains(stderr.String(), "publiractl: "+tc.want+"; give it as a flag") {
				t.Fatalf("exit code = %d, stderr = %q; want 2 and %q", code, stderr.String(), tc.want)
			}
		})
	}
	// The platform defaults were saved by the run that got as far as the
	// object store, and nothing else was.
	if got := installState(t, env.pg); got != "1,0,0,0,0,0,0,1" {
		t.Fatalf("state = %s, want the platform defaults alone", got)
	}
}

// A store that refuses the connection test is not saved.
func TestSetupDoesNotSaveAStoreThatFailsTheTest(t *testing.T) {
	env := startSetupEnv(t)
	var stderr bytes.Buffer
	code, _ := runSetup(t, pipedConsole(env.s3.SecretKey, &stderr),
		"--default-locale", "en",
		"--bucket", "publiractl-missing", "--region", env.s3.Region, "--endpoint", env.s3.Endpoint, "--force-path-style",
		"--access-key-id", env.s3.AccessKey, "--secret-access-key-stdin",
	)
	if code != 1 || !strings.Contains(stderr.String(), "the object store refused the connection test (STORAGE_TEST_BUCKET_NOT_FOUND); nothing was saved") {
		t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
	}
	if got := countPlatformRows(t, env.pg, `SELECT count(*) FROM platform_storage_config`); got != 0 {
		t.Fatalf("platform_storage_config rows = %d, want 0", got)
	}
}

// A run stopped after the object store is finished by a second run that asks
// only for the steps still missing, and a flag given is not asked for.
func TestSetupResumesAnInterruptedRun(t *testing.T) {
	env := startSetupEnv(t)

	var stderr bytes.Buffer
	first := strings.Join([]string{
		"en",               // default locale
		"",                 // default time zone, UTC
		"publiractl-setup", // bucket
		env.s3.Region,      // region
		env.s3.Endpoint,    // endpoint
		"y",                // path style
		"",                 // public base URL
		env.s3.AccessKey,   // access key ID
	}, "\n") + "\n"
	code, _ := runSetup(t, terminalConsole(&stderr, first, env.s3.SecretKey))
	if code != 1 || !strings.Contains(stderr.String(), `stdin closed before "SMTP host" was answered`) {
		t.Fatalf("first run: exit code = %d, stderr = \n%s", code, stderr.String())
	}
	if got := installState(t, env.pg); got != "1,1,0,0,0,0,0,3" {
		t.Fatalf("state after the first run = %s, want the platform defaults and the store", got)
	}

	stderr.Reset()
	second := strings.Join([]string{
		env.smtp.Host,                    // SMTP host
		strconv.Itoa(int(env.smtp.Port)), // SMTP port
		"none",                           // encryption
		"mailer",                         // username
		"no-reply@example.com",           // from address
		"",                               // reply-to
		"",                               // no test message
		"n",                              // no Web Push
		"comics.example.com",             // domain
		"",                               // console domain
		"",                               // time zone, the platform's
		"",                               // locale, the platform's
		"owner@comics.example.com",       // administrator email
		"Owner",                          // administrator name
		"n",                              // type the password
	}, "\n") + "\n"
	code, stdout := runSetup(t, terminalConsole(&stderr, second, testSecretValue, "owner-password", "owner-password"), "--tenant-name", "Example Comics")
	if code != 0 {
		t.Fatalf("second run: exit code = %d\n%s", code, stderr.String())
	}
	for _, asked := range []string{"Default locale", "Bucket", "Tenant name"} {
		if strings.Contains(stderr.String(), asked) {
			t.Fatalf("second run asked for %s:\n%s", asked, stderr.String())
		}
	}
	for _, want := range []string{
		"Platform defaults    kept     en, UTC\n",
		"Object store         kept     publiractl-setup\n",
		"Web Push             skipped  publiractl webpush init turns it on\n",
		"Tenant               created  Example Comics (comics.example.com)\n",
		"First administrator  created  owner@comics.example.com\n",
	} {
		if !summaryHas(stdout, want) {
			t.Fatalf("summary = \n%s\nwant a line %q", stdout, want)
		}
	}
	if strings.Contains(stdout, "Administrator password") {
		t.Fatalf("summary prints a password that was typed:\n%s", stdout)
	}
	var passwordHash string
	if err := env.pg.DB.QueryRowContext(context.Background(), `SELECT password_hash FROM users WHERE email = 'owner@comics.example.com'`).Scan(&passwordHash); err != nil {
		t.Fatalf("read the administrator: %v", err)
	}
	if !auth.VerifyPassword("owner-password", passwordHash) {
		t.Fatal("the administrator does not sign in with the password typed")
	}
}

func TestSetupRefusesMismatchedAdministratorPasswords(t *testing.T) {
	env := startSetupEnv(t)
	var stderr bytes.Buffer
	// Every required value is a flag, so the terminal is asked only for the
	// optional ones and whether to generate the password.
	answers := strings.Repeat("\n", 5) + "n\n"
	code, _ := runSetup(t, terminalConsole(&stderr, answers, "owner-password", "another"), env.everyFlag(t)...)
	if code != 1 || !strings.Contains(stderr.String(), "the two administrator passwords do not match") {
		t.Fatalf("exit code = %d, stderr = \n%s", code, stderr.String())
	}
	if got := countPlatformRows(t, env.pg, `SELECT count(*) FROM users`); got != 0 {
		t.Fatalf("users = %d, want none", got)
	}
}

// An address that belongs to a user of the tenant without the admin role is
// refused rather than reported as the administrator kept.
func TestSetupRefusesAnExistingUserWithoutTheAdminRole(t *testing.T) {
	env := startSetupEnv(t)
	args := append(env.everyFlag(t), "--non-interactive", "--generate-admin-password")
	var stderr bytes.Buffer
	if code, _ := runSetup(t, pipedConsole("", &stderr), args...); code != 0 {
		t.Fatalf("first run: exit code = %d\n%s", code, stderr.String())
	}
	if _, err := env.pg.DB.ExecContext(context.Background(), `UPDATE tenant_user_roles SET role = 'tenant_editor'`); err != nil {
		t.Fatalf("demote the administrator: %v", err)
	}

	stderr.Reset()
	code, stdout := runSetup(t, pipedConsole("", &stderr), args...)
	want := "publiractl: --admin-email: owner@comics.example.com is a user of the tenant with tenant_editor, not tenant_admin"
	if code != 1 || !strings.HasPrefix(stderr.String()[strings.LastIndex(stderr.String(), "publiractl:"):], want) {
		t.Fatalf("exit code = %d, stderr = %q; want 1 and %q", code, stderr.String(), want)
	}
	if strings.Contains(stdout, "First administrator") {
		t.Fatalf("summary reports the administrator:\n%s", stdout)
	}
}
