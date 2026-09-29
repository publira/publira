package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/publira/publira/server/config"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/testutil"
)

const testSecretValue = "hunter2-do-not-echo"

// testGroup is a settings group whose one command stores a password, recording
// what it was given rather than writing anywhere.
type testGroup struct {
	stored   string
	wrote    bool
	failWith error
}

func (tg *testGroup) group() *commandGroup {
	return &commandGroup{
		name:    "example",
		summary: "An example settings group",
		commands: []command{{
			name:    "save",
			summary: "Save the example settings",
			setup: func(f *commandFlags) func(context.Context, *commandEnv) error {
				host := f.String("host", "", "the host to save")
				password := f.Secret("password", "example password")
				return func(_ context.Context, env *commandEnv) error {
					if tg.failWith != nil {
						return tg.failWith
					}
					secrets, err := env.secretManager()
					if err != nil {
						return err
					}
					value, err := password.read(env.console)
					if err != nil {
						return err
					}
					encrypted, err := secrets.EncryptString(value)
					if err != nil {
						return err
					}
					tg.stored, tg.wrote = encrypted, true
					_, err = env.stdout.Write([]byte("saved " + *host + "\n"))
					return err
				}
			},
		}},
	}
}

func pipedConsole(stdin string, stderr *bytes.Buffer) console {
	return console{
		stdin:        strings.NewReader(stdin),
		stderr:       stderr,
		isTerminal:   func() bool { return false },
		readPassword: func() ([]byte, error) { panic("stdin is not a terminal") },
	}
}

func setEncryptionKeys(t *testing.T) {
	t.Helper()
	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_KEYS", "k1:"+base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)))
	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "k1")
}

func TestRunGroupStoresASecretReadFromStdin(t *testing.T) {
	setEncryptionKeys(t)
	tg := &testGroup{}
	var stdout, stderr bytes.Buffer

	code := runGroup(tg.group(), []string{"save", "--host", "smtp.example.com", "--password-stdin"}, pipedConsole(testSecretValue+"\n", &stderr), &stdout)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0\n%s", code, stderr.String())
	}
	if got, want := stdout.String(), "saved smtp.example.com\n"; got != want {
		t.Fatalf("stdout = %q, want %q", got, want)
	}

	// The servers decrypt with a manager built from the same variables.
	cfg, err := config.New()
	if err != nil {
		t.Fatalf("config.New: %v", err)
	}
	servers, err := secretcrypto.NewManager(cfg.Encryption.Keys, cfg.Encryption.PrimaryKeyID)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	if got, err := servers.DecryptString(tg.stored); err != nil || got != testSecretValue {
		t.Fatalf("decrypted = %q, %v; want %q", got, err, testSecretValue)
	}
}

func TestRunGroupStopsBeforeWritingWithoutEncryptionKeys(t *testing.T) {
	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_KEYS", "")
	t.Setenv("PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID", "")
	tg := &testGroup{}
	var stdout, stderr bytes.Buffer

	code := runGroup(tg.group(), []string{"save", "--password-stdin"}, pipedConsole(testSecretValue, &stderr), &stdout)
	if code != 1 {
		t.Fatalf("exit code = %d, want 1\n%s", code, stderr.String())
	}
	if tg.wrote {
		t.Fatal("the command wrote with no encryption keys")
	}
	if !strings.Contains(stderr.String(), "PUBLIRA_SECRET_ENCRYPTION_KEYS") {
		t.Fatalf("stderr = %q, want the missing variable named", stderr.String())
	}
}

func TestRunGroupReportsACommandFailure(t *testing.T) {
	tg := &testGroup{failWith: errors.New("the object store refused the credentials")}
	var stdout, stderr bytes.Buffer

	code := runGroup(tg.group(), []string{"save"}, pipedConsole("", &stderr), &stdout)
	if code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	if got, want := stderr.String(), "publiractl: the object store refused the credentials\n"; got != want {
		t.Fatalf("stderr = %q, want %q", got, want)
	}
	if strings.Contains(stderr.String(), "Usage:") {
		t.Fatal("a command failure printed the usage text")
	}
}

