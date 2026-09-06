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

	// Unset is what the cron runs with, and no single day answers it: each
	// tenant's yesterday is its own, so the aggregate resolves the day per
	// tenant and this only reports that nothing was pinned.
	t.Setenv("PUBLIRA_CONTENT_STATS_DATE", "  ")
	if got, err := resolveStatDate(); err != nil || !got.IsZero() {
		t.Fatalf("blank date = (%s, %v), want (the zero time, nil)", got, err)
	}
}

func TestResolveContentStatsDBURL(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", " content-stats-url ")
	t.Setenv("PUBLIRA_WORKER_DB_URL", "worker-url")
	if got := resolveContentStatsDBURL("fallback-url"); got != "content-stats-url" {
		t.Fatalf("content stats URL = %q, want content-stats-url", got)
	}

	// PUBLIRA_WORKER_DB_URL stays set. It names outbox-worker's own role, which
	// owns River's schema, so this batch must fall through it to the shared
	// connection rather than adopt it.
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "")
	if got := resolveContentStatsDBURL("fallback-url"); got != "fallback-url" {
		t.Fatalf("fallback URL = %q, want fallback-url", got)
	}
}
