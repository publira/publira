package maintenance

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/publira/publira/server/internal/commentretention"
	"github.com/publira/publira/server/internal/contentevents"
	"github.com/publira/publira/server/internal/contentranking"
	"github.com/publira/publira/server/internal/mfachallenges"
	"github.com/publira/publira/server/internal/orphanimages"
	"github.com/publira/publira/server/internal/recommendfeatures"
)

// Each Load function below reads the tunables of one job — the sizes, limits,
// and windows that describe how a deployment wants the work done, and that
// every caller therefore shares.
//
// What one run covers is not among them. The calendar date a rebuild targets
// and the dry-run switch that reports a deletion without performing it belong
// to a single invocation rather than to the deployment, so they stay fields the
// caller fills: cmd/batch reads them from the operator's environment, and a
// scheduled run leaves them at the zero value.

// EpisodeReadProjection files the missing episode_complete events for stored
// episode reads.
type EpisodeReadProjection struct {
	// BatchSize is the rows one statement files.
	BatchSize int32
}

// LoadEpisodeReadProjection reads the job's tunables from the environment.
func LoadEpisodeReadProjection() (EpisodeReadProjection, error) {
	// The value becomes a PostgreSQL LIMIT, so a width that could wrap
	// negative is rejected before the database sees it.
	size, err := positiveInt32("PUBLIRA_EPISODE_READ_PROJECTION_BATCH_SIZE", contentevents.DefaultProjectionBatchSize)
	if err != nil {
		return EpisodeReadProjection{}, err
	}
	return EpisodeReadProjection{BatchSize: size}, nil
}

// ContentStatsAggregation rebuilds one calendar day of content_daily_stats for
// every tenant. It has no tunables, and therefore no Load function.
type ContentStatsAggregation struct {
	// Date is the calendar date to rebuild, read as each tenant's own local
	// one. The zero time rebuilds every tenant's own yesterday, which is not
	// the same day for all of them.
	Date time.Time
}

// RankingAggregation rebuilds the daily and weekly ranking snapshots.
type RankingAggregation struct {
	// Date is read the way ContentStatsAggregation.Date is.
	Date      time.Time
	ItemLimit int
}

// LoadRankingAggregation reads the job's tunables from the environment.
func LoadRankingAggregation() (RankingAggregation, error) {
	// A zero or negative limit would write every snapshot as an empty
	// leaderboard, which reads exactly like a tenant with no activity.
	limit, err := positiveInt("PUBLIRA_CONTENT_RANKING_ITEM_LIMIT", contentranking.DefaultItemLimit)
	if err != nil {
		return RankingAggregation{}, err
	}
	return RankingAggregation{ItemLimit: limit}, nil
}

// RecommendFeatureBuild rebuilds the daily user and item feature snapshots.
type RecommendFeatureBuild struct {
	// Date is read the way ContentStatsAggregation.Date is.
	Date       time.Time
	WindowDays int
}

// LoadRecommendFeatureBuild reads the job's tunables from the environment.
func LoadRecommendFeatureBuild() (RecommendFeatureBuild, error) {
	// A zero or negative window would put the window start after its end and
	// build every snapshot from nothing, silently emptying both tables.
	days, err := positiveInt("PUBLIRA_RECOMMEND_FEATURES_WINDOW_DAYS", recommendfeatures.DefaultWindowDays)
	if err != nil {
		return RecommendFeatureBuild{}, err
	}
	return RecommendFeatureBuild{WindowDays: days}, nil
}

// ContentEventPurge deletes content_events rows past their retention window.
type ContentEventPurge struct {
	ChunkSize int
	DryRun    bool
}

// LoadContentEventPurge reads the job's tunables from the environment.
func LoadContentEventPurge() (ContentEventPurge, error) {
	size, err := positiveInt("PUBLIRA_CONTENT_EVENTS_PURGE_CHUNK_SIZE", contentevents.DefaultChunkSize)
	if err != nil {
		return ContentEventPurge{}, err
	}
	return ContentEventPurge{ChunkSize: size}, nil
}

// RankingSnapshotPurge deletes content_ranking_snapshots rows past their
// retention window.
type RankingSnapshotPurge struct {
	ChunkSize int
	DryRun    bool
}

