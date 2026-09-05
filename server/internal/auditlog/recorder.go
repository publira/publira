// Package auditlog provides structured audit logging for admin operations.
package auditlog

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantconn"
)

const (
	OutcomeSuccess = "success"
	OutcomeFailure = "failure"
)

// Querier is the minimal DB interface required by Recorder.
type Querier interface {
	InsertPlatformAuditLog(ctx context.Context, arg dbmodels.InsertPlatformAuditLogParams) error
	InsertAuditLog(ctx context.Context, arg dbmodels.InsertAuditLogParams) error
}

// PlatformEntry holds the data for a platform audit log event.
type PlatformEntry struct {
	ActorPlatformUserID uuid.UUID
	ActorRole           string
	Action              string
	TargetType          string // e.g. "series", "episode", "tenant", "operator", "user"
	TargetID            string // ID of the affected resource
	Outcome             string // "success" or "failure"
	Reason              string // populated on failure
	ClientIP            string
}

// TenantEntry holds the data for a tenant audit log event.
type TenantEntry struct {
	TenantID    uuid.UUID
	ActorUserID uuid.UUID
	ActorRole   string
	Action      string
	TargetType  string // e.g. "series", "episode", "creator", "label"
	TargetID    string // ID of the affected resource
	Outcome     string // "success" or "failure"
	Reason      string // why the action was taken, or why it failed
	ClientIP    string
}

// Recorder records structured audit log entries without affecting the caller's
// result. Implementations may persist entries synchronously or enqueue them
// for asynchronous persistence.
type Recorder interface {
	RecordPlatform(context.Context, PlatformEntry)
	RecordTenant(context.Context, TenantEntry)
}

// syncRecorder persists audit log entries directly to the supplied querier.
// It is retained for callers that need an in-process, synchronous recorder,
// including focused handler tests.
type syncRecorder struct {
	queries Querier
	logger  *slog.Logger
}

// New creates a Recorder using the given DB querier and logger.
func New(queries Querier, logger *slog.Logger) Recorder {
	if logger == nil {
		logger = slog.Default()
	}
	return &syncRecorder{queries: queries, logger: logger}
}

// RecordPlatform writes a platform audit entry. A DB error is logged but does not propagate.
func (r *syncRecorder) RecordPlatform(ctx context.Context, e PlatformEntry) {
	r.logger.InfoContext(ctx, "audit",
		"actor_platform_user_id", e.ActorPlatformUserID,
		"actor_role", e.ActorRole,
		"action", e.Action,
		"target_type", e.TargetType,
		"target_id", e.TargetID,
		"outcome", e.Outcome,
		"reason", e.Reason,
		"client_ip", e.ClientIP,
	)

	id, err := uuid.NewV7()
	if err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to generate id", "error", err)
		return
	}

	err = r.queries.InsertPlatformAuditLog(ctx, dbmodels.InsertPlatformAuditLogParams{
		ID:                  id,
		ActorPlatformUserID: e.ActorPlatformUserID,
		ActorRole:           e.ActorRole,
		Action:              e.Action,
		TargetType:          sql.NullString{String: e.TargetType, Valid: e.TargetType != ""},
		TargetID:            sql.NullString{String: e.TargetID, Valid: e.TargetID != ""},
		Outcome:             e.Outcome,
		Reason:              sql.NullString{String: e.Reason, Valid: e.Reason != ""},
		ClientIp:            sql.NullString{String: e.ClientIP, Valid: e.ClientIP != ""},
	})
	if err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to persist", "error", err, "action", e.Action)
	}
}

// logTenantEntry emits the structured line every tenant entry gets, whether or
// not the row behind it lands.
func logTenantEntry(ctx context.Context, logger *slog.Logger, e TenantEntry) {
	logger.InfoContext(ctx, "audit",
		"tenant_id", e.TenantID,
		"actor_user_id", e.ActorUserID,
		"actor_role", e.ActorRole,
		"action", e.Action,
		"target_type", e.TargetType,
		"target_id", e.TargetID,
		"outcome", e.Outcome,
		"reason", e.Reason,
		"client_ip", e.ClientIP,
	)
}

