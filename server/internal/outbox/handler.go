package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// EventTypeTest is the first-cut event the worker processes. Business
// emitters (invitation email and so on) register later; this kind exists so
// the queue, retries, and restart recovery can be tested without them.
const EventTypeTest = "outbox_test"

// Handler runs the side effect for one claimed outbox event. It must be
// safe to call more than once for the same idempotency_key: River and the
// outbox retries are at-least-once.
type Handler func(ctx context.Context, event dbmodels.OutboxEvent) error

// Permanent wraps err so the worker marks the event dead instead of
// retrying. Use it for unknown types and poison payloads, not for
// transient dependency failures.
func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return &permanentError{err: err}
}

// ErrResume is returned by a handler that has recorded its progress
// (RecordOutboxEventProgress) and has work left: the worker hands the event back
// as due without charging an attempt. Return it only after the cursor has moved,
// since nothing bounds how many times an event resumes.
var ErrResume = errors.New("outbox event has more work")

// IsPermanent reports whether err (or a value it unwraps to) was produced
// by [Permanent].
func IsPermanent(err error) bool {
	var target *permanentError
	return errors.As(err, &target)
}

type permanentError struct {
	err error
}

func (e *permanentError) Error() string {
	if e == nil || e.err == nil {
		return "permanent outbox error"
	}
	return e.err.Error()
}

func (e *permanentError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

// Registry maps event_type to a Handler. Lookups are safe for concurrent
// use after the worker has started; Register is meant for process setup.
type Registry struct {
	mu       sync.RWMutex
	handlers map[string]Handler
	// messages are the event types registered through RegisterMessage.
	messages map[string]bool
}

// NewRegistry returns an empty handler set.
func NewRegistry() *Registry {
	return &Registry{handlers: make(map[string]Handler), messages: make(map[string]bool)}
}

// DefaultRegistry registers the test event used by the worker's own
// tests. Invitation-email handlers land in a later issue.
func DefaultRegistry() *Registry {
	r := NewRegistry()
	r.Register(EventTypeTest, HandleTestEvent)
	return r
}

// Register installs handler for eventType, which the worker runs whatever
// state the event's tenant is in. A later call with the same type replaces the
// previous handler.
//
// That is the registration for work that keeps the tenant's own state and the
// outside world's in step — dropping a cache entry, updating the search index,
// settling a store purchase — for mail the platform operator sends while
// managing the tenant, and for a request a form recorded, which opens an
// account or issues a token before it queues its mail as an event of its own.
// Dropping such a request would lose a sign-up the API had already accepted;
// running it leaves only the mail it queues to be dropped. A handler that
// writes to the tenant's readers or staff is registered with
// [Registry.RegisterMessage] instead.
func (r *Registry) Register(eventType string, handler Handler) {
	r.register(eventType, handler, false)
}

// RegisterMessage installs handler for eventType, an event that sends mail or
// a push notification to a tenant's readers or staff. The worker marks such an
// event done without running it while its tenant is suspended: everything it
// links to is refused until the tenant is resumed, and holding it until then
// would deliver news that is no longer new and links whose tokens have
// expired.
func (r *Registry) RegisterMessage(eventType string, handler Handler) {
	r.register(eventType, handler, true)
}

func (r *Registry) register(eventType string, handler Handler, message bool) {
	if r == nil || eventType == "" || handler == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.handlers == nil {
		r.handlers = make(map[string]Handler)
	}
	if r.messages == nil {
		r.messages = make(map[string]bool)
	}
	r.handlers[eventType] = handler
	r.messages[eventType] = message
}

// Lookup returns the handler for eventType.
func (r *Registry) Lookup(eventType string) (Handler, bool) {
	if r == nil {
		return nil, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	h, ok := r.handlers[eventType]
	return h, ok
}

// IsMessage reports whether eventType was registered with
// [Registry.RegisterMessage].
func (r *Registry) IsMessage(eventType string) bool {
	if r == nil {
		return false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.messages[eventType]
}

// TestPayload is the JSON body of [EventTypeTest]. Tenant events still
// need tenant_id for the table check; the other fields drive the test
// handler.
type TestPayload struct {
	TenantID         string `json:"tenant_id,omitempty"`
	Fail             bool   `json:"fail,omitempty"`
	FailUntilAttempt int    `json:"fail_until_attempt,omitempty"`
}

// HandleTestEvent succeeds unless the payload asks it not to. Fail is a
// hard failure on every attempt. FailUntilAttempt fails while
// event.Attempts is below that value (the count of previous failures).
func HandleTestEvent(_ context.Context, event dbmodels.OutboxEvent) error {
	var payload TestPayload
	if len(event.Payload) > 0 {
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode outbox_test payload: %w", err))
		}
	}
	if payload.Fail {
		return errors.New("outbox_test forced failure")
	}
	if payload.FailUntilAttempt > 0 && int(event.Attempts) < payload.FailUntilAttempt {
		return fmt.Errorf("outbox_test failing until attempt %d (at %d)", payload.FailUntilAttempt, event.Attempts)
	}
	return nil
}
