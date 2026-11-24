package outbox

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantwebhooks"
)

// DeadEvents names the dead events an operator lists or requeues. A zero
// field matches every event.
type DeadEvents struct {
	ID        uuid.UUID
	EventType string
	TenantID  uuid.UUID
}

// Any reports whether the filter names anything, rather than every dead
// event.
func (f DeadEvents) Any() bool {
	return f.ID != uuid.Nil || f.EventType != "" || f.TenantID != uuid.Nil
}

// Requeue refusals for a filter that names one event by its ID.
var (
	ErrEventNotFound = errors.New("no outbox event has that ID")
	ErrEventNotDead  = errors.New("the outbox event is not dead")
)

// StaysDeadError is a dead event of a type [RequeueDead] leaves dead.
type StaysDeadError struct {
	EventType string
}

func (e *StaysDeadError) Error() string {
	if e.EventType == tenantwebhooks.OutboxEventType {
		return "a dead webhook_delivery stays dead: a Tenant admin resends the delivery from the console"
	}
	return fmt.Sprintf("a dead %s stays dead: the token or the form it carried was dropped when it died, so there is nothing left to send", e.EventType)
}

// ListDead answers up to limit dead events the filter names, newest first.
func ListDead(ctx context.Context, q dbmodels.Querier, filter DeadEvents, limit int32) ([]dbmodels.ListDeadOutboxEventsRow, error) {
	rows, err := q.ListDeadOutboxEvents(ctx, dbmodels.ListDeadOutboxEventsParams{
		ID:        nullUUID(filter.ID),
		EventType: nullString(filter.EventType),
		TenantID:  nullUUID(filter.TenantID),
		Limit:     limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list dead outbox events: %w", err)
	}
	return rows, nil
}

// RequeueDead returns the dead events the filter names to pending, each due at
// once and on the whole retry budget, and answers them. It is for an operator
// who has fixed what killed them: the worker never revives a dead event on its
// own.
//
// Two kinds stay dead, and are skipped: the auth mail and the form requests,
// whose payload lost what they would send when they died, and a webhook
// delivery, which a Tenant admin resends from the console. A filter that names
// one event by its ID and requeues nothing answers why, as [ErrEventNotFound],
// [ErrEventNotDead], or a [StaysDeadError].
func RequeueDead(ctx context.Context, q dbmodels.Querier, filter DeadEvents) ([]dbmodels.OutboxEvent, error) {
	requeued, err := q.RequeueDeadOutboxEvents(ctx, dbmodels.RequeueDeadOutboxEventsParams{
		ID:        nullUUID(filter.ID),
		EventType: nullString(filter.EventType),
		TenantID:  nullUUID(filter.TenantID),
	})
	if err != nil {
		return nil, fmt.Errorf("requeue dead outbox events: %w", err)
	}
	if len(requeued) > 0 || filter.ID == uuid.Nil {
		return requeued, nil
	}
	event, err := q.GetOutboxEvent(ctx, filter.ID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return nil, ErrEventNotFound
	case err != nil:
		return nil, fmt.Errorf("read the outbox event: %w", err)
	case event.Status != StatusDead:
		return nil, fmt.Errorf("%w: it is %s", ErrEventNotDead, event.Status)
	case filter.EventType != "" && event.EventType != filter.EventType,
		filter.TenantID != uuid.Nil && event.TenantID.UUID != filter.TenantID:
		return nil, nil
	default:
		return nil, &StaysDeadError{EventType: event.EventType}
	}
}

func nullUUID(id uuid.UUID) uuid.NullUUID {
	return uuid.NullUUID{UUID: id, Valid: id != uuid.Nil}
}

func nullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}