// tenantEntryParams is the row one tenant entry becomes.
func tenantEntryParams(e TenantEntry) (dbmodels.InsertAuditLogParams, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return dbmodels.InsertAuditLogParams{}, err
	}
	return dbmodels.InsertAuditLogParams{
		ID:          id,
		TenantID:    e.TenantID,
		ActorUserID: e.ActorUserID,
		ActorRole:   e.ActorRole,
		Action:      e.Action,
		TargetType:  sql.NullString{String: e.TargetType, Valid: e.TargetType != ""},
		TargetID:    sql.NullString{String: e.TargetID, Valid: e.TargetID != ""},
		Outcome:     e.Outcome,
		Reason:      sql.NullString{String: e.Reason, Valid: e.Reason != ""},
		ClientIp:    sql.NullString{String: e.ClientIP, Valid: e.ClientIP != ""},
	}, nil
}

// WriteTenant persists one tenant entry on the supplied querier and reports
// whether it landed.
//
// Recorder is best-effort by design: an audit write must never fail the action
// it describes. This is the opposite case — an action whose entry is the only
// record of what it destroyed. Passing a transaction's querier here commits the
// action and its entry together, so neither of the two survives alone.
func WriteTenant(ctx context.Context, queries Querier, logger *slog.Logger, e TenantEntry) error {
	if logger == nil {
		logger = slog.Default()
	}
	logTenantEntry(ctx, logger, e)

	params, err := tenantEntryParams(e)
	if err != nil {
		return err
	}
	return queries.InsertAuditLog(ctx, params)
}

// RecordTenant writes a tenant audit entry. A DB error is logged but does not propagate.
func (r *syncRecorder) RecordTenant(ctx context.Context, e TenantEntry) {
	if err := WriteTenant(ctx, r.queries, r.logger, e); err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to persist", "error", err, "action", e.Action)
	}
}

const (
	defaultAsyncQueueSize    = 1024
	defaultAsyncWriteTimeout = 3 * time.Second
	defaultAsyncMaxAttempts  = 3
	defaultAsyncRetryDelay   = 100 * time.Millisecond
)

// AsyncConfig controls the in-process queue and bounded retry behavior of an
// AsyncRecorder. Zero values use the production defaults.
type AsyncConfig struct {
	QueueSize    int
	WriteTimeout time.Duration
	MaxAttempts  int
	RetryDelay   time.Duration
}

// AsyncRecorder queues audit entries so request handlers do not wait for DB
// writes. Entries are best-effort: a full queue and exhausted retries drop the
// entry after emitting an error log.
//
// For tenant entries, tenantDB is used to acquire a new tenant-scoped
// connection for each write. This deliberately avoids retaining the request's
// RLS connection after its handler has returned. Passing nil keeps direct
// querier writes, which is useful for synchronous test doubles.
type AsyncRecorder struct {
	queries  Querier
	tenantDB *sql.DB
	logger   *slog.Logger
	config   AsyncConfig
	queue    chan queuedEntry
	metrics  *Metrics

	enqueueMu   sync.RWMutex
	queueClosed bool
	closeOnce   sync.Once
	abortOnce   sync.Once
	abort       context.CancelFunc
	abortCtx    context.Context
	workers     sync.WaitGroup
	done        chan struct{}
}

type queuedEntry struct {
	ctx      context.Context
	action   string
	kind     string
	platform *dbmodels.InsertPlatformAuditLogParams
	tenant   *dbmodels.InsertAuditLogParams
}

// NewAsync creates an asynchronously persisting Recorder with production
// queue, timeout, and retry defaults.
func NewAsync(queries Querier, tenantDB *sql.DB, logger *slog.Logger) *AsyncRecorder {
	return NewAsyncWithConfig(queries, tenantDB, logger, AsyncConfig{})
}

