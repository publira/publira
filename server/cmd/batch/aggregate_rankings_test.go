package main

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/contentranking"
)

func TestResolveRankingDate(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_RANKING_DATE", "2026-08-28")
	got, err := resolveRankingDate()
	if err != nil {
		t.Fatalf("resolveRankingDate: %v", err)
	}
	if want := "2026-08-28"; got.Format(time.DateOnly) != want {
		t.Fatalf("date = %s, want %s", got.Format(time.DateOnly), want)
	}

	t.Setenv("PUBLIRA_CONTENT_RANKING_DATE", "not-a-date")
	var parseErr *time.ParseError
	if _, err := resolveRankingDate(); !errors.As(err, &parseErr) {
		t.Fatalf("invalid date error = %v, want ParseError", err)
	}

	// Unset is what the cron actually runs with, and it decides which day the
	// ranking covers. t.Setenv above registered the restore, so clearing the
	// variable here is safe.
	if err := os.Unsetenv("PUBLIRA_CONTENT_RANKING_DATE"); err != nil {
		t.Fatalf("unset ranking date: %v", err)
	}
	got, err = resolveRankingDate()
	if err != nil {
		t.Fatalf("default resolveRankingDate: %v", err)
	}
	// Asserted as properties rather than against a formatted date, so a run
	// that straddles UTC midnight cannot fail on the day it read twice.
	if got.Location() != time.UTC || !got.Equal(got.Truncate(24*time.Hour)) {
		t.Fatalf("default date = %s, want a UTC midnight", got)
	}
	if age := time.Since(got); age < 24*time.Hour || age >= 48*time.Hour {
		t.Fatalf("default date is %s old, want yesterday", age)
	}
}

func TestResolveRankingItemLimit(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_RANKING_ITEM_LIMIT", "")
	if got, err := resolveRankingItemLimit(); err != nil || got != contentranking.DefaultItemLimit {
		t.Fatalf("default limit = (%d, %v), want (%d, nil)", got, err, contentranking.DefaultItemLimit)
	}

	t.Setenv("PUBLIRA_CONTENT_RANKING_ITEM_LIMIT", " 20 ")
	if got, err := resolveRankingItemLimit(); err != nil || got != 20 {
		t.Fatalf("limit = (%d, %v), want (20, nil)", got, err)
	}

	t.Setenv("PUBLIRA_CONTENT_RANKING_ITEM_LIMIT", "0")
	if _, err := resolveRankingItemLimit(); err == nil || !strings.Contains(err.Error(), "at least 1") {
		t.Fatalf("zero limit error = %v, want a minimum requirement", err)
	}
}

func TestResolveRankingDBURL(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_RANKING_DB_URL", " ranking-url ")
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "content-stats-url")
	t.Setenv("PUBLIRA_WORKER_DB_URL", "worker-url")
	if got := resolveRankingDBURL("fallback-url"); got != "ranking-url" {
		t.Fatalf("ranking URL = %q, want ranking-url", got)
	}

	t.Setenv("PUBLIRA_CONTENT_RANKING_DB_URL", "")
	if got := resolveRankingDBURL("fallback-url"); got != "content-stats-url" {
		t.Fatalf("content stats URL = %q, want content-stats-url", got)
	}

	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "")
	if got := resolveRankingDBURL("fallback-url"); got != "worker-url" {
		t.Fatalf("worker URL = %q, want worker-url", got)
	}

	t.Setenv("PUBLIRA_WORKER_DB_URL", "")
	if got := resolveRankingDBURL("fallback-url"); got != "fallback-url" {
		t.Fatalf("fallback URL = %q, want fallback-url", got)
	}
}
