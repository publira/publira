package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"runtime/debug"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverdatabasesql"
	"github.com/riverqueue/river/rivertype"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantstatus"
	"github.com/publira/publira/server/internal/tracing"
)

const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusDone       = "done"
	StatusDead       = "dead"

	kindDrain   = "outbox.drain"
	kindProcess = "outbox.process"

	defaultDrainInterval   = 2 * time.Second
	defaultClaimLimit      = int32(100)
	defaultMaxWorkers      = 8
	defaultStaleProcessing = 15 * time.Minute
	defaultJobTimeout      = 30 * time.Second
	defaultUnknownTypeWait = time.Minute
	defaultBlockedWait     = 10 * time.Minute
	maxLastErrorBytes      = 2048

	// outcomeTimeout bounds the write that records how an attempt ended. It
	// runs after the job's own context may already be cancelled, so it has a
	// deadline of its own instead.
	outcomeTimeout = 10 * time.Second

	// rescueStuckJobsAfter is how long a River job may stay running before the
	// leader's rescuer takes it for one a killed worker left behind and retries
	// it. River's default is an hour, and every job here is unique over the
	// running state, so a drain left running would hold every later drain back
	// for that long. The rescuer still waits out a kind's own Timeout before it
	// touches a job, so one value fits every queue: the drain and the process
	// jobs are retried after this, which outlasts their 30-second timeout and
	// the outcome write after it, and the ticker and maintenance jobs once their
	// own timeout has passed.
	rescueStuckJobsAfter = time.Minute

	// stopCancelGrace is the part of Stop's deadline kept back for the jobs
	// still running when the rest of it has passed. Their contexts are
	// cancelled then, so each returns and River records its attempt rather than
	// leaving the row running for the rescuer.
	stopCancelGrace = 5 * time.Second

	// unknownTypeWindow is how long after an event is written a worker that
	// has no handler for its type keeps leaving it for one that has. It
	// outlasts an upgrade that rolls the workers of two releases one copy at
	// a time, and a mail still waiting after that is one no running release
	// sends.
	unknownTypeWindow = 24 * time.Hour
)

// ServiceName is the service.name the drain's spans carry, and the worker
// process's default. The drain looks its provider up by this name rather than
// using the global one, because a process that serves the API as well
// installs the API's name as its default.
const ServiceName = "publira-worker"

// tracer is resolved on every use, not when the package is initialized:
// tracing.Setup runs after that, and a provider looked up before it would be
// the global one.
func tracer() trace.Tracer {
	return tracing.TracerProvider(ServiceName).Tracer("github.com/publira/publira/server/internal/outbox")
}

// Config tunes the resident worker. Zero values become the defaults of
// 2s drain, [DefaultMaxAttempts] attempts, and 15m stale reclaim.
type Config struct {
	Logger *slog.Logger
	// Handlers maps event_type to work. Nil becomes [DefaultRegistry].
	Handlers *Registry
	// DrainInterval is how often the leader enqueues an outbox.drain job.
	DrainInterval time.Duration
	// ClaimLimit is the maximum number of pending rows one drain claims.
	ClaimLimit int32
	// MaxAttempts is the outbox retry budget. The attempt that reaches
	// this count marks the row dead. An event type registered with
	// [Registry.RegisterWithAttempts] has a budget of its own instead.
	MaxAttempts int
	// StaleProcessing re-queues processing rows whose updated_at is older
	// than this. Zero uses the 15m default. A negative duration disables
	// reclaim.
	StaleProcessing time.Duration
	// MaxWorkers is River's default-queue concurrency.
	MaxWorkers int
	// RetryDelay waits after a failed attempt. Nil uses [RetryDelay].
	RetryDelay func(attempts int) time.Duration
	// UnknownTypeWait is how long an event whose type this worker has no
	// handler for waits before it can be claimed again, by a worker of a
	// newer release that has one. Zero uses the 1m default.
	UnknownTypeWait time.Duration
	// BlockedWait is how long an event whose handler answered [Blocked] waits
	// before it can be claimed again. Zero uses the 10m default.
	BlockedWait time.Duration
	// JobTimeout is how long one attempt of a handler may run before its
	// context is cancelled and the attempt counts as failed. Zero uses the 30s
	// default.
	JobTimeout time.Duration
	// FetchCooldown / FetchPollInterval are forwarded to River so tests
	// can pick jobs up without waiting on the production 1s poll.
	FetchCooldown     time.Duration
	FetchPollInterval time.Duration
	// Periodic is the sets of work this process runs on River's schedule
	// besides the outbox drain. An empty slice runs the drain alone. One
	// entry per set of jobs, because a process that hosts two of them — the
	// ticker jobs and the maintenance jobs — still owns one River client.
	Periodic []PeriodicRegistrar
	// Queues names the queues this client works, river.QueueDefault for the
	// outbox drain's. Empty works every queue: the default one and each a set
	// in Periodic brings. A queue named here must be one of those.
	//
	// A set whose queue is left out is still registered and scheduled, which
	// is why Periodic carries every set whatever this names. Whichever client
	// River elects leader enqueues every periodic job and rescues every job a
	// dead client left running, and it retries one only for a kind its own
	// registry knows.
	Queues []string
}