// NewAsyncWithConfig creates an asynchronously persisting Recorder with the
// supplied configuration. It starts one writer worker immediately.
func NewAsyncWithConfig(queries Querier, tenantDB *sql.DB, logger *slog.Logger, config AsyncConfig) *AsyncRecorder {
	if logger == nil {
		logger = slog.Default()
	}
	config = normalizeAsyncConfig(config)
	abortCtx, abort := context.WithCancel(context.Background())
	r := &AsyncRecorder{
		queries:  queries,
		tenantDB: tenantDB,
		logger:   logger,
		config:   config,
		queue:    make(chan queuedEntry, config.QueueSize),
		metrics:  newMetrics(),
		abort:    abort,
		abortCtx: abortCtx,
		done:     make(chan struct{}),
	}
	r.workers.Add(1)
	go r.run()
	return r
}

func normalizeAsyncConfig(config AsyncConfig) AsyncConfig {
	if config.QueueSize <= 0 {
		config.QueueSize = defaultAsyncQueueSize
	}
	if config.WriteTimeout <= 0 {
		config.WriteTimeout = defaultAsyncWriteTimeout
	}
	if config.MaxAttempts <= 0 {
		config.MaxAttempts = defaultAsyncMaxAttempts
	}
	if config.RetryDelay <= 0 {
		config.RetryDelay = defaultAsyncRetryDelay
	}
	return config
}

// Metrics returns the recorder's in-process counters. The same values are
// exported through OpenTelemetry when a MeterProvider is configured.
func (r *AsyncRecorder) Metrics() *Metrics {
	return r.metrics
}

// Close stops accepting entries and waits for queued writes to complete.
// Production processes should call Shutdown so their shutdown deadline is
// respected. Close remains useful for tests and callers with no deadline.
func (r *AsyncRecorder) Close() {
	_ = r.Shutdown(context.Background())
}

// Shutdown stops accepting entries and flushes queued writes before ctx
// expires. When the deadline is exceeded, the in-flight write is cancelled
// and queued entries are dropped so callers can continue shutting down.
func (r *AsyncRecorder) Shutdown(ctx context.Context) error {
	r.closeQueue()
	logger := r.logger.With("queue_depth", r.metrics.QueueDepth.Load())
	logger.Info("auditlog: draining queued entries")

	select {
	case <-r.done:
		logger.Info("auditlog: queue drained",
			"persisted", r.metrics.Persisted.Load(),
			"failed", r.metrics.Failed.Load(),
			"dropped", r.metrics.Dropped.Load(),
		)
		return nil
	case <-ctx.Done():
		r.abortOnce.Do(r.abort)
		logger.Warn("auditlog: shutdown drain timed out; cancelling pending writes",
			"queue_depth", r.metrics.QueueDepth.Load(),
			"in_flight", r.metrics.InFlight.Load(),
			"error", ctx.Err(),
		)
		return fmt.Errorf("auditlog: drain: %w", ctx.Err())
	}
}

func (r *AsyncRecorder) closeQueue() {
	r.closeOnce.Do(func() {
		r.enqueueMu.Lock()
		r.queueClosed = true
		close(r.queue)
		r.enqueueMu.Unlock()
	})
}

// RecordPlatform enqueues a platform audit entry without blocking on the DB.
func (r *AsyncRecorder) RecordPlatform(ctx context.Context, e PlatformEntry) {
	r.logger.InfoContext(ctx, "audit",
		"actor_platform_user_id", e.ActorPlatformUserID,
		"actor_role", e.ActorRole,
		"action", e.Action,
		"target_type", e.TargetType,
		"target_id", e.TargetID,
		"outcome", e.Outcome,
		"reason", e.Reason,
		"client_ip", e.ClientIP,
	)

	id, err := uuid.NewV7()
	if err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to generate id", "error", err)
		return
	}
	r.enqueue(queuedEntry{
		ctx:    ctx,
		action: e.Action,
		kind:   "platform",
		platform: &dbmodels.InsertPlatformAuditLogParams{
			ID:                  id,
			ActorPlatformUserID: e.ActorPlatformUserID,
			ActorRole:           e.ActorRole,
			Action:              e.Action,
			TargetType:          sql.NullString{String: e.TargetType, Valid: e.TargetType != ""},
			TargetID:            sql.NullString{String: e.TargetID, Valid: e.TargetID != ""},
			Outcome:             e.Outcome,
			Reason:              sql.NullString{String: e.Reason, Valid: e.Reason != ""},
			ClientIp:            sql.NullString{String: e.ClientIP, Valid: e.ClientIP != ""},
		},
	})
}