// LoadRankingSnapshotPurge reads the job's tunables from the environment.
func LoadRankingSnapshotPurge() (RankingSnapshotPurge, error) {
	size, err := positiveInt("PUBLIRA_CONTENT_RANKING_PURGE_CHUNK_SIZE", contentranking.DefaultPurgeChunkSize)
	if err != nil {
		return RankingSnapshotPurge{}, err
	}
	return RankingSnapshotPurge{ChunkSize: size}, nil
}

// MfaChallengePurge deletes the spent admin MFA challenges whose tokens have
// expired.
type MfaChallengePurge struct {
	ChunkSize int
	DryRun    bool
}

// LoadMfaChallengePurge reads the job's tunables from the environment.
func LoadMfaChallengePurge() (MfaChallengePurge, error) {
	size, err := positiveInt("PUBLIRA_MFA_CHALLENGE_PURGE_CHUNK_SIZE", mfachallenges.DefaultChunkSize)
	if err != nil {
		return MfaChallengePurge{}, err
	}
	return MfaChallengePurge{ChunkSize: size}, nil
}

// WithdrawnCommentPurge deletes the comments their authors withdrew past the
// retention window.
type WithdrawnCommentPurge struct {
	ChunkSize int32
	DryRun    bool
}

// LoadWithdrawnCommentPurge reads the job's tunables from the environment.
func LoadWithdrawnCommentPurge() (WithdrawnCommentPurge, error) {
	size, err := positiveInt32("PUBLIRA_COMMENT_PURGE_CHUNK_SIZE", commentretention.DefaultPurgeChunkSize)
	if err != nil {
		return WithdrawnCommentPurge{}, err
	}
	return WithdrawnCommentPurge{ChunkSize: size}, nil
}

// OrphanImagePurge deletes the image rows and storage objects nothing
// references.
type OrphanImagePurge struct {
	// MinAge keeps the run away from the uploads around it: nothing younger
	// than this is a candidate, so an upload still in flight is not deleted
	// between its object and its row.
	MinAge   time.Duration
	PageSize int32
	DryRun   bool
}

// maxMinAgeHours is the largest age time.Duration can hold. Past it the
// multiplication below wraps negative, which puts the cutoff after now and
// makes every upload in flight a candidate — the same outcome the lower bound
// refuses, reached through the other end of the range.
const maxMinAgeHours = int(int64(1<<63-1) / int64(time.Hour))

// LoadOrphanImagePurge reads the job's tunables from the environment.
func LoadOrphanImagePurge() (OrphanImagePurge, error) {
	// A zero or negative age would put the cutoff at or after now and make
	// every upload in flight a candidate for deletion.
	hours, err := positiveInt("PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS", int(orphanimages.DefaultMinAge/time.Hour))
	if err != nil {
		return OrphanImagePurge{}, err
	}
	if hours > maxMinAgeHours {
		return OrphanImagePurge{}, fmt.Errorf(
			"PUBLIRA_ORPHAN_IMAGES_MIN_AGE_HOURS must be at most %d, got %d",
			maxMinAgeHours, hours,
		)
	}
	// The value becomes an S3 MaxKeys and a PostgreSQL array parameter, so a
	// width that could wrap negative is rejected before either sees it.
	size, err := positiveInt32("PUBLIRA_ORPHAN_IMAGES_PAGE_SIZE", orphanimages.DefaultPageSize)
	if err != nil {
		return OrphanImagePurge{}, err
	}
	return OrphanImagePurge{MinAge: time.Duration(hours) * time.Hour, PageSize: size}, nil
}

// positiveInt reads a count from name, bounded below by 1 because every setting
// that uses it sizes a chunk, a page, or a window that nothing smaller answers.
func positiveInt(name string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", name, err)
	}
	if n < 1 {
		return 0, fmt.Errorf("%s must be at least 1, got %d", name, n)
	}
	return n, nil
}

// positiveInt32 is positiveInt for the settings that reach a 32-bit parameter,
// where a wider value would wrap into a negative limit rather than be refused.
func positiveInt32(name string, fallback int32) (int32, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", name, err)
	}
	if n < 1 {
		return 0, fmt.Errorf("%s must be at least 1, got %d", name, n)
	}
	return int32(n), nil
}

// dateLogValue words a resolved date for the run's structured log, where the
// zero time means the run took each tenant's own yesterday rather than one day
// for all of them.
func dateLogValue(date time.Time) string {
	if date.IsZero() {
		return "each tenant's yesterday"
	}
	return date.Format(time.DateOnly)
}