// PeriodicRegistrar is a set of jobs that rides the same River client as the
// outbox drain. One client per process is the point: a second would start a
// second copy of River's maintenance services over the same tables, and the
// deployment that runs the jobs would be one more to supervise.
type PeriodicRegistrar interface {
	// Register adds the workers for those jobs to the client's registry.
	Register(workers *river.Workers) error
	// PeriodicJobs is the schedule they are enqueued on.
	PeriodicJobs() []*river.PeriodicJob
	// Queues are the queues they run on, merged into the client's own. They
	// must not name the default queue: the outbox drain sizes that one, and a
	// job long enough to want a queue of its own is a job that must not hold a
	// worker the drain is counting on.
	Queues() map[string]river.QueueConfig
}

func (c Config) withDefaults() Config {
	if c.Logger == nil {
		c.Logger = slog.Default()
	}
	if c.Handlers == nil {
		c.Handlers = DefaultRegistry()
	}
	if c.DrainInterval <= 0 {
		c.DrainInterval = defaultDrainInterval
	}
	if c.ClaimLimit <= 0 {
		c.ClaimLimit = defaultClaimLimit
	}
	if c.MaxAttempts <= 0 {
		c.MaxAttempts = DefaultMaxAttempts
	}
	switch {
	case c.StaleProcessing < 0:
		// Negative disables reclaim so tests can pin a stuck processing row.
		c.StaleProcessing = 0
	case c.StaleProcessing == 0:
		c.StaleProcessing = defaultStaleProcessing
	}
	if c.MaxWorkers <= 0 {
		c.MaxWorkers = defaultMaxWorkers
	}
	if c.RetryDelay == nil {
		c.RetryDelay = RetryDelay
	}
	if c.UnknownTypeWait <= 0 {
		c.UnknownTypeWait = defaultUnknownTypeWait
	}
	if c.BlockedWait <= 0 {
		c.BlockedWait = defaultBlockedWait
	}
	if c.JobTimeout <= 0 {
		c.JobTimeout = defaultJobTimeout
	}
	return c
}

// Worker is the long-lived River client that drains outbox_events and
// runs registered handlers. API processes never start one of these.
type Worker struct {
	db      *sql.DB
	queries *dbmodels.Queries
	cfg     Config
	client  *river.Client[*sql.Tx]
	metrics *Metrics
	ready   atomic.Bool
	stop    sync.Once
	stopErr error
}

// Metrics returns the in-process counters. Nil-safe after a failed Start.
func (w *Worker) Metrics() *Metrics {
	if w == nil {
		return nil
	}
	return w.metrics
}

// Ready is the /readyz gate: true after River has started.
func (w *Worker) Ready() bool {
	return w != nil && w.ready.Load()
}

