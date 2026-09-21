// Package maintenancejobs runs this repository's recurring rebuild and purge
// work — projecting episode reads, aggregating daily stats, rankings and
// recommend features, and purging what has passed its retention window — as
// River jobs on the resident worker's own client.
//
// Each kind wraps the matching job in internal/maintenance, which is the same
// implementation cmd/batch invokes for an explicit operator run. A pass that
// only the schedule can reach would be a second copy of the maintenance,
// diverging from the one an operator uses to recover from an incident.
//
// The jobs keep a connection of their own. The worker's own login owns River's
// schema and therefore holds CREATE on the public schema, which is a privilege
// work that rebuilds and deletes rows has no use for.
package maintenancejobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/publira/publira/server/internal/maintenance"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/tracing"
)

// The service.name each job's runs are recorded under. They are the names the
// subcommands report, so a trace UI that was filtering on a scheduled batch
// keeps finding the same work once the worker owns it.
const (
	ServiceNameProjectEpisodeReads    = "publira-project-episode-reads"
	ServiceNameAggregateContentStats  = "publira-aggregate-content-stats"
	ServiceNameAggregateRankings      = "publira-aggregate-rankings"
	ServiceNameBuildRecommendFeatures = "publira-build-recommend-features"

	ServiceNamePurgeContentEvents     = "publira-purge-content-events"
	ServiceNamePurgeRankingSnapshots  = "publira-purge-ranking-snapshots"
	ServiceNamePurgeMfaChallenges     = "publira-purge-mfa-challenges"
	ServiceNamePurgeWithdrawnComments = "publira-purge-withdrawn-comments"
	ServiceNamePurgeOrphanImages      = "publira-purge-orphan-images"
)

// QueueName is the River queue they run on. A rebuild walks every tenant and a
// purge deletes in chunks until a table is drained, where an outbox job is
// short and constant: on the drain's own queue one of these would hold a worker
// it is counting on for as long as the rebuild takes.
const QueueName = "maintenance"

// queueMaxWorkers runs one pass at a time. These share one database with every
// request the platform is serving, and a purge that ran beside a rebuild would
// only take the rows out from under it.
const queueMaxWorkers = 1

const (
	kindProjectEpisodeReads    = "maintenance.project_episode_reads"
	kindAggregateContentStats  = "maintenance.aggregate_content_stats"
	kindAggregateRankings      = "maintenance.aggregate_rankings"
	kindBuildRecommendFeatures = "maintenance.build_recommend_features"

	kindPurgeContentEvents     = "maintenance.purge_content_events"
	kindPurgeRankingSnapshots  = "maintenance.purge_ranking_snapshots"
	kindPurgeMfaChallenges     = "maintenance.purge_mfa_challenges"
	kindPurgeWithdrawnComments = "maintenance.purge_withdrawn_comments"
	kindPurgeOrphanImages      = "maintenance.purge_orphan_images"
)

const (
	// maxAttempts retries a failed pass. Every job here is idempotent — a
	// rebuild restates the rows it owns and a purge deletes what is still past
	// its window — so a pass lost to a connection drop is worth running again
	// rather than leaving a gap until the next scheduled one.
	maxAttempts = 3

	// jobTimeout bounds one pass. It is far above any of their intervals
	// because a rebuild walks every tenant and a purge drains a table that may
	// have been accumulating for as long as the deployment has existed. A run
	// that reaches this has stopped making progress.
	jobTimeout = time.Hour

	// dailyRebuildInterval is how often the daily rebuild chain looks for a
	// finished day. Each tenant's midnight falls on a different hour.
	dailyRebuildInterval = time.Hour
)

// How often each purge runs. A retention period is counted in days, so a daily
// pass deletes a row at most a day after it expires. The withdrawn comment
// purge runs hourly because the admin console shows staff the instant a
// comment is due to go, and the MFA purge because its rows expire five minutes
// after they are written.
const (
	contentEventPurgeInterval     = 24 * time.Hour
	rankingSnapshotPurgeInterval  = 24 * time.Hour
	mfaChallengePurgeInterval     = time.Hour
	withdrawnCommentPurgeInterval = time.Hour
	orphanImagePurgeInterval      = 24 * time.Hour
)

// ServiceNames lists every service.name these jobs record under, for the
// tracing.Setup call of the process that runs them.
func ServiceNames() []string {
	return []string{
		ServiceNameProjectEpisodeReads,
		ServiceNameAggregateContentStats,
		ServiceNameAggregateRankings,
		ServiceNameBuildRecommendFeatures,
		ServiceNamePurgeContentEvents,
		ServiceNamePurgeRankingSnapshots,
		ServiceNamePurgeMfaChallenges,
		ServiceNamePurgeWithdrawnComments,
		ServiceNamePurgeOrphanImages,
	}
}

