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

// queueMaxWorkers is deliberately small. These jobs share one database with
// every request the platform is serving, and the daily rebuilds are a chain
// each link of which needs the one before it, so nothing is gained by running
// many of them side by side — and a wide queue would let a day's rebuild
// compete with the purge of the table it reads.
const queueMaxWorkers = 2

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
	// Storage is the bucket the orphan image sweep reclaims. A process started
	// without one registers every other job and leaves that one unregistered,
	// the way a worker with no push credential leaves the push handler out.
	Storage storage.Reclaimer
	// Bucket names that bucket for the sweep's log.
	Bucket string
	Logger *slog.Logger
}

// Jobs holds the settings each kind runs with for the life of the process.
// They are read once, in New, so a value an operator mistyped stops startup
// rather than failing every scheduled pass from then on.
//
// The dated rebuilds keep their zero date, which covers each tenant's own
// yesterday in that tenant's zone. A date names one run rather than the
// deployment, so it is the operator's to pass through cmd/batch.
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
		Bucket:  cfg.Bucket,
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

// storageConfigured reports whether the orphan image sweep has a bucket, and
// with it whether that kind is one of the registered workers.
func (j *Jobs) storageConfigured() bool { return j.deps.Storage != nil }

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
	if !j.storageConfigured() {
		return nil
	}
	if err := river.AddWorkerSafely(workers, &purgeOrphanImagesWorker{jobs: j}); err != nil {
		return fmt.Errorf("maintenancejobs: register purge-orphan-images worker: %w", err)
	}
	return nil
}

// PeriodicJobs is the schedule River enqueues them on. What each kind's cadence
// and catch-up semantics are is still open: https://github.com/publira/publira/issues/2558
// settles it for the dated rebuilds and https://github.com/publira/publira/issues/2559
// for the purges, so until then a run is one an operator enqueues.
func (j *Jobs) PeriodicJobs() []*river.PeriodicJob { return nil }

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
		"orphan_images_enabled", j.storageConfigured(),
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