// Start migrates River's schema, boots the client, and begins draining.
// ctx is only used for the migrate and Start calls; jobs keep running
// until Stop.
func Start(ctx context.Context, db *sql.DB, cfg Config) (*Worker, error) {
	if db == nil {
		return nil, errors.New("outbox: db is nil")
	}
	cfg = cfg.withDefaults()
	if err := Migrate(ctx, db); err != nil {
		return nil, err
	}

	w := &Worker{
		db:      db,
		queries: dbmodels.New(db),
		cfg:     cfg,
		metrics: newMetrics(),
	}

	workers := river.NewWorkers()
	if err := river.AddWorkerSafely(workers, &drainWorker{worker: w}); err != nil {
		return nil, fmt.Errorf("outbox: register drain worker: %w", err)
	}
	if err := river.AddWorkerSafely(workers, &processWorker{worker: w}); err != nil {
		return nil, fmt.Errorf("outbox: register process worker: %w", err)
	}

	periodicJobs := []*river.PeriodicJob{
		river.NewPeriodicJob(
			river.PeriodicInterval(cfg.DrainInterval),
			func() (river.JobArgs, *river.InsertOpts) {
				return DrainArgs{}, nil
			},
			&river.PeriodicJobOpts{RunOnStart: true},
		),
	}
	queues := map[string]river.QueueConfig{
		river.QueueDefault: {MaxWorkers: cfg.MaxWorkers},
	}
	scheduled, err := registerPeriodic(workers, queues, cfg.Periodic)
	if err != nil {
		return nil, err
	}
	periodicJobs = append(periodicJobs, scheduled...)
	queues, err = hostedQueues(queues, cfg.Queues)
	if err != nil {
		return nil, err
	}

	riverCfg := &river.Config{
		Logger:            cfg.Logger,
		MaxAttempts:       5,
		FetchCooldown:     cfg.FetchCooldown,
		FetchPollInterval: cfg.FetchPollInterval,
		// A process job may run for JobTimeout and then write its outcome, and
		// a rescue inside that would run the event a second time.
		RescueStuckJobsAfter: max(rescueStuckJobsAfter, cfg.JobTimeout+outcomeTimeout),
		Queues:               queues,
		Workers:              workers,
		PeriodicJobs:         periodicJobs,
	}

	client, err := river.NewClient(riverdatabasesql.New(db), riverCfg)
	if err != nil {
		return nil, fmt.Errorf("outbox: river client: %w", err)
	}
	w.client = client
	// Jobs must not inherit a caller's deadline. Stop is what shuts the
	// client down; migrate above still uses ctx so a hung schema update
	// cannot hold the process forever.
	if err := client.Start(context.WithoutCancel(ctx)); err != nil {
		return nil, fmt.Errorf("outbox: river start: %w", err)
	}
	w.ready.Store(true)
	cfg.Logger.InfoContext(ctx, "outbox worker started",
		"drain_interval", cfg.DrainInterval,
		"claim_limit", cfg.ClaimLimit,
		"max_attempts", cfg.MaxAttempts,
		"max_workers", cfg.MaxWorkers,
		"queues", slices.Sorted(maps.Keys(queues)),
	)
	return w, nil
}

// hostedQueues narrows the queues the client knows to the ones named, or
// answers all of them when none is. A name the client knows no job for is
// refused rather than ignored: a producer on it would work nothing, and the
// queue that was meant would be left with no replica.
func hostedQueues(known map[string]river.QueueConfig, names []string) (map[string]river.QueueConfig, error) {
	if len(names) == 0 {
		return known, nil
	}
	hosted := make(map[string]river.QueueConfig, len(names))
	for _, name := range names {
		queue, ok := known[name]
		if !ok {
			return nil, fmt.Errorf("outbox: no job this process runs is on the %q queue", name)
		}
		hosted[name] = queue
	}
	return hosted, nil
}

// registerPeriodic adds every set's workers to the registry and folds its
// queues into the client's own, answering the schedules they are enqueued on.
//
// Two sets claiming one queue name is refused rather than merged: the later
// MaxWorkers would silently replace the earlier, leaving one set of jobs with a
// concurrency the other chose.
func registerPeriodic(workers *river.Workers, queues map[string]river.QueueConfig, registrars []PeriodicRegistrar) ([]*river.PeriodicJob, error) {
	var periodicJobs []*river.PeriodicJob
	for _, registrar := range registrars {
		if registrar == nil {
			continue
		}
		if err := registrar.Register(workers); err != nil {
			return nil, err
		}
		periodicJobs = append(periodicJobs, registrar.PeriodicJobs()...)
		for name, queue := range registrar.Queues() {
			if name == river.QueueDefault {
				return nil, fmt.Errorf("outbox: periodic jobs may not resize the %q queue", river.QueueDefault)
			}
			if _, taken := queues[name]; taken {
				return nil, fmt.Errorf("outbox: two sets of periodic jobs claim the %q queue", name)
			}
			queues[name] = queue
		}
	}
	return periodicJobs, nil
}

