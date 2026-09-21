package maintenancejobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/riverqueue/river"

	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/storage"
)

// ProjectEpisodeReadsArgs files the missing episode_complete events for stored
// episode reads, and starts the daily rebuild chain.
type ProjectEpisodeReadsArgs struct{}

func (ProjectEpisodeReadsArgs) Kind() string { return kindProjectEpisodeReads }

func (ProjectEpisodeReadsArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// AggregateContentStatsArgs rebuilds every calendar day of content_daily_stats
// each tenant is owed.
type AggregateContentStatsArgs struct{}

func (AggregateContentStatsArgs) Kind() string { return kindAggregateContentStats }

func (AggregateContentStatsArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// AggregateRankingsArgs rebuilds the daily and weekly ranking snapshots of
// every day each tenant is owed.
type AggregateRankingsArgs struct{}

func (AggregateRankingsArgs) Kind() string { return kindAggregateRankings }

func (AggregateRankingsArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// BuildRecommendFeaturesArgs rebuilds the user and item feature snapshots of
// every tenant whose rankings have moved past them.
type BuildRecommendFeaturesArgs struct{}

func (BuildRecommendFeaturesArgs) Kind() string { return kindBuildRecommendFeatures }

func (BuildRecommendFeaturesArgs) InsertOpts() river.InsertOpts { return insertOpts() }

// PurgeContentEventsArgs deletes content_events rows past their retention
// window.
type PurgeContentEventsArgs struct{}

func (PurgeContentEventsArgs) Kind() string { return kindPurgeContentEvents }

func (PurgeContentEventsArgs) InsertOpts() river.InsertOpts {
	return purgeInsertOpts(contentEventPurgeInterval)
}

// PurgeRankingSnapshotsArgs deletes content_ranking_snapshots rows past their
// retention window.
type PurgeRankingSnapshotsArgs struct{}

func (PurgeRankingSnapshotsArgs) Kind() string { return kindPurgeRankingSnapshots }

func (PurgeRankingSnapshotsArgs) InsertOpts() river.InsertOpts {
	return purgeInsertOpts(rankingSnapshotPurgeInterval)
}

// PurgeMfaChallengesArgs deletes the spent admin MFA challenges whose tokens
// have expired.
type PurgeMfaChallengesArgs struct{}

func (PurgeMfaChallengesArgs) Kind() string { return kindPurgeMfaChallenges }

func (PurgeMfaChallengesArgs) InsertOpts() river.InsertOpts {
	return purgeInsertOpts(mfaChallengePurgeInterval)
}

// PurgeWithdrawnCommentsArgs deletes the comments their authors withdrew past
// the retention window.
type PurgeWithdrawnCommentsArgs struct{}

func (PurgeWithdrawnCommentsArgs) Kind() string { return kindPurgeWithdrawnComments }

func (PurgeWithdrawnCommentsArgs) InsertOpts() river.InsertOpts {
	return purgeInsertOpts(withdrawnCommentPurgeInterval)
}

// PurgeOrphanImagesArgs deletes the image rows and storage objects nothing
// references.
type PurgeOrphanImagesArgs struct{}

func (PurgeOrphanImagesArgs) Kind() string { return kindPurgeOrphanImages }

func (PurgeOrphanImagesArgs) InsertOpts() river.InsertOpts {
	return purgeInsertOpts(orphanImagePurgeInterval)
}

// CloseRoyaltyStatementsArgs closes the royalty statement of every month a
// tenant that chose automatic closing is owed. Like the rebuild chain it keeps
// no completed run as a reason to skip one: a pass closes only what is owed,
// so one that finds nothing to close is the answer rather than a waste.
type CloseRoyaltyStatementsArgs struct{}

func (CloseRoyaltyStatementsArgs) Kind() string { return kindCloseRoyaltyStatements }

func (CloseRoyaltyStatementsArgs) InsertOpts() river.InsertOpts { return insertOpts() }

type projectEpisodeReadsWorker struct {
	river.WorkerDefaults[ProjectEpisodeReadsArgs]
	jobs *Jobs
}

func (w *projectEpisodeReadsWorker) Timeout(*river.Job[ProjectEpisodeReadsArgs]) time.Duration {
	return jobTimeout
}

func (w *projectEpisodeReadsWorker) Work(ctx context.Context, job *river.Job[ProjectEpisodeReadsArgs]) error {
	return w.jobs.run(ctx, job.JobRow, ServiceNameProjectEpisodeReads, func(ctx context.Context, deps maintenance.Deps) error {
		return enqueueNext(ctx, w.jobs.episodeReads.CatchUp(ctx, deps), AggregateContentStatsArgs{})
	})
}

type aggregateContentStatsWorker struct {
	river.WorkerDefaults[AggregateContentStatsArgs]
	jobs *Jobs
}

func (w *aggregateContentStatsWorker) Timeout(*river.Job[AggregateContentStatsArgs]) time.Duration {
	return jobTimeout
}

func (w *aggregateContentStatsWorker) Work(ctx context.Context, job *river.Job[AggregateContentStatsArgs]) error {
	return w.jobs.run(ctx, job.JobRow, ServiceNameAggregateContentStats, func(ctx context.Context, deps maintenance.Deps) error {
		return enqueueNext(ctx, w.jobs.contentStats.CatchUp(ctx, deps), AggregateRankingsArgs{})
	})
}

type aggregateRankingsWorker struct {
	river.WorkerDefaults[AggregateRankingsArgs]
	jobs *Jobs
}

func (w *aggregateRankingsWorker) Timeout(*river.Job[AggregateRankingsArgs]) time.Duration {
	return jobTimeout
}

func (w *aggregateRankingsWorker) Work(ctx context.Context, job *river.Job[AggregateRankingsArgs]) error {
	return w.jobs.run(ctx, job.JobRow, ServiceNameAggregateRankings, func(ctx context.Context, deps maintenance.Deps) error {
		return enqueueNext(ctx, w.jobs.rankings.CatchUp(ctx, deps), BuildRecommendFeaturesArgs{})
	})
}

type buildRecommendFeaturesWorker struct {
	river.WorkerDefaults[BuildRecommendFeaturesArgs]
	jobs *Jobs
}

func (w *buildRecommendFeaturesWorker) Timeout(*river.Job[BuildRecommendFeaturesArgs]) time.Duration {
	return jobTimeout
}

func (w *buildRecommendFeaturesWorker) Work(ctx context.Context, job *river.Job[BuildRecommendFeaturesArgs]) error {
	return w.jobs.run(ctx, job.JobRow, ServiceNameBuildRecommendFeatures, func(ctx context.Context, deps maintenance.Deps) error {
		return w.jobs.recommendFeatures.CatchUp(ctx, deps)
	})
}

type purgeContentEventsWorker struct {
	river.WorkerDefaults[PurgeContentEventsArgs]
	jobs *Jobs
}

func (w *purgeContentEventsWorker) Timeout(*river.Job[PurgeContentEventsArgs]) time.Duration {
	return jobTimeout
}

func (w *purgeContentEventsWorker) Work(ctx context.Context, job *river.Job[PurgeContentEventsArgs]) error {
	return w.jobs.run(ctx, job.JobRow, ServiceNamePurgeContentEvents, func(ctx context.Context, deps maintenance.Deps) error {
		return w.jobs.contentEvents.Run(ctx, deps)
	})
}

type purgeRankingSnapshotsWorker struct {
	river.WorkerDefaults[PurgeRankingSnapshotsArgs]
	jobs *Jobs
}

func (w *purgeRankingSnapshotsWorker) Timeout(*river.Job[PurgeRankingSnapshotsArgs]) time.Duration {
	return jobTimeout
}

func (w *purgeRankingSnapshotsWorker) Work(ctx context.Context, job *river.Job[PurgeRankingSnapshotsArgs]) error {
	return w.jobs.run(ctx, job.JobRow, ServiceNamePurgeRankingSnapshots, func(ctx context.Context, deps maintenance.Deps) error {
		return w.jobs.rankingSnapshots.Run(ctx, deps)
	})
}

type purgeMfaChallengesWorker struct {
	river.WorkerDefaults[PurgeMfaChallengesArgs]
	jobs *Jobs
}

func (w *purgeMfaChallengesWorker) Timeout(*river.Job[PurgeMfaChallengesArgs]) time.Duration {
	return jobTimeout
}

func (w *purgeMfaChallengesWorker) Work(ctx context.Context, job *river.Job[PurgeMfaChallengesArgs]) error {
	return w.jobs.run(ctx, job.JobRow, ServiceNamePurgeMfaChallenges, func(ctx context.Context, deps maintenance.Deps) error {
		return w.jobs.mfaChallenges.Run(ctx, deps)
	})
}

type purgeWithdrawnCommentsWorker struct {
	river.WorkerDefaults[PurgeWithdrawnCommentsArgs]
	jobs *Jobs
}

func (w *purgeWithdrawnCommentsWorker) Timeout(*river.Job[PurgeWithdrawnCommentsArgs]) time.Duration {
	return jobTimeout
}

func (w *purgeWithdrawnCommentsWorker) Work(ctx context.Context, job *river.Job[PurgeWithdrawnCommentsArgs]) error {
	return w.jobs.run(ctx, job.JobRow, ServiceNamePurgeWithdrawnComments, func(ctx context.Context, deps maintenance.Deps) error {
		return w.jobs.withdrawnComments.Run(ctx, deps)
	})
}

type purgeOrphanImagesWorker struct {
	river.WorkerDefaults[PurgeOrphanImagesArgs]
	jobs *Jobs
}

func (w *purgeOrphanImagesWorker) Timeout(*river.Job[PurgeOrphanImagesArgs]) time.Duration {
	return jobTimeout
}

func (w *purgeOrphanImagesWorker) Work(ctx context.Context, job *river.Job[PurgeOrphanImagesArgs]) error {
	return w.jobs.run(ctx, job.JobRow, ServiceNamePurgeOrphanImages, func(ctx context.Context, deps maintenance.Deps) error {
		err := w.jobs.orphanImages.Run(ctx, deps)
		// No retry saves a platform with no object store configured, so the run
		// is cancelled with that error rather than retried until it is discarded.
		if errors.Is(err, storage.ErrNotConfigured) {
			return river.JobCancel(err)
		}
		return err
	})
}

type closeRoyaltyStatementsWorker struct {
	river.WorkerDefaults[CloseRoyaltyStatementsArgs]
	jobs *Jobs
}

func (w *closeRoyaltyStatementsWorker) Timeout(*river.Job[CloseRoyaltyStatementsArgs]) time.Duration {
	return jobTimeout
}

func (w *closeRoyaltyStatementsWorker) Work(ctx context.Context, job *river.Job[CloseRoyaltyStatementsArgs]) error {
	return w.jobs.run(ctx, job.JobRow, ServiceNameCloseRoyaltyStatements, func(ctx context.Context, deps maintenance.Deps) error {
		return w.jobs.royaltyStatements.Run(ctx, deps)
	})
}

// enqueueNext enqueues the next link of the daily rebuild chain, even after a
// failed pass: the failure held back only the tenants it hit, and the next link
// never reads past what a tenant has finished.
func enqueueNext(ctx context.Context, passErr error, next river.JobArgs) error {
	if ctx.Err() != nil {
		return passErr
	}
	client, err := river.ClientFromContextSafely[*sql.Tx](ctx)
	if err != nil {
		return errors.Join(passErr, fmt.Errorf("enqueue %s: %w", next.Kind(), err))
	}
	if _, err := client.Insert(ctx, next, nil); err != nil {
		return errors.Join(passErr, fmt.Errorf("enqueue %s: %w", next.Kind(), err))
	}
	return passErr
}
