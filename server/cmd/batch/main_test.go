package main

import (
	"strings"
	"testing"
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
