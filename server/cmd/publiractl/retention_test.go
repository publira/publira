package main

import (
	"bytes"
	"context"
	"strconv"
	"strings"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/retention"
)

// retentionCommand runs one retention command against the database
// PUBLIRA_PLATFORM_DB_URL names, and returns its exit code and what it printed.
func retentionCommand(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runGroup(&retentionGroup, args, pipedConsole("", &errOut), &out)
	return code, out.String(), errOut.String()
}

func mustRetentionCommand(t *testing.T, args ...string) string {
	t.Helper()
	code, stdout, stderr := retentionCommand(t, args...)
	if code != 0 {
		t.Fatalf("retention %s: exit code = %d\n%s", strings.Join(args, " "), code, stderr)
	}
	return stdout
}

func TestRetentionShowPrintsTheBuiltInDefaultsWhenNothingIsSaved(t *testing.T) {
	startPlatformDB(t)

	show := mustRetentionCommand(t, "show")
	if first, _, _ := strings.Cut(show, "\n"); first != "No retention defaults are saved, so these built-in ones apply" {
		t.Fatalf("show's first line = %q, want the built-in defaults marked as such", first)
	}
	builtin := retention.Builtin()
	for label, days := range map[string]int{
		"Withdrawn comments":       builtin.WithdrawnCommentDays,
		"Content events":           builtin.ContentEventDays,
		"Daily ranking snapshots":  builtin.DailyRankingSnapshotDays,
		"Weekly ranking snapshots": builtin.WeeklyRankingSnapshotDays,
	} {
		if got, want := showLine(t, show, label), strconv.Itoa(days)+" days"; got != want {
			t.Fatalf("show's %s = %q, want the built-in %q", label, got, want)
		}
	}
	if strings.Contains(show, "Revision:") {
		t.Fatalf("show printed a revision with nothing saved:\n%s", show)
	}
}

// The purge jobs read the defaults at the start of every run, on their own
// role.
func TestRetentionSetReachesThePurgeJobs(t *testing.T) {
	pg := startPlatformDB(t)
	ctx := context.Background()
	jobs := dbmodels.New(pg.OpenContentStatsDB(t))

	got := mustRetentionCommand(t, "set", "--content-event-days", "30")
	if want := "Saved the retention defaults, revision 1. Each purge applies them from its next run.\n"; got != want {
		t.Fatalf("set = %q, want %q", got, want)
	}
	want := retention.Builtin()
	want.ContentEventDays = 30
	if table, err := retention.LoadTable(ctx, jobs); err != nil || table.Defaults() != want {
		t.Fatalf("the purges' defaults after set = %+v, %v; want %+v", table.Defaults(), err, want)
	}

	// A flag not given keeps what the last save stored rather than the
	// built-in period.
	mustRetentionCommand(t, "set", "--weekly-ranking-snapshot-days", "800")
	want.WeeklyRankingSnapshotDays = 800
	if table, err := retention.LoadTable(ctx, jobs); err != nil || table.Defaults() != want {
		t.Fatalf("the purges' defaults after a second set = %+v, %v; want %+v", table.Defaults(), err, want)
	}

	show := mustRetentionCommand(t, "show")
	if got := showLine(t, show, "Content events"); got != "30 days" {
		t.Fatalf("show's content events = %q", got)
	}
	if got := showLine(t, show, "Revision"); got != "2" {
		t.Fatalf("show's revision = %q, want 2", got)
	}
	if got := countPlatformRows(t, pg,
		`SELECT COUNT(*) FROM platform_audit_logs WHERE action = 'platform_retention_defaults_updated' AND actor_role = 'system' AND actor_platform_user_id IS NULL`,
	); got != 2 {
		t.Fatalf("platform_retention_defaults_updated entries under the system actor = %d, want 2", got)
	}
}

// Every flag refused names itself, through the field the Connect handler
// names as well.
func TestRetentionSetNamesTheFlagOfARefusedPeriod(t *testing.T) {
	pg := startPlatformDB(t)

	for _, field := range retentionFlags {
		for _, days := range []int{0, retention.MaxDays + 1} {
			code, stdout, stderr := retentionCommand(t, "set", "--"+field.flag, strconv.Itoa(days))
			if code != 1 {
				t.Fatalf("--%s %d: exit code = %d, want 1\n%s", field.flag, days, code, stderr)
			}
			if want := "publiractl: --" + field.flag + ": " + field.field + " must"; !strings.HasPrefix(stderr, want) {
				t.Fatalf("--%s %d: stderr = %q, want it to begin %q", field.flag, days, stderr, want)
			}
			if stdout != "" {
				t.Fatalf("--%s %d: stdout = %q, want nothing", field.flag, days, stdout)
			}
		}
	}
	if got := countPlatformRows(t, pg, `SELECT COUNT(*) FROM platform_retention_config`); got != 0 {
		t.Fatalf("platform_retention_config rows = %d, want the refused saves to write nothing", got)
	}
}

// A period added to the defaults is one publiractl retention set has to be
// able to change as well.
func TestRetentionFlagsCoverEveryPeriod(t *testing.T) {
	flags := map[string]bool{}
	for _, field := range retentionFlags {
		flags[field.field] = true
	}
	for _, leaf := range messageLeaves((&publirattypesv1.RetentionPeriods{}).ProtoReflect().Descriptor(), "") {
		if !flags[leaf] {
			t.Errorf("RetentionPeriods.%s has no retention set flag", leaf)
		}
	}
}
