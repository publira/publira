package main

import (
	"errors"
	"testing"
	"time"
)

func TestResolveStatDate(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_STATS_DATE", "2026-08-28")
	got, err := resolveStatDate()
	if err != nil {
		t.Fatalf("resolveStatDate: %v", err)
	}
	if want := "2026-08-28"; got.Format(time.DateOnly) != want {
		t.Fatalf("date = %s, want %s", got.Format(time.DateOnly), want)
	}

	t.Setenv("PUBLIRA_CONTENT_STATS_DATE", "not-a-date")
	var parseErr *time.ParseError
	if _, err := resolveStatDate(); !errors.As(err, &parseErr) {
		t.Fatalf("invalid date error = %v, want ParseError", err)
	}
}

func TestResolveContentStatsDBURL(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", " content-stats-url ")
	t.Setenv("PUBLIRA_WORKER_DB_URL", "worker-url")
	if got := resolveContentStatsDBURL("fallback-url"); got != "content-stats-url" {
		t.Fatalf("content stats URL = %q, want content-stats-url", got)
	}

	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "")
	if got := resolveContentStatsDBURL("fallback-url"); got != "worker-url" {
		t.Fatalf("worker URL = %q, want worker-url", got)
	}

	t.Setenv("PUBLIRA_WORKER_DB_URL", "")
	if got := resolveContentStatsDBURL("fallback-url"); got != "fallback-url" {
		t.Fatalf("fallback URL = %q, want fallback-url", got)
	}
}