// Stop stops fetching new River jobs and waits for in-flight work. The jobs
// still running [stopCancelGrace] before ctx's deadline, or when ctx is done,
// have their contexts cancelled, so each records its attempt instead of
// leaving its river_job row running until the rescuer finds it. It is safe to
// call more than once.
func (w *Worker) Stop(ctx context.Context) error {
	if w == nil {
		return nil
	}
	w.stop.Do(func() {
		w.ready.Store(false)
		if w.client == nil {
			return
		}
		w.stopErr = w.stopClient(ctx)
	})
	return w.stopErr
}

func (w *Worker) stopClient(ctx context.Context) error {
	soft := ctx
	if deadline, ok := ctx.Deadline(); ok {
		var cancel context.CancelFunc
		soft, cancel = context.WithDeadline(ctx, deadline.Add(-stopCancelGrace))
		defer cancel()
	}
	if err := w.client.Stop(soft); err == nil {
		return nil
	}
	return w.client.StopAndCancel(ctx)
}

// DrainArgs is the periodic job that claims due outbox rows and enqueues
// a process job for each.
type DrainArgs struct{}

func (DrainArgs) Kind() string { return kindDrain }

func (DrainArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{
		MaxAttempts: 3,
		UniqueOpts:  uniqueInFlight(),
	}
}

type drainWorker struct {
	river.WorkerDefaults[DrainArgs]
	worker *Worker
}

func (d *drainWorker) Timeout(*river.Job[DrainArgs]) time.Duration { return defaultJobTimeout }

func (d *drainWorker) Work(ctx context.Context, _ *river.Job[DrainArgs]) error {
	return d.worker.drain(ctx)
}

// ProcessArgs is one claimed outbox row.
type ProcessArgs struct {
	EventID uuid.UUID `json:"event_id" river:"unique"`
}

func (ProcessArgs) Kind() string { return kindProcess }

func (ProcessArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{
		MaxAttempts: 5,
		UniqueOpts: river.UniqueOpts{
			ByArgs:  true,
			ByState: uniqueInFlightStates(),
		},
	}
}

type processWorker struct {
	river.WorkerDefaults[ProcessArgs]
	worker *Worker
}

func (p *processWorker) Timeout(*river.Job[ProcessArgs]) time.Duration {
	return p.worker.cfg.JobTimeout
}

func (p *processWorker) Work(ctx context.Context, job *river.Job[ProcessArgs]) error {
	return p.worker.process(ctx, job.Args.EventID)
}

func uniqueInFlight() river.UniqueOpts {
	return river.UniqueOpts{ByState: uniqueInFlightStates()}
}

func uniqueInFlightStates() []rivertype.JobState {
	return []rivertype.JobState{
		rivertype.JobStateAvailable,
		rivertype.JobStatePending,
		rivertype.JobStateRunning,
		rivertype.JobStateRetryable,
		rivertype.JobStateScheduled,
	}
}

