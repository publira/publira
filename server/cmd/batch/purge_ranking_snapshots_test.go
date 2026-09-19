package main

import (
	"testing"

	"github.com/publira/publira/server/internal/contentranking"
)

func TestResolveRankingPurgeChunkSize(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_RANKING_PURGE_CHUNK_SIZE", "")
	if got, err := resolveRankingPurgeChunkSize(); err != nil || got != contentranking.DefaultPurgeChunkSize {
		t.Fatalf("default chunk size = (%d, %v), want (%d, nil)", got, err, contentranking.DefaultPurgeChunkSize)
	}

	t.Setenv("PUBLIRA_CONTENT_RANKING_PURGE_CHUNK_SIZE", "500")
	if got, err := resolveRankingPurgeChunkSize(); err != nil || got != 500 {
		t.Fatalf("chunk size = (%d, %v), want (500, nil)", got, err)
	}

	t.Setenv("PUBLIRA_CONTENT_RANKING_PURGE_CHUNK_SIZE", "0")
	if _, err := resolveRankingPurgeChunkSize(); err == nil {
		t.Fatal("zero chunk size error = nil, want an error")
	}
}

func TestResolveRankingPurgeDryRun(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN", "")
	if got, err := resolveRankingPurgeDryRun(); err != nil || got {
		t.Fatalf("default dry-run = (%t, %v), want (false, nil)", got, err)
	}

	t.Setenv("PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN", " true ")
	if got, err := resolveRankingPurgeDryRun(); err != nil || !got {
		t.Fatalf("dry-run = (%t, %v), want (true, nil)", got, err)
	}

	t.Setenv("PUBLIRA_CONTENT_RANKING_PURGE_DRY_RUN", "maybe")
	if _, err := resolveRankingPurgeDryRun(); err == nil {
		t.Fatal("invalid dry-run error = nil, want an error")
	}
}