// A secret given where a flag or an argument goes is refused as a usage error,
// and the refusal does not repeat it into a log.
func TestRunGroupRefusesASecretOnTheCommandLine(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{name: "as a flag value", args: []string{"save", "--password=" + testSecretValue}, want: "flag provided but not defined: --password"},
		{name: "as a flag followed by its value", args: []string{"save", "--password", testSecretValue}, want: "flag provided but not defined: --password"},
		{name: "as a positional argument", args: []string{"save", testSecretValue}, want: "takes no positional arguments"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setEncryptionKeys(t)
			tg := &testGroup{}
			var stdout, stderr bytes.Buffer

			code := runGroup(tg.group(), tc.args, pipedConsole("", &stderr), &stdout)
			if code != 2 {
				t.Fatalf("exit code = %d, want 2\n%s", code, stderr.String())
			}
			out := stderr.String()
			if !strings.Contains(out, tc.want) {
				t.Fatalf("stderr = %q, want %q", out, tc.want)
			}
			if !strings.Contains(out, "Usage: publiractl example save [flags]") {
				t.Fatalf("stderr = %q, want the command usage", out)
			}
			if strings.Contains(out, testSecretValue) {
				t.Fatalf("stderr repeats the secret: %q", out)
			}
			if tg.wrote {
				t.Fatal("the command ran")
			}
		})
	}
}

func TestRunGroupUsageErrors(t *testing.T) {
	for _, tc := range []struct {
		name  string
		args  []string
		want  string
		usage string
	}{
		{name: "no command", args: nil, want: "example requires a command", usage: "Usage: publiractl example <command>"},
		{name: "unknown command", args: []string{"delete"}, want: `unknown example command "delete"`, usage: "Usage: publiractl example <command>"},
		{name: "unknown flag", args: []string{"save", "--port", "25"}, want: "flag provided but not defined: --port", usage: "Usage: publiractl example save [flags]"},
		// The flag package spells every flag with one dash, whichever it was given.
		{name: "unknown flag given with one dash", args: []string{"save", "-port", "25"}, want: "flag provided but not defined: --port", usage: "Usage: publiractl example save [flags]"},
		{name: "flag with no value", args: []string{"save", "--host"}, want: "flag needs an argument: --host", usage: "Usage: publiractl example save [flags]"},
		{name: "malformed boolean", args: []string{"save", "--password-stdin=maybe"}, want: `invalid boolean value "maybe" for --password-stdin: parse error`, usage: "Usage: publiractl example save [flags]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			code := runGroup((&testGroup{}).group(), tc.args, pipedConsole("", &stderr), &stdout)
			if code != 2 {
				t.Fatalf("exit code = %d, want 2", code)
			}
			if !strings.HasPrefix(stderr.String(), "publiractl: "+tc.want+"\n") {
				t.Fatalf("stderr = %q, want it to start with %q", stderr.String(), tc.want)
			}
			if !strings.Contains(stderr.String(), tc.usage) {
				t.Fatalf("stderr = %q, want %q", stderr.String(), tc.usage)
			}
		})
	}
}

func TestRunGroupHelpListsTheSecretFlag(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := runGroup((&testGroup{}).group(), []string{"save", "-h"}, pipedConsole("", &stderr), &stdout)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	for _, want := range []string{"\n  --host string\n", "\n  --password-stdin\n", "masked prompt"} {
		if !strings.Contains(stderr.String(), want) {
			t.Fatalf("usage = %q, want %q", stderr.String(), want)
		}
	}
	if strings.Contains(stderr.String(), "\n  -host") {
		t.Fatalf("usage = %q, want every flag spelled with two dashes", stderr.String())
	}
}

// Every other role's variable and PUBLIRA_DB_URL are set throughout, and none
// of them may be picked up: the settings commands write as publira_platform,
// and a forgotten variable leaves them on its development URL rather than on
// the superuser.
func TestPlatformDBURLResolvesThePlatformRoleAlone(t *testing.T) {
	for _, name := range []string{
		"PUBLIRA_DB_URL",
		"PUBLIRA_PUBLIC_DB_URL",
		"PUBLIRA_ADMIN_DB_URL",
		"PUBLIRA_WORKER_DB_URL",
		"PUBLIRA_TICKER_DB_URL",
		"PUBLIRA_CONTENT_STATS_DB_URL",
	} {
		t.Setenv(name, name+"-value")
	}

	t.Setenv("PUBLIRA_PLATFORM_DB_URL", "  platform-url  ")
	if got := platformDBURL(); got != "platform-url" {
		t.Fatalf("URL = %q, want platform-url", got)
	}
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", "")
	if got := platformDBURL(); got != defaultPlatformDBURL {
		t.Fatalf("URL without PUBLIRA_PLATFORM_DB_URL = %q, want %q", got, defaultPlatformDBURL)
	}
}

func TestOpenPlatformDBConnectsAsThePlatformRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)

	db, err := (&commandEnv{}).openPlatformDB()
	if err != nil {
		t.Fatalf("openPlatformDB: %v", err)
	}
	defer db.Close() //nolint:errcheck

	var role string
	if err := db.QueryRowContext(t.Context(), "SELECT current_user").Scan(&role); err != nil {
		t.Fatalf("current_user: %v", err)
	}
	if role != "publira_platform" {
		t.Fatalf("current_user = %q, want publira_platform", role)
	}
}
