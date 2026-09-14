// Package tickerjobs runs the three jobs that have to act the moment a stored
// instant passes — promoting due episodes, applying free window boundaries, and
// turning over each tenant's calendar day — as River periodic jobs.
//
// Each of them used to be a process of its own on a ticker, which meant three
// more deployments to schedule, supervise, and keep from overlapping. River is
// already in the worker next to them, and it answers all three: the schedule is
// the periodic job, the overlap guard is the unique constraint below, and a due
// run is a row in river_job that an operator can see rather than a log line
// they have to go looking for.
//
// The jobs keep a connection of their own. The worker's own login owns River's
// schema and therefore holds CREATE on the public schema, which is exactly the
// privilege these three must not have: they read and write a small set of
// catalog tables and create nothing.
package tickerjobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/publira/publira/server/internal/dayroll"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/freewindows"
	"github.com/publira/publira/server/internal/publishepisodes"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/tenantday"
	"github.com/publira/publira/server/internal/tracing"
)

// The service.name each job's runs are recorded under. They are the names the
// subcommands reported when each job was a process, so a trace UI that was
// filtering on one of them keeps finding the same work.
const (
	ServiceNamePublishEpisodes  = "publira-publish-episodes"
	ServiceNameApplyFreeWindows = "publira-apply-free-windows"
	ServiceNameRollTenantDay    = "publira-roll-tenant-day"
)

// QueueName is the River queue the three run on. They are kept off the default
// queue because one pass is long and rare while an outbox job is short and
// constant: a publish that walks every tenant with retries would otherwise hold
// one of the drain's own workers for as long as it takes.
const QueueName = "ticker"

// queueMaxWorkers is one slot per job. Two runs of the same job are already
// refused by the unique constraint below, and the three are independent of each
// other, so nothing is gained by a wider queue.
const queueMaxWorkers = 3

const (
	kindPublishEpisodes  = "ticker.publish_episodes"
	kindApplyFreeWindows = "ticker.apply_free_windows"
	kindRollTenantDay    = "ticker.roll_tenant_day"

	DefaultPublishInterval    = time.Minute
	DefaultPublishMaxRetries  = 3
	DefaultFreeWindowInterval = time.Minute
	DefaultTenantDayInterval  = time.Minute

	// jobTimeout bounds one pass. It is well above any interval because a pass
	// that has fallen behind is the one that must not be cut off half way: it
	// walks every tenant, and the episodes it publishes carry their own retry
	// schedule. A run that reaches this has stopped making progress.
	jobTimeout = 10 * time.Minute
)

// ServiceNames lists every service.name these jobs record under, for the
// tracing.Setup call of the process that runs them.
func ServiceNames() []string {
	return []string{ServiceNamePublishEpisodes, ServiceNameApplyFreeWindows, ServiceNameRollTenantDay}
}

// Config is the wiring one process needs to run all three jobs. A zero
// interval takes the default above; a zero retry budget does not, because one
// attempt per episode is a setting rather than an omission, and the process
// that reads the environment is where the unset variable becomes the default.
type Config struct {
	// DB is the ticker role's own pool. Every query below runs on it.
	DB *sql.DB
	// Revalidate drops the Next.js cache tags each job answers for. A nil
	// client makes every drop a no-op, which is what a deployment without a
	// revalidate token gets.
	Revalidate *revalidate.Client
	Logger     *slog.Logger

	PublishInterval time.Duration
	// PublishMaxRetries is the retry budget of one episode. Zero is a single
	// attempt; a negative budget is clamped to the same by the runner.
	PublishMaxRetries  int
	FreeWindowInterval time.Duration
	TenantDayInterval  time.Duration
}

func (c Config) withDefaults() Config {
	if c.Logger == nil {
		c.Logger = slog.Default()
	}
	if c.PublishInterval <= 0 {
		c.PublishInterval = DefaultPublishInterval
	}
	if c.FreeWindowInterval <= 0 {
		c.FreeWindowInterval = DefaultFreeWindowInterval
	}
	if c.TenantDayInterval <= 0 {
		c.TenantDayInterval = DefaultTenantDayInterval
	}
	return c
}