func (w *Worker) drain(ctx context.Context) error {
	ctx, span := tracer().Start(ctx, "outbox.drain")
	defer span.End()

	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "begin")
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	qtx := w.queries.WithTx(tx)

	var reclaimed []dbmodels.OutboxEvent
	if w.cfg.StaleProcessing > 0 {
		reclaimed, err = w.recoverStale(ctx, qtx)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "recover")
			return err
		}
	}

	events, err := qtx.ClaimPendingOutboxEvents(ctx, w.cfg.ClaimLimit)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "claim")
		return err
	}
	if len(events) == 0 {
		if err := tx.Commit(); err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "commit")
			return err
		}
		w.reportReclaimed(ctx, reclaimed)
		return nil
	}

	enqueued := make([]dbmodels.OutboxEvent, 0, len(events))
	for _, event := range events {
		res, insErr := w.client.InsertTx(ctx, tx, ProcessArgs{EventID: event.ID}, nil)
		if insErr != nil {
			span.RecordError(insErr)
			span.SetStatus(codes.Error, "enqueue")
			return insErr
		}
		if res.UniqueSkippedAsDuplicate {
			// A process job is still running for this event. The row
			// must not stay processing: that job may already have
			// moved it to pending, and a second claim would strand it.
			if _, uerr := qtx.UnclaimOutboxEvent(ctx, event.ID); uerr != nil && !errors.Is(uerr, sql.ErrNoRows) {
				span.RecordError(uerr)
				span.SetStatus(codes.Error, "unclaim")
				return uerr
			}
			w.cfg.Logger.InfoContext(ctx, "deferred outbox event; process job already in flight",
				"event_id", event.ID,
				"event_type", event.EventType,
			)
			continue
		}
		enqueued = append(enqueued, event)
	}
	if err := tx.Commit(); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "commit")
		return err
	}

	w.reportReclaimed(ctx, reclaimed)
	for _, event := range enqueued {
		w.metrics.recordClaimed(ctx, event.EventType)
		attrs := []any{
			"event_id", event.ID,
			"event_type", event.EventType,
			"idempotency_key", event.IdempotencyKey,
			"attempts", event.Attempts,
		}
		if event.TenantID.Valid {
			attrs = append(attrs, "tenant_id", event.TenantID.UUID)
		}
		w.cfg.Logger.InfoContext(ctx, "claimed outbox event", attrs...)
	}
	span.SetAttributes(attribute.Int("outbox.claimed", len(enqueued)))
	return nil
}

// recoverStale re-queues the rows a worker left in processing, charging each
// the attempt nothing recorded: a worker that dies on every attempt records no
// failure, and without the charge its event would be re-queued for ever and
// never reach dead. The reclaim that exhausts an event's retry budget marks it
// dead, and for an auth-mail event strips the token, which bounds the
// plaintext window at the budget times StaleProcessing.
func (w *Worker) recoverStale(ctx context.Context, qtx *dbmodels.Queries) ([]dbmodels.OutboxEvent, error) {
	staleBefore := time.Now().UTC().Add(-w.cfg.StaleProcessing)
	budgets, err := json.Marshal(w.cfg.Handlers.attemptBudgets())
	if err != nil {
		return nil, fmt.Errorf("outbox: encode retry budgets: %w", err)
	}
	return qtx.RecoverStaleProcessingOutboxEvents(ctx, dbmodels.RecoverStaleProcessingOutboxEventsParams{
		Budgets:     budgets,
		MaxAttempts: int32(w.cfg.MaxAttempts),
		LastError: sql.NullString{
			String: fmt.Sprintf("reclaimed from processing after a stall of at least %s", w.cfg.StaleProcessing),
			Valid:  true,
		},
		StaleBefore: staleBefore,
	})
}

// reportReclaimed logs the rows the reclaim charged and counts the ones it
// killed. It runs after the drain transaction commits, so a rolled-back drain
// does not report deaths that never happened.
func (w *Worker) reportReclaimed(ctx context.Context, reclaimed []dbmodels.OutboxEvent) {
	for _, event := range reclaimed {
		attrs := []any{
			"event_id", event.ID,
			"event_type", event.EventType,
			"idempotency_key", event.IdempotencyKey,
			"attempts", event.Attempts,
		}
		if event.Status != StatusDead {
			w.cfg.Logger.InfoContext(ctx, "recovered stale processing outbox event", attrs...)
			continue
		}
		w.metrics.recordDead(ctx, event.EventType)
		w.cfg.Logger.ErrorContext(ctx, "outbox event dead; stale reclaim exhausted the retry budget", attrs...)
	}
}