// Config is the wiring one process needs to run every job.
type Config struct {
	// DB is the maintenance role's own pool. Every query runs on it.
	DB *sql.DB
	// Storage resolves the bucket the orphan image sweep reclaims. A platform
	// with none configured still registers the sweep, whose runs are then
	// cancelled with storage.ErrNotConfigured.
	Storage storage.ReclaimerSource
	Logger  *slog.Logger
}

// Jobs holds the settings each kind runs with for the life of the process.
// They are read once, in New, so a value an operator mistyped stops startup
// rather than failing every scheduled pass from then on.
//
// The dated rebuilds keep their zero date: which days a scheduled pass covers
// comes from the progress each tenant has recorded, and a date naming one run
// is the operator's to pass through cmd/batch.
type Jobs struct {
	deps maintenance.Deps

	episodeReads      maintenance.EpisodeReadProjection
	contentStats      maintenance.ContentStatsAggregation
	rankings          maintenance.RankingAggregation
	recommendFeatures maintenance.RecommendFeatureBuild

	contentEvents     maintenance.ContentEventPurge
	rankingSnapshots  maintenance.RankingSnapshotPurge
	mfaChallenges     maintenance.MfaChallengePurge
	withdrawnComments maintenance.WithdrawnCommentPurge
	orphanImages      maintenance.OrphanImagePurge
}

// New reads every job's tunables and holds them with the pool they run on.
func New(cfg Config) (*Jobs, error) {
	if cfg.DB == nil {
		return nil, errors.New("maintenancejobs: db is nil")
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}

	jobs := &Jobs{deps: maintenance.Deps{
		DB:      cfg.DB,
		Storage: cfg.Storage,
		Logger:  cfg.Logger,
	}}

	var err error
	if jobs.episodeReads, err = maintenance.LoadEpisodeReadProjection(); err != nil {
		return nil, fmt.Errorf("maintenancejobs: %w", err)
	}
	if jobs.rankings, err = maintenance.LoadRankingAggregation(); err != nil {
		return nil, fmt.Errorf("maintenancejobs: %w", err)
	}
	if jobs.recommendFeatures, err = maintenance.LoadRecommendFeatureBuild(); err != nil {
		return nil, fmt.Errorf("maintenancejobs: %w", err)
	}
	if jobs.contentEvents, err = maintenance.LoadContentEventPurge(); err != nil {
		return nil, fmt.Errorf("maintenancejobs: %w", err)
	}
	if jobs.rankingSnapshots, err = maintenance.LoadRankingSnapshotPurge(); err != nil {
		return nil, fmt.Errorf("maintenancejobs: %w", err)
	}
	if jobs.mfaChallenges, err = maintenance.LoadMfaChallengePurge(); err != nil {
		return nil, fmt.Errorf("maintenancejobs: %w", err)
	}
	if jobs.withdrawnComments, err = maintenance.LoadWithdrawnCommentPurge(); err != nil {
		return nil, fmt.Errorf("maintenancejobs: %w", err)
	}
	if jobs.orphanImages, err = maintenance.LoadOrphanImagePurge(); err != nil {
		return nil, fmt.Errorf("maintenancejobs: %w", err)
	}
	return jobs, nil
}