// Jobs holds the three runners for the life of the process. The runners are
// built once rather than per job run because one of them remembers something:
// dayroll keeps the date each tenant was last turned over in memory, and a
// runner rebuilt on every tick would drop a tag for every tenant every minute.
type Jobs struct {
	cfg        Config
	publish    *publishepisodes.Runner
	freeWindow *freewindows.Runner
	tenantDay  *dayroll.Runner
}

// New constructs the three runners over cfg.DB.
func New(cfg Config) (*Jobs, error) {
	if cfg.DB == nil {
		return nil, errors.New("tickerjobs: db is nil")
	}
	cfg = cfg.withDefaults()
	queries := dbmodels.New(cfg.DB)
	return &Jobs{
		cfg:        cfg,
		publish:    publishepisodes.New(cfg.DB, queries, cfg.Revalidate, cfg.Logger, cfg.PublishMaxRetries),
		freeWindow: freewindows.New(queries, cfg.Revalidate, cfg.Logger),
		tenantDay: dayroll.New(func(ctx context.Context) ([]tenantday.Tenant, error) {
			return tenantday.List(ctx, cfg.DB)
		}, cfg.Revalidate, cfg.Logger),
	}, nil
}

// Register adds the three workers to the River client's registry.
func (j *Jobs) Register(workers *river.Workers) error {
	if err := river.AddWorkerSafely(workers, &publishEpisodesWorker{jobs: j}); err != nil {
		return fmt.Errorf("tickerjobs: register publish-episodes worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &applyFreeWindowsWorker{jobs: j}); err != nil {
		return fmt.Errorf("tickerjobs: register apply-free-windows worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &rollTenantDayWorker{jobs: j}); err != nil {
		return fmt.Errorf("tickerjobs: register roll-tenant-day worker: %w", err)
	}
	return nil
}

// PeriodicJobs is the schedule River enqueues the three on.
//
// RunOnStart is what the ticker processes did with their first pass, and every
// job here still needs it: a deployment that was down over a scheduled time, a
// window boundary, or a midnight catches up as soon as it comes back rather
// than at the next interval.
func (j *Jobs) PeriodicJobs() []*river.PeriodicJob {
	return []*river.PeriodicJob{
		river.NewPeriodicJob(
			river.PeriodicInterval(j.cfg.PublishInterval),
			func() (river.JobArgs, *river.InsertOpts) { return PublishEpisodesArgs{}, nil },
			&river.PeriodicJobOpts{RunOnStart: true},
		),
		river.NewPeriodicJob(
			river.PeriodicInterval(j.cfg.FreeWindowInterval),
			func() (river.JobArgs, *river.InsertOpts) { return ApplyFreeWindowsArgs{}, nil },
			&river.PeriodicJobOpts{RunOnStart: true},
		),
		river.NewPeriodicJob(
			river.PeriodicInterval(j.cfg.TenantDayInterval),
			func() (river.JobArgs, *river.InsertOpts) { return RollTenantDayArgs{}, nil },
			&river.PeriodicJobOpts{RunOnStart: true},
		),
	}
}

// Queues is the queue the three are enqueued on, for the client that runs them.
func (j *Jobs) Queues() map[string]river.QueueConfig {
	return map[string]river.QueueConfig{QueueName: {MaxWorkers: queueMaxWorkers}}
}

// Settings reports what the jobs were built with, for the startup log of the
// process that runs them.
func (j *Jobs) Settings() []any {
	return []any{
		"publish_interval", j.cfg.PublishInterval,
		"publish_max_retries", j.cfg.PublishMaxRetries,
		"free_window_interval", j.cfg.FreeWindowInterval,
		"tenant_day_interval", j.cfg.TenantDayInterval,
	}
}

// PublishEpisodesArgs promotes every episode whose scheduled time has passed.
type PublishEpisodesArgs struct{}

func (PublishEpisodesArgs) Kind() string { return kindPublishEpisodes }

func (PublishEpisodesArgs) InsertOpts() river.InsertOpts { return tickerInsertOpts() }

// ApplyFreeWindowsArgs drops the public site caches at every free window
// boundary that has passed.
type ApplyFreeWindowsArgs struct{}

func (ApplyFreeWindowsArgs) Kind() string { return kindApplyFreeWindows }

func (ApplyFreeWindowsArgs) InsertOpts() river.InsertOpts { return tickerInsertOpts() }

// RollTenantDayArgs turns over the caches of every tenant that has entered a
// new calendar day.
type RollTenantDayArgs struct{}

func (RollTenantDayArgs) Kind() string { return kindRollTenantDay }

func (RollTenantDayArgs) InsertOpts() river.InsertOpts { return tickerInsertOpts() }

// tickerInsertOpts is what keeps one tenant from being written twice.
//
// Every run of one of these jobs spans every tenant, so two of them at once
// would have two connections publishing the same episode and dropping the same
// tags. Unique over the in-flight states means the insert is skipped while a
// run of that job is still pending, scheduled, running, or waiting to retry —
// which covers both the second worker in a deployment enqueueing its own copy,
// and a pass that outlasts its own interval.
//
// MaxAttempts is 1 because none of the three reports failure upwards: each one
// logs what it could not finish and leaves it for the next run, which is what
// made them tickers in the first place. A River retry would only start the same
// full pass again sooner than the schedule already will.
func tickerInsertOpts() river.InsertOpts {
	return river.InsertOpts{
		Queue:       QueueName,
		MaxAttempts: 1,
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

type publishEpisodesWorker struct {
	river.WorkerDefaults[PublishEpisodesArgs]
	jobs *Jobs
}

func (w *publishEpisodesWorker) Timeout(*river.Job[PublishEpisodesArgs]) time.Duration {
	return jobTimeout
}

func (w *publishEpisodesWorker) Work(ctx context.Context, _ *river.Job[PublishEpisodesArgs]) error {
	ctx, end := startRun(ctx, ServiceNamePublishEpisodes, kindPublishEpisodes)
	defer end()
	w.jobs.publish.RunOnce(ctx)
	return nil
}

type applyFreeWindowsWorker struct {
	river.WorkerDefaults[ApplyFreeWindowsArgs]
	jobs *Jobs
}

func (w *applyFreeWindowsWorker) Timeout(*river.Job[ApplyFreeWindowsArgs]) time.Duration {
	return jobTimeout
}

func (w *applyFreeWindowsWorker) Work(ctx context.Context, _ *river.Job[ApplyFreeWindowsArgs]) error {
	ctx, end := startRun(ctx, ServiceNameApplyFreeWindows, kindApplyFreeWindows)
	defer end()
	w.jobs.freeWindow.RunOnce(ctx)
	return nil
}

type rollTenantDayWorker struct {
	river.WorkerDefaults[RollTenantDayArgs]
	jobs *Jobs
}

func (w *rollTenantDayWorker) Timeout(*river.Job[RollTenantDayArgs]) time.Duration {
	return jobTimeout
}

func (w *rollTenantDayWorker) Work(ctx context.Context, _ *river.Job[RollTenantDayArgs]) error {
	ctx, end := startRun(ctx, ServiceNameRollTenantDay, kindRollTenantDay)
	defer end()
	w.jobs.tenantDay.RunOnce(ctx, time.Now())
	return nil
}

// startRun opens the span a pass hangs off, taken from the provider registered
// for that job's own service.name.
//
// A trace UI attributes a trace to the service of its root span, so this is
// what keeps the three apart now that they share a process: a run of
// publish-episodes is still a publira-publish-episodes trace. The spans inside
// it — the runner's own, and every statement the instrumented pool issues —
// belong to the worker that executed it and carry its name, the way they do for
// every other job in the process.
func startRun(ctx context.Context, serviceName, kind string) (context.Context, func()) {
	tracer := tracing.TracerProvider(serviceName).Tracer("github.com/publira/publira/server/internal/tickerjobs")
	ctx, span := tracer.Start(ctx, kind)
	return ctx, func() { span.End() }
}
