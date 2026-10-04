package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

type catalogIndexCall struct {
	tenantID uuid.UUID
	kind     string
	id       uuid.UUID
}

type stubCatalogIndexer struct {
	calls []catalogIndexCall
	err   error
}

func (s *stubCatalogIndexer) Sync(_ context.Context, tenantID uuid.UUID, kind string, id uuid.UUID) error {
	s.calls = append(s.calls, catalogIndexCall{tenantID: tenantID, kind: kind, id: id})
	return s.err
}

func catalogIndexSyncEvent(t *testing.T, payload any) dbmodels.OutboxEvent {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return dbmodels.OutboxEvent{ID: uuid.Must(uuid.NewV7()), EventType: EventTypeCatalogIndexSync, Payload: encoded}
}

func TestCatalogIndexSyncHandlerSyncsTheRowTheEventNames(t *testing.T) {
	indexer := &stubCatalogIndexer{}
	tenantID := uuid.Must(uuid.NewV7())
	seriesID := uuid.Must(uuid.NewV7())

	err := NewCatalogIndexSyncHandler(indexer)(context.Background(), catalogIndexSyncEvent(t, CatalogIndexSyncPayload{
		TenantID: tenantID.String(),
		Kind:     "series",
		ID:       seriesID.String(),
	}))
	if err != nil {
		t.Fatalf("handler error = %v", err)
	}
	want := catalogIndexCall{tenantID: tenantID, kind: "series", id: seriesID}
	if len(indexer.calls) != 1 || indexer.calls[0] != want {
		t.Fatalf("synced %v, want one call with %v", indexer.calls, want)
	}
}

// The SQL backend keeps no index, so a worker on it has nothing to write and
// every event is done as it is claimed.
func TestCatalogIndexSyncHandlerIsDoneAtOnceWithoutAnIndex(t *testing.T) {
	if err := NewCatalogIndexSyncHandler(nil)(context.Background(), catalogIndexSyncEvent(t, map[string]any{})); err != nil {
		t.Fatalf("handler error = %v, want nil", err)
	}
}

// An engine that does not answer is transient: the document is still owed.
func TestCatalogIndexSyncHandlerRetriesWhenTheEngineFails(t *testing.T) {
	indexer := &stubCatalogIndexer{err: errors.New("opensearch is unreachable")}

	err := NewCatalogIndexSyncHandler(indexer)(context.Background(), catalogIndexSyncEvent(t, CatalogIndexSyncPayload{
		TenantID: uuid.Must(uuid.NewV7()).String(),
		Kind:     "creator",
		ID:       uuid.Must(uuid.NewV7()).String(),
	}))
	if err == nil || IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retryable error", err)
	}
}

func TestCatalogIndexSyncHandlerDropsAPayloadItCannotRead(t *testing.T) {
	for _, payload := range []any{
		CatalogIndexSyncPayload{TenantID: "not-a-uuid", Kind: "series", ID: uuid.Must(uuid.NewV7()).String()},
		CatalogIndexSyncPayload{TenantID: uuid.Must(uuid.NewV7()).String(), Kind: "series", ID: "not-a-uuid"},
		[]string{"not", "an", "object"},
	} {
		indexer := &stubCatalogIndexer{}
		err := NewCatalogIndexSyncHandler(indexer)(context.Background(), catalogIndexSyncEvent(t, payload))
		if !IsPermanent(err) {
			t.Fatalf("handler error for %v = %v, want a permanent error", payload, err)
		}
		if len(indexer.calls) != 0 {
			t.Fatalf("synced %v for an unreadable payload", indexer.calls)
		}
	}
}