// Register adds the workers to the River client's registry.
func (j *Jobs) Register(workers *river.Workers) error {
	if err := river.AddWorkerSafely(workers, &projectEpisodeReadsWorker{jobs: j}); err != nil {
		return fmt.Errorf("maintenancejobs: register project-episode-reads worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &aggregateContentStatsWorker{jobs: j}); err != nil {
		return fmt.Errorf("maintenancejobs: register aggregate-content-stats worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &aggregateRankingsWorker{jobs: j}); err != nil {
		return fmt.Errorf("maintenancejobs: register aggregate-rankings worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &buildRecommendFeaturesWorker{jobs: j}); err != nil {
		return fmt.Errorf("maintenancejobs: register build-recommend-features worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &purgeContentEventsWorker{jobs: j}); err != nil {
		return fmt.Errorf("maintenancejobs: register purge-content-events worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &purgeRankingSnapshotsWorker{jobs: j}); err != nil {
		return fmt.Errorf("maintenancejobs: register purge-ranking-snapshots worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &purgeMfaChallengesWorker{jobs: j}); err != nil {
		return fmt.Errorf("maintenancejobs: register purge-mfa-challenges worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &purgeWithdrawnCommentsWorker{jobs: j}); err != nil {
		return fmt.Errorf("maintenancejobs: register purge-withdrawn-comments worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &purgeOrphanImagesWorker{jobs: j}); err != nil {
		return fmt.Errorf("maintenancejobs: register purge-orphan-images worker: %w", err)
	}
	return nil
}

// PeriodicJobs is the schedule River enqueues them on. Only the head of the
// daily rebuild chain is scheduled, and each link enqueues the next.
//
// Every one runs on start as well. A purge deletes whatever is past its cutoff
// at the time it runs, so the first pass after a restart drains everything
// that expired while the worker was down, and a worker restarted more often
// than a day is not a worker whose daily purges never come due.
func (j *Jobs) PeriodicJobs() []*river.PeriodicJob {
	schedules := []struct {
		interval time.Duration
		args     river.JobArgs
	}{
		{dailyRebuildInterval, ProjectEpisodeReadsArgs{}},
		{contentEventPurgeInterval, PurgeContentEventsArgs{}},
		{rankingSnapshotPurgeInterval, PurgeRankingSnapshotsArgs{}},
		{mfaChallengePurgeInterval, PurgeMfaChallengesArgs{}},
		{withdrawnCommentPurgeInterval, PurgeWithdrawnCommentsArgs{}},
		{orphanImagePurgeInterval, PurgeOrphanImagesArgs{}},
	}
	periodic := make([]*river.PeriodicJob, 0, len(schedules))
	for _, schedule := range schedules {
		args := schedule.args
		periodic = append(periodic, river.NewPeriodicJob(
			river.PeriodicInterval(schedule.interval),
			func() (river.JobArgs, *river.InsertOpts) { return args, nil },
			&river.PeriodicJobOpts{RunOnStart: true},
		))
	}
	return periodic
}

// Queues is the queue they are enqueued on, for the client that runs them.
func (j *Jobs) Queues() map[string]river.QueueConfig {
	return map[string]river.QueueConfig{QueueName: {MaxWorkers: queueMaxWorkers}}
}

// Settings reports what the jobs were built with, for the startup log of the
// process that runs them.
func (j *Jobs) Settings() []any {
	return []any{
		"episode_read_projection_batch_size", j.episodeReads.BatchSize,
		"content_ranking_item_limit", j.rankings.ItemLimit,
		"recommend_features_window_days", j.recommendFeatures.WindowDays,
		"content_events_purge_chunk_size", j.contentEvents.ChunkSize,
		"content_ranking_purge_chunk_size", j.rankingSnapshots.ChunkSize,
		"mfa_challenge_purge_chunk_size", j.mfaChallenges.ChunkSize,
		"comment_purge_chunk_size", j.withdrawnComments.ChunkSize,
		"orphan_images_min_age", j.orphanImages.MinAge,
		"orphan_images_page_size", j.orphanImages.PageSize,
	}
}

// insertOpts is what keeps one table from being rebuilt or drained twice.
//
// Every run of one of these jobs spans every tenant, so two at once would have
// two connections restating the same rows or deleting the same chunk. Unique
// over the in-flight states means the insert is skipped while a run of that
// kind is still pending, scheduled, running, or waiting to retry — which covers
// both a second instance of the worker enqueueing its own copy, and a pass that
// outlasts the interval it was enqueued on.
func insertOpts() river.InsertOpts {
	return river.InsertOpts{
		Queue:       QueueName,
		MaxAttempts: maxAttempts,
		UniqueOpts: river.UniqueOpts{
			ByState: []rivertype.JobState{
				rivertype.JobStateAvailable,
				rivertype.JobStatePending,
				rivertype.JobStateRunning,
				rivertype.JobStateRetryable,
				rivertype.JobStateScheduled,
			},
		},
	}
}

// purgeInsertOpts is insertOpts, and also keeps a purge to one run per
// interval.
//
// Running on start would otherwise make every restart a pass of its own, and a
// sweep of the whole bucket on every deploy. A run that completed in the
// current interval, aligned to the epoch rather than to the process start,
// therefore skips the insert as well. A run that failed for good does not, so
// the next restart tries again.
func purgeInsertOpts(interval time.Duration) river.InsertOpts {
	opts := insertOpts()
	opts.UniqueOpts.ByPeriod = interval
	opts.UniqueOpts.ByState = append(opts.UniqueOpts.ByState, rivertype.JobStateCompleted)
	return opts
}

// startRun opens the span a pass hangs off, taken from the provider registered
// for that job's own service.name.
//
// A trace UI attributes a trace to the service of its root span, so this is
// what keeps the jobs apart now that they share a process with each other and
// with the outbox drain: a rebuild of the daily stats is still a
// publira-aggregate-content-stats trace. The spans inside it belong to the
// worker that executed it and carry its name.
func startRun(ctx context.Context, serviceName, kind string) (context.Context, func()) {
	tracer := tracing.TracerProvider(serviceName).Tracer("github.com/publira/publira/server/internal/maintenancejobs")
	ctx, span := tracer.Start(ctx, kind)
	return ctx, func() { span.End() }
}
