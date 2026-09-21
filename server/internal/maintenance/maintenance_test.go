package maintenance

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

// A caller that wired one of these up without its pool gets an error naming
// what is missing, rather than the nil dereference the first query would be.
func TestEveryJobRefusesToRunWithoutItsPool(t *testing.T) {
	for name, run := range everyJob() {
		t.Run(name, func(t *testing.T) {
			if err := run(context.Background(), Deps{}); !errors.Is(err, errNoDB) {
				t.Fatalf("error = %v, want %v", err, errNoDB)
			}
		})
	}
}

// The orphan image sweep is the one job that reaches past the database, and a
// bucket it cannot list is not a sweep that should delete the rows either.
func TestOrphanImagePurgeRefusesToRunWithoutStorage(t *testing.T) {
	err := OrphanImagePurge{}.Run(context.Background(), Deps{DB: &sql.DB{}})
	if !errors.Is(err, errNoStorage) {
		t.Fatalf("error = %v, want %v", err, errNoStorage)
	}
}

func everyJob() map[string]func(context.Context, Deps) error {
	return map[string]func(context.Context, Deps) error{
		"project-episode-reads":    EpisodeReadProjection{}.Run,
		"aggregate-content-stats":  ContentStatsAggregation{}.Run,
		"aggregate-rankings":       RankingAggregation{}.Run,
		"build-recommend-features": RecommendFeatureBuild{}.Run,
		"purge-content-events":     ContentEventPurge{}.Run,
		"purge-ranking-snapshots":  RankingSnapshotPurge{}.Run,
		"purge-mfa-challenges":     MfaChallengePurge{}.Run,
		"purge-withdrawn-comments": WithdrawnCommentPurge{}.Run,
		"purge-orphan-images":      OrphanImagePurge{}.Run,
	}
}
