package main

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/recommendfeatures"
)

func TestResolveReferenceDate(t *testing.T) {
	t.Setenv("PUBLIRA_RECOMMEND_FEATURES_DATE", "2026-08-28")
	got, err := resolveReferenceDate()
	if err != nil {
		t.Fatalf("resolveReferenceDate: %v", err)
	}
	if want := "2026-08-28"; got.Format(time.DateOnly) != want {
		t.Fatalf("date = %s, want %s", got.Format(time.DateOnly), want)
	}

	t.Setenv("PUBLIRA_RECOMMEND_FEATURES_DATE", "not-a-date")
	var parseErr *time.ParseError
	if _, err := resolveReferenceDate(); !errors.As(err, &parseErr) {
		t.Fatalf("invalid date error = %v, want ParseError", err)
	}
}

func TestResolveWindowDays(t *testing.T) {
	t.Setenv("PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS", "")
	if got, err := resolveWindowDays(); err != nil || got != recommendfeatures.DefaultWindowDays {
		t.Fatalf("default window = (%d, %v), want (%d, nil)", got, err, recommendfeatures.DefaultWindowDays)
	}

	t.Setenv("PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS", " 7 ")
	if got, err := resolveWindowDays(); err != nil || got != 7 {
		t.Fatalf("window = (%d, %v), want (7, nil)", got, err)
	}

	t.Setenv("PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS", "0")
	if _, err := resolveWindowDays(); err == nil || !strings.Contains(err.Error(), "at least 1") {
		t.Fatalf("zero window error = %v, want a minimum requirement", err)
	}
}

func TestResolveRecommendFeaturesDBURL(t *testing.T) {
	t.Setenv("PUBLIRA_RECOMMEND_FEATURES_DB_URL", " recommend-features-url ")
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "content-stats-url")
	t.Setenv("PUBLIRA_WORKER_DB_URL", "worker-url")
	if got := resolveRecommendFeaturesDBURL("fallback-url"); got != "recommend-features-url" {
		t.Fatalf("recommend features URL = %q, want recommend-features-url", got)
	}

	t.Setenv("PUBLIRA_RECOMMEND_FEATURES_DB_URL", "")
	if got := resolveRecommendFeaturesDBURL("fallback-url"); got != "content-stats-url" {
		t.Fatalf("content stats URL = %q, want content-stats-url", got)
	}

	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "")
	if got := resolveRecommendFeaturesDBURL("fallback-url"); got != "worker-url" {
		t.Fatalf("worker URL = %q, want worker-url", got)
	}

	t.Setenv("PUBLIRA_WORKER_DB_URL", "")
	if got := resolveRecommendFeaturesDBURL("fallback-url"); got != "fallback-url" {
		t.Fatalf("fallback URL = %q, want fallback-url", got)
	}
}
