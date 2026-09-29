package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/testutil"
)

// platformCommand runs one platform command against the database
// PUBLIRA_PLATFORM_DB_URL names, and returns its exit code and what it printed.
func platformCommand(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runGroup(&platformGroup, args, pipedConsole("", &errOut), &out)
	return code, out.String(), errOut.String()
}

func mustPlatformCommand(t *testing.T, args ...string) string {
	t.Helper()
	code, stdout, stderr := platformCommand(t, args...)
	if code != 0 {
		t.Fatalf("platform %s: exit code = %d\n%s", strings.Join(args, " "), code, stderr)
	}
	return stdout
}

func storedPlatformConfig(t *testing.T, pg *testutil.PostgresEnv) (timezone, defaultLocale string, revision int64) {
	t.Helper()
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT default_timezone, default_locale, revision FROM platform_config`).
		Scan(&timezone, &defaultLocale, &revision); err != nil {
		t.Fatalf("read platform_config: %v", err)
	}
	return timezone, defaultLocale, revision
}

func TestPlatformSetSavesTheDefaultsNewTenantsStartOn(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)

	if got := mustPlatformCommand(t, "show"); got != "No platform defaults are saved, so new tenants start on UTC\n" {
		t.Fatalf("show before a save = %q", got)
	}
	if got := mustPlatformCommand(t, "set", "--default-locale", "en", "--default-timezone", "Asia/Tokyo"); got != "Saved the platform defaults en and Asia/Tokyo, revision 1\n" {
		t.Fatalf("set = %q", got)
	}

	// The same values again change no row and file no entry.
	mustPlatformCommand(t, "set", "--default-locale", "en", "--default-timezone", "Asia/Tokyo")
	if _, _, revision := storedPlatformConfig(t, pg); revision != 1 {
		t.Fatalf("revision after an unchanged save = %d, want 1", revision)
	}
	if got := platformActions(t, pg); got != "platform_settings_updated" {
		t.Fatalf("audit actions = %s", got)
	}

	var stdout, stderr bytes.Buffer
	if code := runGroup(&tenantGroup, []string{"create", "--name", "Example", "--domain", "comics.example.com", "--default-locale", "en"}, pipedConsole("", &stderr), &stdout); code != 0 {
		t.Fatalf("tenant create: exit code = %d\n%s", code, stderr.String())
	}
	var tenantTimezone string
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT timezone FROM tenants`).Scan(&tenantTimezone); err != nil {
		t.Fatalf("read the tenant: %v", err)
	}
	if tenantTimezone != "Asia/Tokyo" {
		t.Fatalf("new tenant starts on %q, want Asia/Tokyo", tenantTimezone)
	}

	// A flag left out keeps the stored value.
	mustPlatformCommand(t, "set", "--default-locale", "ja")
	if timezone, defaultLocale, revision := storedPlatformConfig(t, pg); timezone != "Asia/Tokyo" || defaultLocale != "ja" || revision != 2 {
		t.Fatalf("stored = %s, %s, revision %d; want Asia/Tokyo, ja, revision 2", timezone, defaultLocale, revision)
	}
	show := mustPlatformCommand(t, "show")
	for _, want := range []string{"Default locale:     ja\n", "Default time zone:  Asia/Tokyo\n", "Revision:           2\n"} {
		if !strings.Contains(show, want) {
			t.Fatalf("show = \n%s\nwant a line %q", show, want)
		}
	}
}

// A refusal names its flag, and nothing is written.
func TestPlatformSetNamesTheRefusedFlag(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)

	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "nothing given", args: []string{"set"}, want: "publiractl: no value was given; name --default-locale, --default-timezone, or both\n"},
		{name: "no locale saved or given", args: []string{"set", "--default-timezone", "Asia/Tokyo"}, want: "publiractl: --default-locale: default_locale must be a supported locale\n"},
		{name: "unsupported locale", args: []string{"set", "--default-locale", "fr"}, want: "publiractl: --default-locale: default_locale must be a supported locale\n"},
		{name: "unknown time zone", args: []string{"set", "--default-locale", "en", "--default-timezone", "Mars/Olympus_Mons"}, want: "publiractl: --default-timezone: timezone must be a valid IANA time zone name\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, _, stderr := platformCommand(t, tc.args...)
			if code != 1 {
				t.Fatalf("exit code = %d, want 1\n%s", code, stderr)
			}
			if stderr != tc.want {
				t.Fatalf("stderr = %q, want %q", stderr, tc.want)
			}
		})
	}

	var rows int
	if err := pg.DB.QueryRowContext(context.Background(), `SELECT count(*) FROM platform_config`).Scan(&rows); err != nil {
		t.Fatalf("count platform_config: %v", err)
	}
	if rows != 0 {
		t.Fatalf("platform_config rows = %d after refusals, want 0", rows)
	}
}
