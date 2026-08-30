package main

import (
	"testing"

	"github.com/publira/publira/server/internal/contentevents"
)

func TestResolveRetentionDays(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_EVENTS_RETENTION_DAYS", "")
	if got, err := resolveRetentionDays(); err != nil || got != defaultRetentionDays {
		t.Fatalf("default retention = (%d, %v), want (%d, nil)", got, err, defaultRetentionDays)
	}

	t.Setenv("PUBLIRA_CONTENT_EVENTS_RETENTION_DAYS", " 30 ")
	if got, err := resolveRetentionDays(); err != nil || got != 30 {
		t.Fatalf("retention = (%d, %v), want (30, nil)", got, err)
	}

	t.Setenv("PUBLIRA_CONTENT_EVENTS_RETENTION_DAYS", "0")
	if _, err := resolveRetentionDays(); err == nil {
		t.Fatal("zero retention error = nil, want an error")
	}

	t.Setenv("PUBLIRA_CONTENT_EVENTS_RETENTION_DAYS", "ninety")
	if _, err := resolveRetentionDays(); err == nil {
		t.Fatal("non-numeric retention error = nil, want an error")
	}
}

func TestResolveChunkSize(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE", "")
	if got, err := resolveChunkSize(); err != nil || got != contentevents.DefaultChunkSize {
		t.Fatalf("default chunk size = (%d, %v), want (%d, nil)", got, err, contentevents.DefaultChunkSize)
	}

	t.Setenv("PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE", "500")
	if got, err := resolveChunkSize(); err != nil || got != 500 {
		t.Fatalf("chunk size = (%d, %v), want (500, nil)", got, err)
	}

	t.Setenv("PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE", "0")
	if _, err := resolveChunkSize(); err == nil {
		t.Fatal("zero chunk size error = nil, want an error")
	}
}

func TestResolveDryRun(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN", "")
	if got, err := resolveDryRun(); err != nil || got {
		t.Fatalf("default dry-run = (%t, %v), want (false, nil)", got, err)
	}

	t.Setenv("PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN", " true ")
	if got, err := resolveDryRun(); err != nil || !got {
		t.Fatalf("dry-run = (%t, %v), want (true, nil)", got, err)
	}

	t.Setenv("PUBLIRA_CONTENT_EVENTS_PURGE_DRY_RUN", "maybe")
	if _, err := resolveDryRun(); err == nil {
		t.Fatal("invalid dry-run error = nil, want an error")
	}
}

func TestResolveDBURL(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_EVENTS_DB_URL", " content-events-url ")
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "content-stats-url")
	t.Setenv("PUBLIRA_WORKER_DB_URL", "worker-url")
	if got := resolveDBURL("fallback-url"); got != "content-events-url" {
		t.Fatalf("content events URL = %q, want content-events-url", got)
	}

	t.Setenv("PUBLIRA_CONTENT_EVENTS_DB_URL", "")
	if got := resolveDBURL("fallback-url"); got != "content-stats-url" {
		t.Fatalf("content stats URL = %q, want content-stats-url", got)
	}

	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "")
	if got := resolveDBURL("fallback-url"); got != "worker-url" {
		t.Fatalf("worker URL = %q, want worker-url", got)
	}

	t.Setenv("PUBLIRA_WORKER_DB_URL", "")
	if got := resolveDBURL("fallback-url"); got != "fallback-url" {
		t.Fatalf("fallback URL = %q, want fallback-url", got)
	}
}
