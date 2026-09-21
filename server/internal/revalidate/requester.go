package revalidate

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/tenantconn"
)

// defaultSendTimeout bounds one immediate attempt. [Client] already gives each
// request five seconds and posts to the three apps in parallel; the rest of the
// budget is the connection the completion is written on.
const defaultSendTimeout = 15 * time.Second

// OutboxQuerier is the one statement recording an invalidation needs.
// *dbmodels.Queries satisfies it, and so does one bound to a transaction.
type OutboxQuerier interface {
	InsertOutboxEvent(ctx context.Context, arg dbmodels.InsertOutboxEventParams) (dbmodels.OutboxEvent, error)
}

// Owed is an invalidation that is recorded and not yet sent. The zero value is
// nothing owed, so a caller that could not record one may still pass it to
// [Requester.Send].
type Owed struct {
	eventID  uuid.UUID
	tenantID uuid.UUID
	tags     []string
}

// Requester records an owed cache invalidation before anything tries to send
// it, and is what every writer of tenant data goes through.
//
// The record is an outbox event, written through the caller's own querier so a
// handler inside a transaction commits the debt with the write it answers for.
// Nothing after that point can lose the drop: a web app that is down, a process
// that dies before it could post, and a request the client gave up on all leave
// the row behind for the outbox worker to retry.
//
// The immediate attempt on top of it is an optimization, not the guarantee. It
// runs detached from the caller so a hung app cannot reach a console save, and
// marks the row done when it succeeds so the worker does not send the same tags
// again.
type Requester struct {
	client  *Client
	queries OutboxQuerier
	db      *sql.DB
	logger  *slog.Logger
	timeout time.Duration
}

// RequesterConfig is what a process gives its requester once at startup.
type RequesterConfig struct {
	// Client sends the tags. A nil client means revalidation is turned off for
	// this process, and [NewRequester] then answers with a nil requester whose
	// methods do nothing.
	Client *Client
	// Queries records an invalidation for a caller that holds no transaction.
	Queries OutboxQuerier
	// DB is the tenant-scoped pool the immediate attempt marks a sent
	// invalidation done on. A requester without one records the invalidation
	// and leaves the sending to the outbox worker, which is what a job running
	// inside that worker's own process wants: an attempt it could not mark done
	// would only be sent twice.
	DB      *sql.DB
	Logger  *slog.Logger
	Timeout time.Duration
}

// NewRequester returns nil when revalidation is turned off, so the guard a
// caller already has around a nil client keeps working. Every method is
// nil-safe besides.
func NewRequester(cfg RequesterConfig) *Requester {
	if cfg.Client == nil {
		return nil
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = defaultSendTimeout
	}
	return &Requester{
		client:  cfg.Client,
		queries: cfg.Queries,
		db:      cfg.DB,
		logger:  cfg.Logger,
		timeout: cfg.Timeout,
	}
}

// RevalidateTags records tags as owed by tenantID and sends them. It is what a
// caller whose write is already committed calls; a caller that holds the write
// in a transaction records inside it with [Requester.Record] and sends after
// the commit instead.
func (r *Requester) RevalidateTags(ctx context.Context, tenantID uuid.UUID, tags []string) error {
	owed, err := r.Record(ctx, nil, tenantID, tags)
	if err != nil {
		return err
	}
	r.Send(ctx, owed)
	return nil
}

// Record writes tags down as owed by tenantID. q is the querier of the write
// the invalidation answers for, so a handler inside a transaction passes the
// transaction's own and a rollback takes the record with it; nil uses the
// requester's own querier.
func (r *Requester) Record(
	ctx context.Context,
	q OutboxQuerier,
	tenantID uuid.UUID,
	tags []string,
) (Owed, error) {
	if r == nil {
		return Owed{}, nil
	}
	normalizedTags := normalizeTags(tags)
	if len(normalizedTags) == 0 {
		return Owed{}, nil
	}
	if q == nil {
		q = r.queries
	}
	if q == nil {
		return Owed{}, errors.New("revalidate: no querier to record a cache invalidation with")
	}
	// The row is written on a tenant-scoped connection, where the RLS policy
	// compares tenant_id against the tenant that connection is bound to.
	if tenantID == uuid.Nil {
		return Owed{}, errors.New("revalidate: a cache invalidation needs the tenant it belongs to")
	}

	payload, err := json.Marshal(outbox.NextCacheRevalidationPayload{
		TenantID: tenantID.String(),
		Tags:     normalizedTags,
	})
	if err != nil {
		return Owed{}, fmt.Errorf("encode cache invalidation payload: %w", err)
	}
	eventID, err := uuid.NewV7()
	if err != nil {
		return Owed{}, fmt.Errorf("allocate cache invalidation event id: %w", err)
	}
	// Each invalidation is owed on its own: two writes leaving the same tags
	// stale are two debts, and collapsing them onto one key would drop the
	// second whenever the first is still pending.
	event, err := q.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             eventID,
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeNextCacheRevalidation,
		Payload:        payload,
		IdempotencyKey: outbox.EventTypeNextCacheRevalidation + ":" + eventID.String(),
		AvailableAt:    time.Now().UTC(),
	})
	if err != nil {
		return Owed{}, fmt.Errorf("record cache invalidation: %w", err)
	}
	return Owed{eventID: event.ID, tenantID: tenantID, tags: normalizedTags}, nil
}

// Send attempts owed now and returns straight away. The attempt runs on a
// context of its own, so neither the caller's deadline nor a client that hung
// up reaches it and no caller waits on a web app. Call it once the write the
// invalidation answers for has committed.
func (r *Requester) Send(ctx context.Context, owed Owed) {
	if r == nil || owed.eventID == uuid.Nil || r.db == nil {
		return
	}
	// Values — the trace the write belongs to above all — are carried into the
	// attempt; cancellation is not.
	sendCtx := context.WithoutCancel(ctx)
	go func() {
		sendCtx, cancel := context.WithTimeout(sendCtx, r.timeout)
		defer cancel()

		if err := r.client.RevalidateTags(sendCtx, owed.tags); err != nil {
			r.logger.WarnContext(sendCtx, "next revalidate failed; the outbox worker will retry it",
				"event_id", owed.eventID.String(),
				"tenant_id", owed.tenantID.String(),
				"tags", owed.tags,
				"error", err,
			)
			return
		}
		r.complete(sendCtx, owed)
	}()
}

// complete marks a sent invalidation done so the worker does not send the same
// tags again. It takes a tenant-scoped connection of its own because the
// request's was released when the handler returned, and the RLS policy hides
// the row from a pool connection that names no tenant.
func (r *Requester) complete(ctx context.Context, owed Owed) {
	conn, release, err := tenantconn.Acquire(ctx, r.db, owed.tenantID, r.logger)
	if err != nil {
		r.logger.WarnContext(ctx, "failed to acquire a connection to complete a cache invalidation",
			"event_id", owed.eventID.String(),
			"tenant_id", owed.tenantID.String(),
			"error", err,
		)
		return
	}
	defer release()

	// No row means the worker claimed it first, which costs the tags one
	// redundant drop and nothing else.
	if _, err := dbmodels.New(conn).MarkPendingOutboxEventDone(ctx, owed.eventID); err != nil &&
		!errors.Is(err, sql.ErrNoRows) {
		r.logger.WarnContext(ctx, "failed to complete a sent cache invalidation",
			"event_id", owed.eventID.String(),
			"tenant_id", owed.tenantID.String(),
			"error", err,
		)
	}
}
