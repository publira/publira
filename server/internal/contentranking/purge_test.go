package contentranking

import (
	"context"
	"database/sql"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestPurgeRunRejectsIncompleteOptions(t *testing.T) {
	cutoffs := map[string]time.Time{DailyRankingKey: time.Now().UTC()}
	if _, err := NewPurger(nil).Run(context.Background(), PurgeOptions{Cutoffs: cutoffs}); err == nil ||
		!strings.Contains(err.Error(), "requires a database") {
		t.Fatalf("missing database error = %v, want a database requirement", err)
	}

	// The cutoffs are checked before the connection is used, so an unopened
	// handle is enough to reach them.
	if _, err := NewPurger(&sql.DB{}).Run(context.Background(), PurgeOptions{}); err == nil ||
		!strings.Contains(err.Error(), "at least one retention cutoff") {
		t.Fatalf("missing cutoff error = %v, want a cutoff requirement", err)
	}

	// A key mapped to the zero time would otherwise expire every period before
	// year one, which reads exactly like a key nobody configured.
	empty := map[string]time.Time{WeeklyRankingKey: {}}
	if _, err := NewPurger(&sql.DB{}).Run(context.Background(), PurgeOptions{Cutoffs: empty}); err == nil ||
		!strings.Contains(err.Error(), WeeklyRankingKey) {
		t.Fatalf("zero cutoff error = %v, want the ranking key named", err)
	}
}

func TestFlattenCutoffsPairsKeysWithTheirDates(t *testing.T) {
	// Sorting puts "daily" before "weekly", whatever order the map yields.
	rankingKeys, dates, err := flattenCutoffs(map[string]time.Time{
		WeeklyRankingKey: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
		DailyRankingKey:  time.Date(2026, time.June, 1, 23, 30, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("flattenCutoffs: %v", err)
	}
	if want := []string{DailyRankingKey, WeeklyRankingKey}; !slices.Equal(rankingKeys, want) {
		t.Fatalf("ranking keys = %v, want %v", rankingKeys, want)
	}
	// The cutoff is a calendar date, so the time of day is dropped rather than
	// letting the hour a run starts decide which period expires.
	if want := []string{"2026-06-01", "2026-01-01"}; !slices.Equal(dates, want) {
		t.Fatalf("cutoffs = %v, want %v", dates, want)
	}
}
