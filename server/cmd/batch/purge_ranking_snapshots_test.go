package main

import (
	"testing"

	"github.com/publira/publira/server/internal/contentranking"
)

func TestResolveRankingRetentionDays(t *testing.T) {
	const name = "PUBLIRA_CONTENT_RANKING_DAILY_RETENTION_DAYS"

	t.Setenv(name, "")
	if got, err := resolveRankingRetentionDays(name, defaultRankingDailyRetentionDays); err != nil || got != defaultRankingDailyRetentionDays {
		t.Fatalf("default retention = (%d, %v), want (%d, nil)", got, err, defaultRankingDailyRetentionDays)
	}

	t.Setenv(name, " 30 ")
	if got, err := resolveRankingRetentionDays(name, defaultRankingDailyRetentionDays); err != nil || got != 30 {
		t.Fatalf("retention = (%d, %v), want (30, nil)", got, err)
	}

	t.Setenv(name, "0")
	if _, err := resolveRankingRetentionDays(name, defaultRankingDailyRetentionDays); err == nil {
		t.Fatal("zero retention error = nil, want an error")
	}

	t.Setenv(name, "ninety")
	if _, err := resolveRankingRetentionDays(name, defaultRankingDailyRetentionDays); err == nil {
		t.Fatal("non-numeric retention error = nil, want an error")
	}
}

func TestRetentionDaysAreReadPerRankingKey(t *testing.T) {
	t.Setenv("PUBLIRA_CONTENT_RANKING_DAILY_RETENTION_DAYS", "10")
	t.Setenv("PUBLIRA_CONTENT_RANKING_WEEKLY_RETENTION_DAYS", "20")

	daily, err := resolveRankingRetentionDays("PUBLIRA_CONTENT_RANKING_DAILY_RETENTION_DAYS", defaultRankingDailyRetentionDays)
	if err != nil || daily != 10 {
		t.Fatalf("daily retention = (%d, %v), want (10, nil)", daily, err)
	}
	weekly, err := resolveRankingRetentionDays("PUBLIRA_CONTENT_RANKING_WEEKLY_RETENTION_DAYS", defaultRankingWeeklyRetentionDays)
	if err != nil || weekly != 20 {
		t.Fatalf("weekly retention = (%d, %v), want (20, nil)", weekly, err)
	}
}

// A weekly snapshot summarises seven days into one row, so keeping it for
// longer than a daily one is what makes the retention split worth having.
func TestWeeklySnapshotsAreKeptLongerThanDailyOnes(t *testing.T) {
	if defaultRankingWeeklyRetentionDays <= defaultRankingDailyRetentionDays {
		t.Fatalf("weekly retention (%d days) must outlast daily retention (%d days)",
			defaultRankingWeeklyRetentionDays, defaultRankingDailyRetentionDays)
	}
}

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
