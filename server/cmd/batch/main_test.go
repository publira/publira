package main

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestRunWithoutSubcommand(t *testing.T) {
	var stderr strings.Builder
	if code := run(nil, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr.String(), "Usage: batch <subcommand>") {
		t.Fatalf("stderr = %q, want the usage text", stderr.String())
	}
}

func TestRunUnknownSubcommand(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"publish-episode"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	out := stderr.String()
	if !strings.Contains(out, `unknown subcommand "publish-episode"`) {
		t.Fatalf("stderr = %q, want the rejected name", out)
	}
	if !strings.Contains(out, "Usage: batch <subcommand>") {
		t.Fatalf("stderr = %q, want the usage text", out)
	}
}

func TestRunRejectsExtraArguments(t *testing.T) {
	var stderr strings.Builder
	if code := run([]string{"purge-content-events", "--dry-run"}, &stderr); code == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr.String(), "takes no arguments") {
		t.Fatalf("stderr = %q, want the extra argument rejection", stderr.String())
	}
}

func TestUsageListsEverySubcommand(t *testing.T) {
	out := usage()
	for _, cmd := range subcommands {
		if !strings.Contains(out, cmd.name) {
			t.Fatalf("usage text is missing %q", cmd.name)
		}
	}
}

func TestSubcommandsAreWiredAndUnique(t *testing.T) {
	seen := make(map[string]bool, len(subcommands))
	for _, cmd := range subcommands {
		if cmd.run == nil {
			t.Fatalf("subcommand %q has no run function", cmd.name)
		}
		if seen[cmd.name] {
			t.Fatalf("subcommand %q is registered twice", cmd.name)
		}
		seen[cmd.name] = true
		if lookup(cmd.name) == nil {
			t.Fatalf("lookup(%q) = nil, want the registered subcommand", cmd.name)
		}
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
