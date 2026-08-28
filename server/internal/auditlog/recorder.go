// Package auditlog provides structured audit logging for admin operations.
package auditlog

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
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
	Reason      string // populated on failure
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

// RecordTenant writes a tenant audit entry. A DB error is logged but does not propagate.
func (r *syncRecorder) RecordTenant(ctx context.Context, e TenantEntry) {
	r.logger.InfoContext(ctx, "audit",
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

	id, err := uuid.NewV7()
	if err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to generate id", "error", err)
		return
	}

	err = r.queries.InsertAuditLog(ctx, dbmodels.InsertAuditLogParams{
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
	})
	if err != nil {
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
	queries   Querier
	tenantDB  *sql.DB
	logger    *slog.Logger
	config    AsyncConfig
	queue     chan queuedEntry
	closeOnce sync.Once
	workers   sync.WaitGroup
}

type queuedEntry struct {
	ctx      context.Context
	action   string
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
	r := &AsyncRecorder{
		queries:  queries,
		tenantDB: tenantDB,
		logger:   logger,
		config:   config,
		queue:    make(chan queuedEntry, config.QueueSize),
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

// Close stops accepting entries and waits for queued writes to complete. It is
// intended for tests today; graceful process shutdown and time-bounded flush
// are handled by the operational shutdown work.
func (r *AsyncRecorder) Close() {
	r.closeOnce.Do(func() {
		close(r.queue)
		r.workers.Wait()
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
	r.logger.InfoContext(ctx, "audit",
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

	id, err := uuid.NewV7()
	if err != nil {
		r.logger.ErrorContext(ctx, "auditlog: failed to generate id", "error", err)
		return
	}
	r.enqueue(queuedEntry{
		ctx:    ctx,
		action: e.Action,
		tenant: &dbmodels.InsertAuditLogParams{
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
		},
	})
}

func (r *AsyncRecorder) enqueue(entry queuedEntry) {
	select {
	case r.queue <- entry:
	default:
		r.logger.ErrorContext(entry.ctx, "auditlog: queue is full; dropping entry", "action", entry.action)
	}
}

func (r *AsyncRecorder) run() {
	defer r.workers.Done()
	for entry := range r.queue {
		r.persist(entry)
	}
}

func (r *AsyncRecorder) persist(entry queuedEntry) {
	for attempt := 1; attempt <= r.config.MaxAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(entry.ctx), r.config.WriteTimeout)
		err := r.write(ctx, entry)
		cancel()
		if err == nil {
			return
		}
		if attempt == r.config.MaxAttempts {
			r.logger.ErrorContext(entry.ctx, "auditlog: failed to persist; dropping entry", "error", err, "action", entry.action, "attempts", attempt)
			return
		}
		time.Sleep(r.config.RetryDelay)
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
