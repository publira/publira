package main

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/maintenancejobs"
)

func TestRunWithoutCommand(t *testing.T) {
	var stderr strings.Builder
	if code := run(nil, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr.String(), "Usage: publiractl <command>") {
		t.Fatalf("stderr = %q, want the usage text", stderr.String())
	}
}

// A job named without its group is an unknown command, not a job run.
func TestRunUnknownCommand(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"purge-content-events"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	out := stderr.String()
	if !strings.Contains(out, `unknown command "purge-content-events"`) {
		t.Fatalf("stderr = %q, want the rejected name", out)
	}
	if !strings.Contains(out, "Usage: publiractl <command>") {
		t.Fatalf("stderr = %q, want the usage text", out)
	}
}

func TestRunJobWithoutKind(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"job"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr.String(), "Usage: publiractl job <kind>") {
		t.Fatalf("stderr = %q, want the job usage text", stderr.String())
	}
}

func TestRunUnknownJob(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"job", "publish-episode"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	out := stderr.String()
	if !strings.Contains(out, `unknown job "publish-episode"`) {
		t.Fatalf("stderr = %q, want the rejected name", out)
	}
	if !strings.Contains(out, "Usage: publiractl job <kind>") {
		t.Fatalf("stderr = %q, want the job usage text", out)
	}
}

func TestRunJobRejectsExtraArguments(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"job", "purge-content-events", "--dry-run"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr.String(), "takes no arguments") {
		t.Fatalf("stderr = %q, want the extra argument rejection", stderr.String())
	}
}

func TestJobUsageListsEveryJob(t *testing.T) {
	out := jobUsage()
	for _, j := range jobs {
		if !strings.Contains(out, j.name) {
			t.Fatalf("usage text is missing %q", j.name)
		}
	}
}

func TestJobsAreWiredAndUnique(t *testing.T) {
	seen := make(map[string]bool, len(jobs))
	for _, j := range jobs {
		if j.run == nil {
			t.Fatalf("job %q has no run function", j.name)
		}
		if seen[j.name] {
			t.Fatalf("job %q is registered twice", j.name)
		}
		seen[j.name] = true
		if lookup(j.name) == nil {
			t.Fatalf("lookup(%q) = nil, want the registered job", j.name)
		}
	}
}

// Every job is one-to-one with a worker maintenance kind, which a manual run
// shares its service.name with.
func TestJobsMatchTheWorkerMaintenanceKinds(t *testing.T) {
	var got []string
	for _, j := range jobs {
		got = append(got, "publira-"+j.name)
	}
	want := maintenancejobs.ServiceNames()
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("job service names = %v, want the maintenance kinds' %v", got, want)
	}
}

// The date a rebuild covers is each tenant's own local one, so an unset
// variable cannot be answered with a single day: it yields the zero time, and
// the job resolves every tenant's yesterday in that tenant's zone.
func TestResolveTenantLocalDate(t *testing.T) {
	const name = "PUBLIRA_CONTENT_STATS_DATE"

	t.Setenv(name, "2026-08-28")
	got, err := resolveTenantLocalDate(name)
	if err != nil {
		t.Fatalf("resolveTenantLocalDate: %v", err)
	}
	if want := "2026-08-28"; got.Format(time.DateOnly) != want {
		t.Fatalf("date = %s, want %s", got.Format(time.DateOnly), want)
	}

	t.Setenv(name, "not-a-date")
	var parseErr *time.ParseError
	if _, err := resolveTenantLocalDate(name); !errors.As(err, &parseErr) {
		t.Fatalf("invalid date error = %v, want a ParseError", err)
	}

	t.Setenv(name, "  ")
	if got, err := resolveTenantLocalDate(name); err != nil || !got.IsZero() {
		t.Fatalf("blank date = (%s, %v), want (the zero time, nil)", got, err)
	}
}

func TestResolveDryRun(t *testing.T) {
	const name = "PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN"

	t.Setenv(name, "")
	if got, err := resolveDryRun(name); err != nil || got {
		t.Fatalf("default dry-run = (%t, %v), want (false, nil)", got, err)
	}

	t.Setenv(name, " true ")
	if got, err := resolveDryRun(name); err != nil || !got {
		t.Fatalf("dry-run = (%t, %v), want (true, nil)", got, err)
	}

	t.Setenv(name, "maybe")
	if _, err := resolveDryRun(name); err == nil {
		t.Fatal("invalid dry-run error = nil, want an error")
	}
}
