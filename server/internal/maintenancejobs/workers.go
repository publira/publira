package maintenancejobs

import (
	"context"
	"time"

	"github.com/riverqueue/river"
)

// ProjectEpisodeReadsArgs files the missing episode_complete events for stored
// episode reads.
type ProjectEpisodeReadsArgs struct{}

func (ProjectEpisodeReadsArgs) Kind() string { return kindProjectEpisodeReads }

func (ProjectEpisodeReadsArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// AggregateContentStatsArgs rebuilds one calendar day of content_daily_stats
// for every tenant.
type AggregateContentStatsArgs struct{}

func (AggregateContentStatsArgs) Kind() string { return kindAggregateContentStats }

func (AggregateContentStatsArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// AggregateRankingsArgs rebuilds the daily and weekly ranking snapshots.
type AggregateRankingsArgs struct{}

func (AggregateRankingsArgs) Kind() string { return kindAggregateRankings }

func (AggregateRankingsArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// BuildRecommendFeaturesArgs rebuilds the daily user and item feature
// snapshots.
type BuildRecommendFeaturesArgs struct{}

func (BuildRecommendFeaturesArgs) Kind() string { return kindBuildRecommendFeatures }

func (BuildRecommendFeaturesArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// PurgeContentEventsArgs deletes content_events rows past their retention
// window.
type PurgeContentEventsArgs struct{}

func (PurgeContentEventsArgs) Kind() string { return kindPurgeContentEvents }

func (PurgeContentEventsArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// PurgeRankingSnapshotsArgs deletes content_ranking_snapshots rows past their
// retention window.
type PurgeRankingSnapshotsArgs struct{}

func (PurgeRankingSnapshotsArgs) Kind() string { return kindPurgeRankingSnapshots }

func (PurgeRankingSnapshotsArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// PurgeMfaChallengesArgs deletes the spent admin MFA challenges whose tokens
// have expired.
type PurgeMfaChallengesArgs struct{}

func (PurgeMfaChallengesArgs) Kind() string { return kindPurgeMfaChallenges }

func (PurgeMfaChallengesArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// PurgeWithdrawnCommentsArgs deletes the comments their authors withdrew past
// the retention window.
type PurgeWithdrawnCommentsArgs struct{}

func (PurgeWithdrawnCommentsArgs) Kind() string { return kindPurgeWithdrawnComments }

func (PurgeWithdrawnCommentsArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// PurgeOrphanImagesArgs deletes the image rows and storage objects nothing
// references.
type PurgeOrphanImagesArgs struct{}

func (PurgeOrphanImagesArgs) Kind() string { return kindPurgeOrphanImages }

func (PurgeOrphanImagesArgs) InsertOpts() river.InsertOpts { return insertOpts() }

type projectEpisodeReadsWorker struct {
	river.WorkerDefaults[ProjectEpisodeReadsArgs]
	jobs *Jobs
}

func (w *projectEpisodeReadsWorker) Timeout(*river.Job[ProjectEpisodeReadsArgs]) time.Duration {
	return jobTimeout
}

func (w *projectEpisodeReadsWorker) Work(ctx context.Context, _ *river.Job[ProjectEpisodeReadsArgs]) error {
	ctx, end := startRun(ctx, ServiceNameProjectEpisodeReads, kindProjectEpisodeReads)
	defer end()
	return w.jobs.episodeReads.Run(ctx, w.jobs.deps)
}

type aggregateContentStatsWorker struct {
	river.WorkerDefaults[AggregateContentStatsArgs]
	jobs *Jobs
}

func (w *aggregateContentStatsWorker) Timeout(*river.Job[AggregateContentStatsArgs]) time.Duration {
	return jobTimeout
}

func (w *aggregateContentStatsWorker) Work(ctx context.Context, _ *river.Job[AggregateContentStatsArgs]) error {
	ctx, end := startRun(ctx, ServiceNameAggregateContentStats, kindAggregateContentStats)
	defer end()
	return w.jobs.contentStats.Run(ctx, w.jobs.deps)
}

type aggregateRankingsWorker struct {
	river.WorkerDefaults[AggregateRankingsArgs]
	jobs *Jobs
}

func (w *aggregateRankingsWorker) Timeout(*river.Job[AggregateRankingsArgs]) time.Duration {
	return jobTimeout
}

func (w *aggregateRankingsWorker) Work(ctx context.Context, _ *river.Job[AggregateRankingsArgs]) error {
	ctx, end := startRun(ctx, ServiceNameAggregateRankings, kindAggregateRankings)
	defer end()
	return w.jobs.rankings.Run(ctx, w.jobs.deps)
}

type buildRecommendFeaturesWorker struct {
	river.WorkerDefaults[BuildRecommendFeaturesArgs]
	jobs *Jobs
}

func (w *buildRecommendFeaturesWorker) Timeout(*river.Job[BuildRecommendFeaturesArgs]) time.Duration {
	return jobTimeout
}

func (w *buildRecommendFeaturesWorker) Work(ctx context.Context, _ *river.Job[BuildRecommendFeaturesArgs]) error {
	ctx, end := startRun(ctx, ServiceNameBuildRecommendFeatures, kindBuildRecommendFeatures)
	defer end()
	return w.jobs.recommendFeatures.Run(ctx, w.jobs.deps)
}

type purgeContentEventsWorker struct {
	river.WorkerDefaults[PurgeContentEventsArgs]
	jobs *Jobs
}

func (w *purgeContentEventsWorker) Timeout(*river.Job[PurgeContentEventsArgs]) time.Duration {
	return jobTimeout
}

func (w *purgeContentEventsWorker) Work(ctx context.Context, _ *river.Job[PurgeContentEventsArgs]) error {
	ctx, end := startRun(ctx, ServiceNamePurgeContentEvents, kindPurgeContentEvents)
	defer end()
	return w.jobs.contentEvents.Run(ctx, w.jobs.deps)
}

type purgeRankingSnapshotsWorker struct {
	river.WorkerDefaults[PurgeRankingSnapshotsArgs]
	jobs *Jobs
}

func (w *purgeRankingSnapshotsWorker) Timeout(*river.Job[PurgeRankingSnapshotsArgs]) time.Duration {
	return jobTimeout
}

func (w *purgeRankingSnapshotsWorker) Work(ctx context.Context, _ *river.Job[PurgeRankingSnapshotsArgs]) error {
	ctx, end := startRun(ctx, ServiceNamePurgeRankingSnapshots, kindPurgeRankingSnapshots)
	defer end()
	return w.jobs.rankingSnapshots.Run(ctx, w.jobs.deps)
}

type purgeMfaChallengesWorker struct {
	river.WorkerDefaults[PurgeMfaChallengesArgs]
	jobs *Jobs
}

func (w *purgeMfaChallengesWorker) Timeout(*river.Job[PurgeMfaChallengesArgs]) time.Duration {
	return jobTimeout
}

func (w *purgeMfaChallengesWorker) Work(ctx context.Context, _ *river.Job[PurgeMfaChallengesArgs]) error {
	ctx, end := startRun(ctx, ServiceNamePurgeMfaChallenges, kindPurgeMfaChallenges)
	defer end()
	return w.jobs.mfaChallenges.Run(ctx, w.jobs.deps)
}

type purgeWithdrawnCommentsWorker struct {
	river.WorkerDefaults[PurgeWithdrawnCommentsArgs]
	jobs *Jobs
}

func (w *purgeWithdrawnCommentsWorker) Timeout(*river.Job[PurgeWithdrawnCommentsArgs]) time.Duration {
	return jobTimeout
}

func (w *purgeWithdrawnCommentsWorker) Work(ctx context.Context, _ *river.Job[PurgeWithdrawnCommentsArgs]) error {
	ctx, end := startRun(ctx, ServiceNamePurgeWithdrawnComments, kindPurgeWithdrawnComments)
	defer end()
	return w.jobs.withdrawnComments.Run(ctx, w.jobs.deps)
}

type purgeOrphanImagesWorker struct {
	river.WorkerDefaults[PurgeOrphanImagesArgs]
	jobs *Jobs
}

func (w *purgeOrphanImagesWorker) Timeout(*river.Job[PurgeOrphanImagesArgs]) time.Duration {
	return jobTimeout
}

func (w *purgeOrphanImagesWorker) Work(ctx context.Context, _ *river.Job[PurgeOrphanImagesArgs]) error {
	ctx, end := startRun(ctx, ServiceNamePurgeOrphanImages, kindPurgeOrphanImages)
	defer end()
	return w.jobs.orphanImages.Run(ctx, w.jobs.deps)
}