// RecordTenant enqueues a tenant audit entry without blocking on the DB.
func (r *AsyncRecorder) RecordTenant(ctx context.Context, e TenantEntry) {
	logTenantEntry(ctx, r.logger, e)

	params, err := tenantEntryParams(e)
	if err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to generate id", "error", err)
		return
	}
	r.enqueue(queuedEntry{
		ctx:    ctx,
		action: e.Action,
		kind:   "tenant",
		tenant: &params,
	})
}

func (r *AsyncRecorder) enqueue(entry queuedEntry) {
	r.enqueueMu.RLock()
	defer r.enqueueMu.RUnlock()
	if r.queueClosed {
		r.metrics.recordDropped(entry.kind, "shutdown")
		r.logger.WarnContext(entry.ctx, "auditlog: recorder is shutting down; dropping entry", "action", entry.action, "entry_type", entry.kind)
		return
	}

	r.metrics.QueueDepth.Add(1)
	select {
	case r.queue <- entry:
		r.metrics.recordEnqueued(entry.kind)
	default:
		r.metrics.QueueDepth.Add(-1)
		r.metrics.recordDropped(entry.kind, "queue_full")
		r.logger.ErrorContext(entry.ctx, "auditlog: queue is full; dropping entry", "action", entry.action, "entry_type", entry.kind)
	}
}

func (r *AsyncRecorder) run() {
	defer r.workers.Done()
	defer close(r.done)
	for entry := range r.queue {
		r.metrics.QueueDepth.Add(-1)
		select {
		case <-r.abortCtx.Done():
			r.metrics.recordDropped(entry.kind, "shutdown")
			continue
		default:
		}

		r.metrics.InFlight.Add(1)
		r.persist(entry)
		r.metrics.InFlight.Add(-1)
	}
}

func (r *AsyncRecorder) persist(entry queuedEntry) {
	for attempt := 1; attempt <= r.config.MaxAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(entry.ctx), r.config.WriteTimeout)
		stopCancel := context.AfterFunc(r.abortCtx, cancel)
		err := r.write(ctx, entry)
		stopCancel()
		cancel()
		if err == nil {
			r.metrics.recordPersisted(entry.kind)
			return
		}
		if r.abortCtx.Err() != nil {
			r.metrics.recordDropped(entry.kind, "shutdown")
			return
		}
		r.metrics.recordFailed(entry.kind)
		if attempt == r.config.MaxAttempts {
			r.metrics.recordDropped(entry.kind, "retry_exhausted")
			r.logger.ErrorContext(entry.ctx, "auditlog: failed to persist; dropping entry", "error", err, "action", entry.action, "entry_type", entry.kind, "attempts", attempt)
			return
		}
		r.logger.WarnContext(entry.ctx, "auditlog: failed to persist; retrying", "error", err, "action", entry.action, "entry_type", entry.kind, "attempt", attempt, "retry_delay", r.config.RetryDelay)
		timer := time.NewTimer(r.config.RetryDelay)
		select {
		case <-timer.C:
		case <-r.abortCtx.Done():
			timer.Stop()
			r.metrics.recordDropped(entry.kind, "shutdown")
			return
		}
	}
}

func (r *AsyncRecorder) write(ctx context.Context, entry queuedEntry) error {
	if entry.platform != nil {
		return r.queries.InsertPlatformAuditLog(ctx, *entry.platform)
	}
	if r.tenantDB == nil {
		return r.queries.InsertAuditLog(ctx, *entry.tenant)
	}

	conn, release, err := tenantconn.Acquire(ctx, r.tenantDB, entry.tenant.TenantID, r.logger)
	if err != nil {
		return err
	}
	defer release()
	return dbmodels.New(conn).InsertAuditLog(ctx, *entry.tenant)
}

// ClientIPFromHeader returns the first IP address from the X-Forwarded-For header.
func ClientIPFromHeader(headers http.Header) string {
	v := headers.Get("X-Forwarded-For")
	if v == "" {
		return ""
	}
	parts := strings.SplitN(v, ",", 2)
	return strings.TrimSpace(parts[0])
}
