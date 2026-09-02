package main

import (
	"testing"
	"time"

	"github.com/publira/publira/server/internal/orphanimages"
)

func TestResolveOrphanImagesMinAge(t *testing.T) {
	t.Setenv("PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS", "")
	if got, err := resolveOrphanImagesMinAge(); err != nil || got != orphanimages.DefaultMinAge {
		t.Fatalf("default minimum age = (%v, %v), want (%v, nil)", got, err, orphanimages.DefaultMinAge)
	}

	t.Setenv("PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS", " 72 ")
	if got, err := resolveOrphanImagesMinAge(); err != nil || got != 72*time.Hour {
		t.Fatalf("minimum age = (%v, %v), want (72h, nil)", got, err)
	}

	t.Setenv("PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS", "0")
	if _, err := resolveOrphanImagesMinAge(); err == nil {
		t.Fatal("zero minimum age error = nil, want an error")
	}

	t.Setenv("PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS", "a day")
	if _, err := resolveOrphanImagesMinAge(); err == nil {
		t.Fatal("non-numeric minimum age error = nil, want an error")
	}
}

func TestResolveOrphanImagesPageSize(t *testing.T) {
	t.Setenv("PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE", "")
	if got, err := resolveOrphanImagesPageSize(); err != nil || got != orphanimages.DefaultPageSize {
		t.Fatalf("default page size = (%d, %v), want (%d, nil)", got, err, orphanimages.DefaultPageSize)
	}

	t.Setenv("PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE", "250")
	if got, err := resolveOrphanImagesPageSize(); err != nil || got != 250 {
		t.Fatalf("page size = (%d, %v), want (250, nil)", got, err)
	}

	t.Setenv("PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE", "0")
	if _, err := resolveOrphanImagesPageSize(); err == nil {
		t.Fatal("zero page size error = nil, want an error")
	}

	// A page size wider than int32 would wrap into a negative MaxKeys, so it
	// is rejected rather than truncated.
	t.Setenv("PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE", "4294967296")
	if _, err := resolveOrphanImagesPageSize(); err == nil {
		t.Fatal("oversized page size error = nil, want an error")
	}
}

func TestResolveOrphanImagesDryRun(t *testing.T) {
	t.Setenv("PUBLIRA_ORPHAN_IMAGES_PURGE_DRY_RUN", "")
	if got, err := resolveOrphanImagesDryRun(); err != nil || got {
		t.Fatalf("default dry-run = (%t, %v), want (false, nil)", got, err)
	}

	t.Setenv("PUBLIRA_ORPHAN_IMAGES_PURGE_DRY_RUN", " true ")
	if got, err := resolveOrphanImagesDryRun(); err != nil || !got {
		t.Fatalf("dry-run = (%t, %v), want (true, nil)", got, err)
	}

	t.Setenv("PUBLIRA_ORPHAN_IMAGES_PURGE_DRY_RUN", "maybe")
	if _, err := resolveOrphanImagesDryRun(); err == nil {
		t.Fatal("invalid dry-run error = nil, want an error")
	}
}

func TestResolveOrphanImagesDBURL(t *testing.T) {
	t.Setenv("PUBLIRA_ORPHAN_IMAGES_DB_URL", " orphan-images-url ")
	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "content-stats-url")
	t.Setenv("PUBLIRA_WORKER_DB_URL", "worker-url")
	if got := resolveOrphanImagesDBURL("fallback-url"); got != "orphan-images-url" {
		t.Fatalf("orphan images URL = %q, want orphan-images-url", got)
	}

	t.Setenv("PUBLIRA_ORPHAN_IMAGES_DB_URL", "")
	if got := resolveOrphanImagesDBURL("fallback-url"); got != "content-stats-url" {
		t.Fatalf("content stats URL = %q, want content-stats-url", got)
	}

	t.Setenv("PUBLIRA_CONTENT_STATS_DB_URL", "")
	if got := resolveOrphanImagesDBURL("fallback-url"); got != "worker-url" {
		t.Fatalf("worker URL = %q, want worker-url", got)
	}

	t.Setenv("PUBLIRA_WORKER_DB_URL", "")
	if got := resolveOrphanImagesDBURL("fallback-url"); got != "fallback-url" {
		t.Fatalf("fallback URL = %q, want fallback-url", got)
	}
}
