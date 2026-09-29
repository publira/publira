package contentranking

import (
	"context"
	"database/sql"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/retention"
)

func TestPurgeRunRejectsIncompleteOptions(t *testing.T) {
	if _, err := NewPurger(nil).Run(context.Background(), PurgeOptions{Now: time.Now().UTC()}); err == nil ||
		!strings.Contains(err.Error(), "requires a database") {
		t.Fatalf("missing database error = %v, want a database requirement", err)
	}

	// The current time is checked before the connection is used, so an
	// unopened handle is enough to reach it.
	if _, err := NewPurger(&sql.DB{}).Run(context.Background(), PurgeOptions{}); err == nil ||
		!strings.Contains(err.Error(), "requires a current time") {
		t.Fatalf("missing current time error = %v, want a current time requirement", err)
	}
}

func TestRetentionCutoffsCoverEveryRankingKey(t *testing.T) {
	now := time.Date(2026, time.September, 1, 15, 0, 0, 0, time.UTC)
	cutoffs := retentionCutoffs(retention.Periods{DailyRankingSnapshotDays: 10, WeeklyRankingSnapshotDays: 30}, now)
	want := map[string]time.Time{
		DailyRankingKey:  time.Date(2026, time.August, 22, 0, 0, 0, 0, time.UTC),
		WeeklyRankingKey: time.Date(2026, time.August, 2, 0, 0, 0, 0, time.UTC),
	}
	if !maps.EqualFunc(cutoffs, want, time.Time.Equal) {
		t.Fatalf("retentionCutoffs = %v, want %v", cutoffs, want)
	}
}

func TestFlattenCutoffsPairsKeysWithTheirDates(t *testing.T) {
	// Sorting puts "daily" before "weekly", whatever order the map yields.
	rankingKeys, dates := flattenCutoffs(map[string]time.Time{
		WeeklyRankingKey: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
		DailyRankingKey:  time.Date(2026, time.June, 1, 23, 30, 0, 0, time.UTC),
	})
	if want := []string{DailyRankingKey, WeeklyRankingKey}; !slices.Equal(rankingKeys, want) {
		t.Fatalf("ranking keys = %v, want %v", rankingKeys, want)
	}
	// The cutoff is a calendar date, so the time of day is dropped rather than
	// letting the hour a run starts decide which period expires.
	if want := []string{"2026-06-01", "2026-01-01"}; !slices.Equal(dates, want) {
		t.Fatalf("cutoffs = %v, want %v", dates, want)
	}
}
