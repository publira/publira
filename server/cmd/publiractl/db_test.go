package main

import (
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/dbmigrate"
	"github.com/publira/publira/server/internal/testutil"
)

func TestRunDBWithoutCommand(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"db"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr.String(), "Usage: publiractl db <command>") {
		t.Fatalf("stderr = %q, want the db usage text", stderr.String())
	}
}

func TestRunUnknownDBCommand(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"db", "rollback"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	out := stderr.String()
	if !strings.Contains(out, `unknown db command "rollback"`) {
		t.Fatalf("stderr = %q, want the rejected name", out)
	}
	if !strings.Contains(out, "Usage: publiractl db <command>") {
		t.Fatalf("stderr = %q, want the db usage text", out)
	}
}

func TestRunDBRejectsExtraArguments(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"db", "migrate", "20260101000000"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	out := stderr.String()
	if !strings.Contains(out, "takes no arguments") {
		t.Fatalf("stderr = %q, want the extra argument rejection", out)
	}
	if !strings.Contains(out, "Usage: publiractl db <command>") {
		t.Fatalf("stderr = %q, want the db usage text", out)
	}
}

func TestDBUsageListsEveryCommand(t *testing.T) {
	out := dbUsage()
	for _, c := range dbCommands {
		if !strings.Contains(out, c.name) {
			t.Fatalf("usage text is missing %q", c.name)
		}
	}
}

// A deployment that forgot the variable must not be migrated against the
// development database the job group falls back to.
func TestDBMigrateRefusesWithoutDBURL(t *testing.T) {
	code, output := testutil.RunMain(t, []string{}, "db", "migrate")
	if code == 0 {
		t.Fatalf("exit code = 0, want a failure\n%s", output)
	}
	if !strings.Contains(output, "PUBLIRA_DB_URL") {
		t.Fatalf("output does not name the missing variable:\n%s", output)
	}
}

func TestDBMigrateTakesAnEmptyDatabaseToTheHead(t *testing.T) {
	pg := testutil.StartPostgres(t)
	env := testutil.Env(map[string]string{"PUBLIRA_DB_URL": pg.CreateEmptyDatabase(t)})
	head := strconv.FormatUint(uint64(headVersion(t)), 10)

	if code, output := testutil.RunMain(t, env, "db", "version"); code != 0 || !strings.Contains(output, "version 0\ndirty false\n") {
		t.Fatalf("version before migrating = (%d, %q), want version 0, not dirty", code, output)
	}
	if code, output := testutil.RunMain(t, env, "db", "migrate"); code != 0 {
		t.Fatalf("exit code = %d, want 0\n%s", code, output)
	}
	if code, output := testutil.RunMain(t, env, "db", "version"); code != 0 || !strings.Contains(output, "version "+head+"\ndirty false\n") {
		t.Fatalf("version after migrating = (%d, %q), want version %s, not dirty", code, output, head)
	}

	// A second run finds nothing to apply, and that is not a failure.
	code, output := testutil.RunMain(t, env, "db", "migrate")
	if code != 0 {
		t.Fatalf("second run exit code = %d, want 0\n%s", code, output)
	}
	if !strings.Contains(output, "from_version="+head) || !strings.Contains(output, "to_version="+head) {
		t.Fatalf("second run did not start and end at version %s:\n%s", head, output)
	}
}

// headVersion is the version of the newest file in db/migrations.
func headVersion(t *testing.T) uint {
	t.Helper()
	dir, err := dbmigrate.RepoDir()
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var head uint64
	for _, e := range entries {
		prefix, _, _ := strings.Cut(e.Name(), "_")
		v, err := strconv.ParseUint(prefix, 10, 64)
		if err != nil {
			t.Fatalf("migration %s has no numeric version: %v", e.Name(), err)
		}
		head = max(head, v)
	}
	return uint(head)
}
