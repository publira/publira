package maintenance

import (
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/commentretention"
	"github.com/publira/publira/server/internal/contentevents"
	"github.com/publira/publira/server/internal/contentranking"
	"github.com/publira/publira/server/internal/mfachallenges"
	"github.com/publira/publira/server/internal/orphanimages"
	"github.com/publira/publira/server/internal/recommendfeatures"
)

// tunable is one setting read from the environment, paired with a reader that
// widens whatever the loader produced so every case can be asserted the same
// way, and with the default an unset variable has to land on.
type tunable struct {
	name     string
	read     func() (int64, error)
	fallback int64
	// bounded32 marks the settings that reach a 32-bit parameter, where a
	// wider value has to be refused rather than wrap into a negative limit.
	bounded32 bool
}

func tunables() []tunable {
	return []tunable{
		{
			name: "PUBLIRA_EPISODE_READ_PROJECTION_BATCH_SIZE",
			read: func() (int64, error) {
				job, err := LoadEpisodeReadProjection()
				return int64(job.BatchSize), err
			},
			fallback:  int64(contentevents.DefaultProjectionBatchSize),
			bounded32: true,
		},
		{
			name: "PUBLIRA_CONTENT_RANKING_ITEM_LIMIT",
			read: func() (int64, error) {
				job, err := LoadRankingAggregation()
				return int64(job.ItemLimit), err
			},
			fallback: int64(contentranking.DefaultItemLimit),
		},
		{
			name: "PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS",
			read: func() (int64, error) {
				job, err := LoadRecommendFeatureBuild()
				return int64(job.WindowDays), err
			},
			fallback: int64(recommendfeatures.DefaultWindowDays),
		},
		{
			name: "PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE",
			read: func() (int64, error) {
				job, err := LoadContentEventPurge()
				return int64(job.ChunkSize), err
			},
			fallback: int64(contentevents.DefaultChunkSize),
		},
		{
			name: "PUBLIRA_CONTENT_RANKING_PURGE_CHUNK_SIZE",
			read: func() (int64, error) {
				job, err := LoadRankingSnapshotPurge()
				return int64(job.ChunkSize), err
			},
			fallback: int64(contentranking.DefaultPurgeChunkSize),
		},
		{
			name: "PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE",
			read: func() (int64, error) {
				job, err := LoadMfaChallengePurge()
				return int64(job.ChunkSize), err
			},
			fallback: int64(mfachallenges.DefaultChunkSize),
		},
		{
			name: "PUBLIRA_COMMENT_PURGE_CHUNK_SIZE",
			read: func() (int64, error) {
				job, err := LoadWithdrawnCommentPurge()
				return int64(job.ChunkSize), err
			},
			fallback:  int64(commentretention.DefaultPurgeChunkSize),
			bounded32: true,
		},
		{
			name: "PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS",
			read: func() (int64, error) {
				job, err := LoadOrphanImagePurge()
				return int64(job.MinAge / time.Hour), err
			},
			fallback: int64(orphanimages.DefaultMinAge / time.Hour),
		},
		{
			name: "PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE",
			read: func() (int64, error) {
				job, err := LoadOrphanImagePurge()
				return int64(job.PageSize), err
			},
			fallback:  int64(orphanimages.DefaultPageSize),
			bounded32: true,
		},
	}
}

// A scheduled deployment sets infrastructure connections and nothing else, so
// every tunable has to answer on its own.
func TestEveryTunableFallsBackToItsDefault(t *testing.T) {
	for _, tc := range tunables() {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, "")
			got, err := tc.read()
			if err != nil {
				t.Fatalf("load: %v", err)
			}
			if got != tc.fallback {
				t.Fatalf("value = %d, want the default %d", got, tc.fallback)
			}
		})
	}
}

func TestEveryTunableIsReadFromItsOwnVariable(t *testing.T) {
	for _, tc := range tunables() {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, "  7  ")
			got, err := tc.read()
			if err != nil {
				t.Fatalf("load: %v", err)
			}
			if got != 7 {
				t.Fatalf("value = %d, want 7", got)
			}
		})
	}
}

// Nothing below one sizes anything: a zero chunk, page, window, or item limit
// would either loop forever or write an empty result that reads exactly like a
// tenant with no activity.
func TestEveryTunableRejectsAValueBelowOne(t *testing.T) {
	for _, tc := range tunables() {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, "0")
			_, err := tc.read()
			if err == nil {
				t.Fatal("error = nil, want a rejection")
			}
			if !strings.Contains(err.Error(), tc.name) {
				t.Fatalf("error = %v, want it to name %s", err, tc.name)
			}
		})
	}
}

func TestEveryTunableRejectsANonNumericValue(t *testing.T) {
	for _, tc := range tunables() {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, "a lot")
			_, err := tc.read()
			if err == nil {
				t.Fatal("error = nil, want a rejection")
			}
			if !strings.Contains(err.Error(), tc.name) {
				t.Fatalf("error = %v, want it to name %s", err, tc.name)
			}
		})
	}
}

func TestWidthBoundedTunablesRejectAValueWiderThan32Bits(t *testing.T) {
	for _, tc := range tunables() {
		if !tc.bounded32 {
			continue
		}
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, "4294967296")
			if _, err := tc.read(); err == nil {
				t.Fatal("error = nil, want a rejection")
			}
		})
	}
}

// The zero time is what a run with no date pinned carries, and one day cannot
// stand for it: each tenant's yesterday is its own.
func TestDateLogValue(t *testing.T) {
	if got, want := dateLogValue(time.Time{}), "each tenant's yesterday"; got != want {
		t.Fatalf("zero date = %q, want %q", got, want)
	}
	date := time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC)
	if got, want := dateLogValue(date), "2026-08-28"; got != want {
		t.Fatalf("date = %q, want %q", got, want)
	}
}
