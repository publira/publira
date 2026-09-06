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

	// Unset is what the cron actually runs with. No single day answers it any
	// more: "yesterday" belongs to a tenant's time zone, so the run resolves it
	// per tenant and this only reports that nothing was pinned. t.Setenv above
	// registered the restore, so clearing the variable here is safe.
	if err := os.Unsetenv("PUBLIRA_CONTENT_RANKING_DATE"); err != nil {
		t.Fatalf("unset ranking date: %v", err)
	}
	got, err = resolveRankingDate()
	if err != nil {
		t.Fatalf("default resolveRankingDate: %v", err)
	}
	if !got.IsZero() {
		t.Fatalf("default date = %s, want the zero time", got)
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

	// PUBLIRA_WORKER_DB_URL stays set. It names outbox-worker's own role, which
	// owns River's schema, so this batch must fall through it to the shared
	// connection rather than adopt it.
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "")
	if got := resolveRankingDBURL("fallback-url"); got != "fallback-url" {
		t.Fatalf("fallback URL = %q, want fallback-url", got)
	}
}
