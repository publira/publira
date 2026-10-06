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

type catalogIndexCall struct {
	tenantID uuid.UUID
	kind     string
	id       uuid.UUID
}

type stubCatalogIndexer struct {
	calls []catalogIndexCall
	// searched is what Sync reports: whether the write went into the index the
	// search answers from.
	searched bool
	err      error
}

func (s *stubCatalogIndexer) Sync(_ context.Context, tenantID uuid.UUID, kind string, id uuid.UUID) (bool, error) {
	s.calls = append(s.calls, catalogIndexCall{tenantID: tenantID, kind: kind, id: id})
	if s.err != nil {
		return false, s.err
	}
	return s.searched, nil
}

type cacheRecordCall struct {
	tenantID uuid.UUID
	tags     []string
}

type stubCacheRecorder struct {
	calls []cacheRecordCall
	err   error
}

func (s *stubCacheRecorder) RevalidateTags(_ context.Context, tenantID uuid.UUID, tags []string) error {
	s.calls = append(s.calls, cacheRecordCall{tenantID: tenantID, tags: tags})
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

	err := NewCatalogIndexSyncHandler(indexer, &stubCacheRecorder{})(context.Background(), catalogIndexSyncEvent(t, CatalogIndexSyncPayload{
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

// A search sent between the write that queued the event and the document
// landing is cached under tags that write already dropped, so the handler
// owes the tag of the search over the kind it wrote.
func TestCatalogIndexSyncHandlerRecordsTheSearchCacheDropOnceTheSearchCanFindTheDocument(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	for kind, tag := range map[string]string{
		"series":  "tenant:" + tenantID.String() + ":series:list",
		"creator": "tenant:" + tenantID.String() + ":creators",
		"label":   "tenant:" + tenantID.String() + ":labels",
	} {
		t.Run(kind, func(t *testing.T) {
			recorder := &stubCacheRecorder{}
			err := NewCatalogIndexSyncHandler(&stubCatalogIndexer{searched: true}, recorder)(context.Background(), catalogIndexSyncEvent(t, CatalogIndexSyncPayload{
				TenantID: tenantID.String(),
				Kind:     kind,
				ID:       uuid.Must(uuid.NewV7()).String(),
			}))
			if err != nil {
				t.Fatalf("handler error = %v", err)
			}
			if len(recorder.calls) != 1 || recorder.calls[0].tenantID != tenantID || !slices.Equal(recorder.calls[0].tags, []string{tag}) {
				t.Fatalf("recorded %v, want %s for tenant %s", recorder.calls, tag, tenantID)
			}
		})
	}
}

// The search still answers from the SQL engine, which read the committed rows
// and was dropped by the write itself, or the only write went into an index
// being built: either way no search was answered from what changed.
func TestCatalogIndexSyncHandlerOwesNoDropForAnIndexTheSearchDoesNotAnswerFrom(t *testing.T) {
	recorder := &stubCacheRecorder{}
	err := NewCatalogIndexSyncHandler(&stubCatalogIndexer{searched: false}, recorder)(context.Background(), catalogIndexSyncEvent(t, CatalogIndexSyncPayload{
		TenantID: uuid.Must(uuid.NewV7()).String(),
		Kind:     "series",
		ID:       uuid.Must(uuid.NewV7()).String(),
	}))
	if err != nil {
		t.Fatalf("handler error = %v", err)
	}
	if len(recorder.calls) != 0 {
		t.Fatalf("recorded %v, want nothing", recorder.calls)
	}
}

// A worker started without revalidation drops nothing on any path, and the
// document is still written.
func TestCatalogIndexSyncHandlerWritesWithoutARecorder(t *testing.T) {
	indexer := &stubCatalogIndexer{searched: true}
	err := NewCatalogIndexSyncHandler(indexer, nil)(context.Background(), catalogIndexSyncEvent(t, CatalogIndexSyncPayload{
		TenantID: uuid.Must(uuid.NewV7()).String(),
		Kind:     "label",
		ID:       uuid.Must(uuid.NewV7()).String(),
	}))
	if err != nil {
		t.Fatalf("handler error = %v", err)
	}
	if len(indexer.calls) != 1 {
		t.Fatalf("synced %v, want one call", indexer.calls)
	}
}

// A drop that could not be recorded is still owed, so the event is retried.
func TestCatalogIndexSyncHandlerRetriesWhenTheDropCannotBeRecorded(t *testing.T) {
	recorder := &stubCacheRecorder{err: errors.New("the database is unreachable")}
	err := NewCatalogIndexSyncHandler(&stubCatalogIndexer{searched: true}, recorder)(context.Background(), catalogIndexSyncEvent(t, CatalogIndexSyncPayload{
		TenantID: uuid.Must(uuid.NewV7()).String(),
		Kind:     "series",
		ID:       uuid.Must(uuid.NewV7()).String(),
	}))
	if err == nil || IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retryable error", err)
	}
}

// The SQL backend keeps no index, so a worker on it has nothing to write and
// every event is done as it is claimed.
func TestCatalogIndexSyncHandlerIsDoneAtOnceWithoutAnIndex(t *testing.T) {
	recorder := &stubCacheRecorder{}
	if err := NewCatalogIndexSyncHandler(nil, recorder)(context.Background(), catalogIndexSyncEvent(t, map[string]any{})); err != nil {
		t.Fatalf("handler error = %v, want nil", err)
	}
	if len(recorder.calls) != 0 {
		t.Fatalf("recorded %v, want nothing", recorder.calls)
	}
}

// An engine that does not answer is transient: the document is still owed.
func TestCatalogIndexSyncHandlerRetriesWhenTheEngineFails(t *testing.T) {
	indexer := &stubCatalogIndexer{err: errors.New("opensearch is unreachable")}
	recorder := &stubCacheRecorder{}

	err := NewCatalogIndexSyncHandler(indexer, recorder)(context.Background(), catalogIndexSyncEvent(t, CatalogIndexSyncPayload{
		TenantID: uuid.Must(uuid.NewV7()).String(),
		Kind:     "creator",
		ID:       uuid.Must(uuid.NewV7()).String(),
	}))
	if err == nil || IsPermanent(err) {
		t.Fatalf("handler error = %v, want a retryable error", err)
	}
	if len(recorder.calls) != 0 {
		t.Fatalf("recorded %v before the document was written", recorder.calls)
	}
}

func TestCatalogIndexSyncHandlerDropsAPayloadItCannotRead(t *testing.T) {
	for _, payload := range []any{
		CatalogIndexSyncPayload{TenantID: "not-a-uuid", Kind: "series", ID: uuid.Must(uuid.NewV7()).String()},
		CatalogIndexSyncPayload{TenantID: uuid.Must(uuid.NewV7()).String(), Kind: "series", ID: "not-a-uuid"},
		[]string{"not", "an", "object"},
	} {
		indexer := &stubCatalogIndexer{}
		err := NewCatalogIndexSyncHandler(indexer, &stubCacheRecorder{})(context.Background(), catalogIndexSyncEvent(t, payload))
		if !IsPermanent(err) {
			t.Fatalf("handler error for %v = %v, want a permanent error", payload, err)
		}
		if len(indexer.calls) != 0 {
			t.Fatalf("synced %v for an unreadable payload", indexer.calls)
		}
	}
}
