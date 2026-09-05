package outbox

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverdatabasesql"
	"github.com/riverqueue/river/rivertype"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
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
	maxLastErrorBytes      = 2048
)

var tracer = otel.Tracer("github.com/publira/publira/server/internal/outbox")

// Config tunes the resident worker. Zero values become the defaults of
// 2s drain, 10 attempts, and 15m stale reclaim.
type Config struct {
	Logger *slog.Logger
	// Handlers maps event_type to work. Nil becomes [DefaultRegistry].
	Handlers *Registry
	// DrainInterval is how often the leader enqueues an outbox.drain job.
	DrainInterval time.Duration
	// ClaimLimit is the maximum number of pending rows one drain claims.
	ClaimLimit int32
	// MaxAttempts is the outbox retry budget. The attempt that reaches
	// this count marks the row dead.
	MaxAttempts int
	// StaleProcessing re-queues processing rows whose updated_at is older
	// than this. Zero uses the 15m default. A negative duration disables
	// reclaim.
	StaleProcessing time.Duration
	// MaxWorkers is River's default-queue concurrency.
	MaxWorkers int
	// RetryDelay waits after a failed attempt. Nil uses [RetryDelay].
	RetryDelay func(attempts int) time.Duration
	// FetchCooldown / FetchPollInterval are forwarded to River so tests
	// can pick jobs up without waiting on the production 1s poll.
	FetchCooldown     time.Duration
	FetchPollInterval time.Duration
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

	riverCfg := &river.Config{
		Logger:            cfg.Logger,
		MaxAttempts:       5,
		FetchCooldown:     cfg.FetchCooldown,
		FetchPollInterval: cfg.FetchPollInterval,
		Queues: map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: cfg.MaxWorkers},
		},
		Workers: workers,
		PeriodicJobs: []*river.PeriodicJob{
			river.NewPeriodicJob(
				river.PeriodicInterval(cfg.DrainInterval),
				func() (river.JobArgs, *river.InsertOpts) {
					return DrainArgs{}, nil
				},
				&river.PeriodicJobOpts{RunOnStart: true},
			),
		},
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
	)
	return w, nil
}

// Stop stops fetching new River jobs and waits for in-flight work. It is
// safe to call more than once.
func (w *Worker) Stop(ctx context.Context) error {
	if w == nil {
		return nil
	}
	w.stop.Do(func() {
		w.ready.Store(false)
		if w.client == nil {
			return
		}
		w.stopErr = w.client.Stop(ctx)
	})
	return w.stopErr
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

func (p *processWorker) Timeout(*river.Job[ProcessArgs]) time.Duration { return defaultJobTimeout }

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
	ctx, span := tracer.Start(ctx, "outbox.drain")
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

// recoverStale re-queues rows a dead worker left in processing and returns the
// auth-mail rows it touched. Those go through their own statement: a crash
// records no failure, so without charging the reclaim to the retry budget an
// event whose worker dies on every attempt would keep its raw token in payload
// for as long as the crash loop lasts. The reclaim that exhausts MaxAttempts
// marks the row dead and strips the token, which bounds the plaintext window at
// MaxAttempts times StaleProcessing.
func (w *Worker) recoverStale(ctx context.Context, qtx *dbmodels.Queries) ([]dbmodels.OutboxEvent, error) {
	staleBefore := time.Now().UTC().Add(-w.cfg.StaleProcessing)

	recovered, err := qtx.RecoverStaleProcessingOutboxEvents(ctx, staleBefore)
	if err != nil {
		return nil, err
	}
	if len(recovered) > 0 {
		w.cfg.Logger.InfoContext(ctx, "recovered stale processing outbox events",
			"count", len(recovered),
			"stale_before", staleBefore,
		)
	}

	authMail, err := qtx.RecoverStaleProcessingAuthMailOutboxEvents(ctx, dbmodels.RecoverStaleProcessingAuthMailOutboxEventsParams{
		MaxAttempts: int32(w.cfg.MaxAttempts),
		LastError: sql.NullString{
			String: fmt.Sprintf("reclaimed from processing after a stall of at least %s", w.cfg.StaleProcessing),
			Valid:  true,
		},
		StaleBefore: staleBefore,
	})
	if err != nil {
		return nil, err
	}
	return authMail, nil
}

// reportReclaimed logs the auth-mail rows the reclaim charged and counts the
// ones it killed. It runs after the drain transaction commits, so a rolled-back
// drain does not report deaths that never happened.
func (w *Worker) reportReclaimed(ctx context.Context, reclaimed []dbmodels.OutboxEvent) {
	for _, event := range reclaimed {
		attrs := []any{
			"event_id", event.ID,
			"event_type", event.EventType,
			"idempotency_key", event.IdempotencyKey,
			"attempts", event.Attempts,
		}
		if event.Status != StatusDead {
			w.cfg.Logger.InfoContext(ctx, "recovered stale processing auth mail outbox event", attrs...)
			continue
		}
		w.metrics.recordDead(ctx, event.EventType)
		w.cfg.Logger.ErrorContext(ctx, "outbox event dead; stale reclaim exhausted the retry budget", attrs...)
	}
}

func (w *Worker) process(ctx context.Context, eventID uuid.UUID) error {
	ctx, span := tracer.Start(ctx, "outbox.process")
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
		return w.finishFailed(ctx, event, Permanent(fmt.Errorf("unknown outbox event type %q", event.EventType)))
	}

	started := time.Now()
	herr := handler(ctx, event)
	w.metrics.recordHandlerDuration(ctx, event.EventType, time.Since(started))
	if herr != nil {
		return w.finishFailed(ctx, event, herr)
	}

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

func (w *Worker) finishFailed(ctx context.Context, event dbmodels.OutboxEvent, herr error) error {
	nextAttempts := event.Attempts + 1
	lastErr := lastErrorValue(herr)
	logAttrs := []any{
		"event_id", event.ID,
		"event_type", event.EventType,
		"idempotency_key", event.IdempotencyKey,
		"attempts", nextAttempts,
		"error", herr,
	}

	if IsPermanent(herr) || int(nextAttempts) >= w.cfg.MaxAttempts {
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