func (w *Worker) process(ctx context.Context, eventID uuid.UUID) error {
	ctx, span := tracer().Start(ctx, "outbox.process")
	defer span.End()
	span.SetAttributes(attribute.String("outbox.event_id", eventID.String()))

	event, err := w.queries.GetOutboxEvent(ctx, eventID)
	if errors.Is(err, sql.ErrNoRows) {
		w.cfg.Logger.WarnContext(ctx, "outbox event missing; skipping", "event_id", eventID)
		return nil
	}
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "load")
		return err
	}
	span.SetAttributes(attribute.String("outbox.event_type", event.EventType))

	switch event.Status {
	case StatusDone, StatusDead:
		return nil
	case StatusPending:
		return nil
	case StatusProcessing:
	default:
		w.cfg.Logger.WarnContext(ctx, "outbox event in unexpected status; skipping",
			"event_id", event.ID,
			"status", event.Status,
		)
		return nil
	}

	handler, ok := w.cfg.Handlers.Lookup(event.EventType)
	if !ok {
		return w.deferUnknown(ctx, event)
	}
	if w.cfg.Handlers.IsMessage(event.EventType) {
		suspended, err := w.tenantSuspended(ctx, event)
		if err != nil {
			return w.finishFailed(ctx, event, err)
		}
		if suspended {
			return w.finishDropped(ctx, event)
		}
	}

	started := time.Now()
	herr := w.runHandler(ctx, handler, event)
	w.metrics.recordHandlerDuration(ctx, event.EventType, time.Since(started))
	if herr != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		herr = fmt.Errorf("handler ran past the %s job timeout: %w", w.cfg.JobTimeout, herr)
	}
	if errors.Is(herr, ErrResume) {
		return w.resume(ctx, event)
	}
	if IsBlocked(herr) {
		return w.deferBlocked(ctx, event, herr)
	}
	if herr != nil {
		return w.finishFailed(ctx, event, herr)
	}
	return w.finishDone(ctx, span, event)
}

// runHandler runs handler, answering a panic as the error of an ordinary failed
// attempt. Left to River, the panic would fail the job without the outbox row
// recording anything, and an event whose handler always panics would never
// spend its retry budget.
func (w *Worker) runHandler(ctx context.Context, handler Handler, event dbmodels.OutboxEvent) (err error) {
	defer func() {
		recovered := recover()
		if recovered == nil {
			return
		}
		w.cfg.Logger.ErrorContext(ctx, "outbox handler panicked",
			"event_id", event.ID,
			"event_type", event.EventType,
			"idempotency_key", event.IdempotencyKey,
			"panic", recovered,
			"stack", string(debug.Stack()),
		)
		err = fmt.Errorf("handler panicked: %v", recovered)
	}()
	return handler(ctx, event)
}

// outcomeContext answers the context the write recording an attempt's outcome
// runs with. River cancels the job's context once the job timeout passes, and
// an outcome written with it would fail, leaving the row in processing with no
// attempt charged.
func outcomeContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), outcomeTimeout)
}

func (w *Worker) finishDone(ctx context.Context, span trace.Span, event dbmodels.OutboxEvent) error {
	ctx, cancel := outcomeContext(ctx)
	defer cancel()
	if _, err := w.queries.MarkOutboxEventDone(ctx, event.ID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		span.RecordError(err)
		span.SetStatus(codes.Error, "done")
		return err
	}
	w.metrics.recordDone(ctx, event.EventType)
	w.cfg.Logger.InfoContext(ctx, "outbox event done",
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
		"attempts", event.Attempts,
	)
	return nil
}

// tenantSuspended reports whether event belongs to a tenant that is
// suspended. An event with no tenant, or whose tenant is gone, is not: the
// handler decides what to do with it, as it did before suspension existed.
func (w *Worker) tenantSuspended(ctx context.Context, event dbmodels.OutboxEvent) (bool, error) {
	if !event.TenantID.Valid {
		return false, nil
	}
	tenant, err := w.queries.GetTenantByID(ctx, event.TenantID.UUID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read the event's tenant: %w", err)
	}
	return tenantstatus.IsSuspended(tenant), nil
}

