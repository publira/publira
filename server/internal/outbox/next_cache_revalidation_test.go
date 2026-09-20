package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

type stubCacheInvalidator struct {
	calls [][]string
	err   error
}

func (s *stubCacheInvalidator) RevalidateTags(_ context.Context, tags []string) error {
	s.calls = append(s.calls, tags)
	return s.err
}

func revalidationEvent(t *testing.T, payload NextCacheRevalidationPayload) dbmodels.OutboxEvent {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:        uuid.Must(uuid.NewV7()),
		EventType: EventTypeNextCacheRevalidation,
		Payload:   encoded,
	}
}

func TestNextCacheRevalidationHandlerDropsTheTagsTheEventNames(t *testing.T) {
	invalidator := &stubCacheInvalidator{}
	tags := []string{"tenant:t:site", "tenant:t:pages"}

	err := NewNextCacheRevalidationHandler(invalidator)(
		context.Background(),
		revalidationEvent(t, NextCacheRevalidationPayload{TenantID: uuid.Nil.String(), Tags: tags}),
	)
	if err != nil {
		t.Fatalf("handler error = %v", err)
	}
	if len(invalidator.calls) != 1 || !slices.Equal(invalidator.calls[0], tags) {
		t.Fatalf("revalidated %v, want one call with %v", invalidator.calls, tags)
	}
}

// A web app that is down is a transient failure: the drop is still owed, so the
// event has to come back rather than die.
func TestNextCacheRevalidationHandlerRetriesWhenAnAppIsUnreachable(t *testing.T) {
	invalidator := &stubCacheInvalidator{err: errors.New("web-host is unreachable")}

	err := NewNextCacheRevalidationHandler(invalidator)(
		context.Background(),
		revalidationEvent(t, NextCacheRevalidationPayload{Tags: []string{"tenant:t:site"}}),
	)
	if err == nil {
		t.Fatal("handler error = nil, want the send failure")
	}
	if IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable one", err)
	}
}

// A worker with no way to send cannot be retried out of, but an operator
// restarting it with a token can, so the event waits rather than dying.
func TestNextCacheRevalidationHandlerRetriesWhenTheWorkerCannotSend(t *testing.T) {
	err := NewNextCacheRevalidationHandler(nil)(
		context.Background(),
		revalidationEvent(t, NextCacheRevalidationPayload{Tags: []string{"tenant:t:site"}}),
	)
	if err == nil {
		t.Fatal("handler error = nil, want the missing client reported")
	}
	if IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retriable one", err)
	}
}

func TestNextCacheRevalidationHandlerKillsAnEventItCanNeverSend(t *testing.T) {
	invalidator := &stubCacheInvalidator{}
	handler := NewNextCacheRevalidationHandler(invalidator)

	tests := map[string]dbmodels.OutboxEvent{
		"a payload that is not the event's": {
			ID:        uuid.Must(uuid.NewV7()),
			EventType: EventTypeNextCacheRevalidation,
			Payload:   json.RawMessage(`{"tags":"every one of them"}`),
		},
		"a payload naming no tag": revalidationEvent(t, NextCacheRevalidationPayload{}),
	}
	for name, event := range tests {
		t.Run(name, func(t *testing.T) {
			err := handler(context.Background(), event)
			if !IsPermanent(err) {
				t.Fatalf("handler error = %v, want a permanent one", err)
			}
		})
	}
	if len(invalidator.calls) != 0 {
		t.Fatalf("revalidated %v, want nothing sent", invalidator.calls)
	}
}
