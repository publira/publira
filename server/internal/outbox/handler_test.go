package outbox

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestHandleTestEvent(t *testing.T) {
	t.Parallel()

	tenantID := uuid.Must(uuid.NewV7())
	cases := []struct {
		name     string
		payload  TestPayload
		attempts int32
		wantErr  bool
	}{
		{name: "success", payload: TestPayload{TenantID: tenantID.String()}},
		{name: "forced fail", payload: TestPayload{TenantID: tenantID.String(), Fail: true}, wantErr: true},
		{
			name:     "fail until attempt still failing",
			payload:  TestPayload{TenantID: tenantID.String(), FailUntilAttempt: 2},
			attempts: 1,
			wantErr:  true,
		},
		{
			name:     "fail until attempt then success",
			payload:  TestPayload{TenantID: tenantID.String(), FailUntilAttempt: 2},
			attempts: 2,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			body, err := json.Marshal(tc.payload)
			if err != nil {
				t.Fatal(err)
			}
			err = HandleTestEvent(t.Context(), dbmodels.OutboxEvent{
				EventType: EventTypeTest,
				Payload:   body,
				Attempts:  tc.attempts,
			})
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("HandleTestEvent: %v", err)
			}
		})
	}

	t.Run("invalid json is permanent", func(t *testing.T) {
		t.Parallel()
		err := HandleTestEvent(t.Context(), dbmodels.OutboxEvent{
			EventType: EventTypeTest,
			Payload:   json.RawMessage(`{`),
		})
		if !IsPermanent(err) {
			t.Fatalf("error = %v, want permanent", err)
		}
	})
}

func TestRegistryLookup(t *testing.T) {
	t.Parallel()

	r := DefaultRegistry()
	h, ok := r.Lookup(EventTypeTest)
	if !ok || h == nil {
		t.Fatal("default registry missing outbox_test")
	}
	if _, ok := r.Lookup("unknown.event"); ok {
		t.Fatal("unknown event looked up")
	}
	if _, ok := (*Registry)(nil).Lookup(EventTypeTest); ok {
		t.Fatal("nil registry looked up")
	}
}