// finishDropped marks a message to a suspended tenant's readers or staff done
// without sending it, which is what [Registry.RegisterMessage] promises.
func (w *Worker) finishDropped(ctx context.Context, event dbmodels.OutboxEvent) error {
	ctx, cancel := outcomeContext(ctx)
	defer cancel()
	if _, err := w.queries.MarkOutboxEventDone(ctx, event.ID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	w.metrics.recordDone(ctx, event.EventType)
	w.cfg.Logger.InfoContext(ctx, "outbox event dropped; its tenant is suspended",
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
		"tenant_id", event.TenantID.UUID,
	)
	return nil
}

func (w *Worker) resume(ctx context.Context, event dbmodels.OutboxEvent) error {
	ctx, cancel := outcomeContext(ctx)
	defer cancel()
	if _, err := w.queries.ResumeOutboxEvent(ctx, event.ID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	w.metrics.recordResumed(ctx, event.EventType)
	w.cfg.Logger.InfoContext(ctx, "outbox event resumed; the handler has more work",
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
	)
	return nil
}

// deferUnknown hands back an event whose type this worker has no handler for.
// While an upgrade runs the workers of two releases side by side, such a type
// is one only the newer release writes, and a worker of that release claims
// the event on a later drain; marking it dead here would lose the mail or the
// notification that worker was about to send. An event still unknown
// [unknownTypeWindow] after it was written has a type no running release
// handles, and dies as a permanent failure.
func (w *Worker) deferUnknown(ctx context.Context, event dbmodels.OutboxEvent) error {
	ctx, cancel := outcomeContext(ctx)
	defer cancel()
	unknown := fmt.Errorf("unknown outbox event type %q", event.EventType)
	if time.Since(event.CreatedAt) >= unknownTypeWindow {
		return w.finishFailed(ctx, event, Permanent(unknown))
	}

	wait := w.cfg.UnknownTypeWait
	if _, err := w.queries.DeferOutboxEvent(ctx, dbmodels.DeferOutboxEventParams{
		ID:          event.ID,
		AvailableAt: time.Now().UTC().Add(wait),
		LastError:   lastErrorValue(fmt.Errorf("%w; left for a worker that handles it", unknown)),
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	w.cfg.Logger.InfoContext(ctx, "outbox event of an unknown type left for a newer worker",
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
		"available_in", wait,
	)
	return nil
}

// deferBlocked hands back an event whose handler cannot go on until something
// outside the outbox changes, charging it no attempt: spending the retry budget
// on it would mark it dead minutes into an outage nobody had yet noticed.
func (w *Worker) deferBlocked(ctx context.Context, event dbmodels.OutboxEvent, herr error) error {
	ctx, cancel := outcomeContext(ctx)
	defer cancel()
	wait := w.cfg.BlockedWait
	if _, err := w.queries.DeferOutboxEvent(ctx, dbmodels.DeferOutboxEventParams{
		ID:          event.ID,
		AvailableAt: time.Now().UTC().Add(wait),
		LastError:   lastErrorValue(herr),
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	w.cfg.Logger.WarnContext(ctx, "outbox event blocked; it waits without spending an attempt",
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
		"error", herr,
		"available_in", wait,
	)
	return nil
}

func (w *Worker) finishFailed(ctx context.Context, event dbmodels.OutboxEvent, herr error) error {
	ctx, cancel := outcomeContext(ctx)
	defer cancel()
	nextAttempts := event.Attempts + 1
	lastErr := lastErrorValue(herr)
	logAttrs := []any{
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
		"attempts", nextAttempts,
		"error", herr,
	}

	if IsPermanent(herr) || int(nextAttempts) >= w.cfg.Handlers.MaxAttempts(event.EventType, w.cfg.MaxAttempts) {
		if _, err := w.queries.MarkOutboxEventDead(ctx, dbmodels.MarkOutboxEventDeadParams{
			ID:        event.ID,
			LastError: lastErr,
		}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}
		w.metrics.recordDead(ctx, event.EventType)
		w.cfg.Logger.ErrorContext(ctx, "outbox event dead", logAttrs...)
		return nil
	}

	delay := w.cfg.RetryDelay(int(nextAttempts))
	if _, err := w.queries.MarkOutboxEventRetry(ctx, dbmodels.MarkOutboxEventRetryParams{
		ID:          event.ID,
		AvailableAt: time.Now().UTC().Add(delay),
		LastError:   lastErr,
	}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	w.metrics.recordRetry(ctx, event.EventType)
	w.cfg.Logger.WarnContext(ctx, "outbox event retry scheduled", append(logAttrs, "available_in", delay)...)
	return nil
}

func lastErrorValue(err error) sql.NullString {
	if err == nil {
		return sql.NullString{}
	}
	msg := err.Error()
	if len(msg) > maxLastErrorBytes {
		msg = msg[:maxLastErrorBytes]
	}
	return sql.NullString{String: msg, Valid: true}
}
