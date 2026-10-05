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
// *catalogindex.Syncer satisfies it, and taking the interface is what lets that
// package, which queues these events, import this one.
type CatalogIndexer interface {
	Sync(ctx context.Context, tenantID uuid.UUID, kind string, id uuid.UUID) error
}

// NewCatalogIndexSyncHandler writes the documents the events name.
//
// A nil indexer is a worker with no index to write to: every event is done as
// soon as it is claimed. The worker passes one that resolves the platform's
// search engine for each event and has nothing to write on the SQL engine,
// which keeps no index; a move to an engine that does is built from the
// database rather than from these events. Pass the interface as nil rather
// than a nil *catalogindex.Syncer.
func NewCatalogIndexSyncHandler(indexer CatalogIndexer) Handler {
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
		if err := indexer.Sync(ctx, tenantID, payload.Kind, id); err != nil {
			return fmt.Errorf("sync the catalog index for %s %s: %w", payload.Kind, id, err)
		}
		return nil
	}
}
