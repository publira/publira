package main

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// policyCommand runs one policy command against the database
// PUBLIRA_PLATFORM_DB_URL names, and returns its exit code and what it printed.
func policyCommand(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runGroup(&policyGroup, args, pipedConsole("", &errOut), &out)
	return code, out.String(), errOut.String()
}

func mustPolicyCommand(t *testing.T, args ...string) string {
	t.Helper()
	code, stdout, stderr := policyCommand(t, args...)
	if code != 0 {
		t.Fatalf("policy %s: exit code = %d\n%s", strings.Join(args, " "), code, stderr)
	}
	return stdout
}

func startPlatformDB(t *testing.T) *testutil.PostgresEnv {
	t.Helper()
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	return pg
}

func countPlatformRows(t *testing.T, pg *testutil.PostgresEnv, query string) int {
	t.Helper()
	var n int
	if err := pg.DB.QueryRowContext(context.Background(), query).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func TestPolicyShowPrintsTheBuiltInDefaultsWhenNothingIsSaved(t *testing.T) {
	startPlatformDB(t)

	show := mustPolicyCommand(t, "show")
	if first, _, _ := strings.Cut(show, "\n"); first != "No platform policy is saved, so these built-in defaults apply" {
		t.Fatalf("show's first line = %q, want the built-in defaults marked as such", first)
	}
	defaults := platformpolicy.Defaults()
	if got, want := showLine(t, show, "Password verifications"), perMinute(defaults.PasswordVerification); got != want {
		t.Fatalf("show's password verifications = %q, want the built-in %q", got, want)
	}
	if got := showLine(t, show, "  Duplicate comment window"); got != "10 minutes" {
		t.Fatalf("show's duplicate comment window = %q, want the built-in 10 minutes", got)
	}
	if strings.Contains(show, "Revision:") {
		t.Fatalf("show printed a revision with nothing saved:\n%s", show)
	}
}

// A running server rereads the row within platformpolicy.CacheTTL; a resolver
// with no TTL shows what that reread finds, on the public API's own role.
func TestPolicySetReachesARunningServer(t *testing.T) {
	pg := startPlatformDB(t)
	ctx := context.Background()
	server := platformpolicy.NewResolver(dbmodels.New(pg.OpenPublicDB(t)), 0, slog.Default())

	got := mustPolicyCommand(t, "set", "--comment-post-per-minute", "3", "--mfa-required-for-tenant-admin")
	if want := "Saved the platform policy, revision 1. Running servers apply it within 10s.\n"; got != want {
		t.Fatalf("set = %q, want %q", got, want)
	}
	want := platformpolicy.Defaults()
	want.Community.CommentPost.PerMinute = 3
	want.MFARequiredForTenantAdmin = true
	if got, err := server.Policy(ctx); err != nil || got != want {
		t.Fatalf("the server's policy after set = %+v, %v; want %+v", got, err, want)
	}

	// A flag not given keeps what the last save stored rather than the
	// built-in default.
	mustPolicyCommand(t, "set", "--comment-post-per-day", "40", "--mfa-required-for-tenant-admin=false")
	want.Community.CommentPost.PerDay = 40
	want.MFARequiredForTenantAdmin = false
	if got, err := server.Policy(ctx); err != nil || got != want {
		t.Fatalf("the server's policy after a second set = %+v, %v; want %+v", got, err, want)
	}

	show := mustPolicyCommand(t, "show")
	if strings.HasPrefix(show, "No platform policy is saved") {
		t.Fatalf("show marked a saved policy as the built-in defaults:\n%s", show)
	}
	if got := showLine(t, show, "  Comment posts"); got != "3 per minute, 40 per day" {
		t.Fatalf("show's comment posts = %q", got)
	}
	if got := showLine(t, show, "Revision"); got != "2" {
		t.Fatalf("show's revision = %q, want 2", got)
	}
	if got := countPlatformRows(t, pg,
		`SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_policy_updated' AND actor_role = 'system' AND actor_platform_user_id IS NULL`,
	); got != 2 {
		t.Fatalf("platform_policy_updated entries under the system actor = %d, want 2", got)
	}
}

// Every numeric flag refused on its own names itself, through the field the
// Connect handler names as well.
func TestPolicySetNamesTheFlagOfARefusedValue(t *testing.T) {
	pg := startPlatformDB(t)

	for _, field := range policyFlags {
		t.Run(field.flag, func(t *testing.T) {
			code, stdout, stderr := policyCommand(t, "set", "--"+field.flag, "0")
			if code != 1 {
				t.Fatalf("exit code = %d, want 1\n%s", code, stderr)
			}
			if want := "publiractl: --" + field.flag + ": " + field.field + " must"; !strings.HasPrefix(stderr, want) {
				t.Fatalf("stderr = %q, want it to begin %q", stderr, want)
			}
			if stdout != "" {
				t.Fatalf("stdout = %q, want nothing", stdout)
			}
		})
	}
	if got := countPlatformRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 0 {
		t.Fatalf("platform_policy_config rows = %d, want the refused saves to write nothing", got)
	}
	if got := countPlatformRows(t, pg, `SELECT COUNT(*) FROM platform_audit_logs`); got != 0 {
		t.Fatalf("platform_audit_logs rows = %d, want nothing filed for a refused save", got)
	}
}

// With no flag there is nothing to change, and saving the values read would
// pin the built-in defaults as though an operator had chosen them.
func TestPolicySetWithNoFlagWritesNothing(t *testing.T) {
	pg := startPlatformDB(t)

	code, _, stderr := policyCommand(t, "set")
	if code != 1 || !strings.Contains(stderr, errNoPolicyFlag.Error()) {
		t.Fatalf("set with no flag = exit %d, %q; want exit 1 naming the missing flag", code, stderr)
	}
	if got := countPlatformRows(t, pg, `SELECT COUNT(*) FROM platform_policy_config`); got != 0 {
		t.Fatalf("platform_policy_config rows = %d, want 0", got)
	}
}

// messageLeaves are the paths of every scalar field of md, into the messages
// it holds.
func messageLeaves(md protoreflect.MessageDescriptor, prefix string) []string {
	var leaves []string
	fields := md.Fields()
	for i := range fields.Len() {
		fd := fields.Get(i)
		path := prefix + string(fd.Name())
		if fd.Kind() == protoreflect.MessageKind {
			leaves = append(leaves, messageLeaves(fd.Message(), path+".")...)
			continue
		}
		leaves = append(leaves, path)
	}
	return leaves
}

// A field added to the policy is one publiractl policy set has to be able to
// change as well.
func TestPolicyFlagsCoverEveryPolicyField(t *testing.T) {
	flags := map[string]bool{"mfa_required_for_tenant_admin": true}
	for _, field := range policyFlags {
		flags[field.field] = true
	}
	for _, leaf := range messageLeaves((&publirasplatformv1.PlatformPolicy{}).ProtoReflect().Descriptor(), "") {
		if !flags[leaf] {
			t.Errorf("PlatformPolicy.%s has no policy set flag", leaf)
		}
	}
}
