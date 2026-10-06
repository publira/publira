package outbox

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// EventTypeCatalogIndexSync names one catalog row whose search document a
// write left stale. It is queued in the transaction of that write, so the
// search engine hears of every committed change and of none that rolled back.
const EventTypeCatalogIndexSync = "catalog_index_sync"

// CatalogIndexSyncPayload is the JSON body of the event. It names the row and
// not what became of it: the handler reads the row when the event drains and
// writes the document, or a tombstone in its place, from what it finds. A verdict fixed when
// the event was queued would be wrong whenever two events for one row drain
// out of order.
type CatalogIndexSyncPayload struct {
	TenantID string `json:"tenant_id"`
	// Kind is "series", "creator", or "label".
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// CatalogIndexSyncIdempotencyKey keys one event. Each write queues its own,
// because an event already drained for the row says nothing about this write.
func CatalogIndexSyncIdempotencyKey(eventID uuid.UUID) string {
	return EventTypeCatalogIndexSync + ":" + eventID.String()
}

// CatalogIndexer rewrites the search document of one catalog row from the row.
// platformsearch.Indexer satisfies it, and taking the interface is what lets
// the packages that queue these events import this one.
type CatalogIndexer interface {
	// Sync reports whether it wrote into the index the public search answers
	// from, and does so only once a search can find what it wrote.
	Sync(ctx context.Context, tenantID uuid.UUID, kind string, id uuid.UUID) (searched bool, err error)
}

// CacheInvalidationRecorder records the cache tags a tenant's change left
// stale, for the next_cache_revalidation handler to send. *revalidate.Requester
// satisfies it, and taking the interface is what lets that package, which
// produces those events, import this one.
type CacheInvalidationRecorder interface {
	RevalidateTags(ctx context.Context, tenantID uuid.UUID, tags []string) error
}

// catalogSearchCacheTags names the tag web-host holds the public search of
// kind under. A search answers documents of one kind, and a document changes
// only through an event naming its kind, so that kind's tag reaches every
// search the event can have changed. The other tags a search carries answer
// for what the database tells it, and the writes that change it drop them.
func catalogSearchCacheTags(tenantID uuid.UUID, kind string) []string {
	switch kind {
	case "series":
		return []string{fmt.Sprintf("tenant:%s:series:list", tenantID)}
	case "creator":
		return []string{fmt.Sprintf("tenant:%s:creators", tenantID)}
	case "label":
		return []string{fmt.Sprintf("tenant:%s:labels", tenantID)}
	default:
		return nil
	}
}

// NewCatalogIndexSyncHandler writes the documents the events name, and then
// drops the storefront's cached searches over them.
//
// A nil indexer is a worker with no index to write to: every event is done as
// soon as it is claimed. The worker passes one that resolves the platform's
// search engine for each event and has nothing to write on the SQL engine,
// which keeps no index; a move to an engine that does is built from the
// database rather than from these events.
//
// The drop is owed because the change that queued the event dropped the same
// tags when it committed, before the document was written: a search sent in
// between is answered from the index as it was and cached under tags nothing
// drops again. It is recorded rather than sent, the way every caller inside
// the worker records one, and a write into an index the search does not answer
// from, or none at all, owes nothing. A nil recorder is a worker with
// revalidation turned off, which drops nothing on any path.
func NewCatalogIndexSyncHandler(indexer CatalogIndexer, recorder CacheInvalidationRecorder) Handler {
	if indexer == nil {
		return func(context.Context, dbmodels.OutboxEvent) error { return nil }
	}
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		var payload CatalogIndexSyncPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode catalog index sync payload: %w", err))
		}
		tenantID, err := uuid.Parse(payload.TenantID)
		if err != nil {
			return Permanent(fmt.Errorf("catalog index sync payload tenant_id: %w", err))
		}
		id, err := uuid.Parse(payload.ID)
		if err != nil {
			return Permanent(fmt.Errorf("catalog index sync payload id: %w", err))
		}
		searched, err := indexer.Sync(ctx, tenantID, payload.Kind, id)
		if err != nil {
			return fmt.Errorf("sync the catalog index for %s %s: %w", payload.Kind, id, err)
		}
		if !searched || recorder == nil {
			return nil
		}
		// A failure retries the event, which writes the document again from
		// the row, and the version keeps that write from going backwards.
		if err := recorder.RevalidateTags(ctx, tenantID, catalogSearchCacheTags(tenantID, payload.Kind)); err != nil {
			return fmt.Errorf("record the search cache drop for %s %s: %w", payload.Kind, id, err)
		}
		return nil
	}
}
