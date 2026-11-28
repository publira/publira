package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// EventTypeNextCacheRevalidation carries the Next.js cache tags one write left
// stale. The drop is recorded in the same transaction as that write, so a web
// app that is down and a producer that dies before it could send them both end
// in a retry rather than in a reader served the previous answer.
const EventTypeNextCacheRevalidation = "next_cache_revalidation"

// NextCacheRevalidationPayload is the JSON body of the event. The tags already
// name what they invalidate; the tenant rides along because the table's check
// constraint holds every tenant event's payload to the row it belongs to.
type NextCacheRevalidationPayload struct {
	TenantID string   `json:"tenant_id"`
	Tags     []string `json:"tags"`
}

// CacheInvalidator sends cache tags to the web apps. *revalidate.Client
// satisfies it, and taking the interface is what lets the package that produces
// these events import this one.
type CacheInvalidator interface {
	RevalidateTags(ctx context.Context, tags []string) error
}

// NewNextCacheRevalidationHandler drops the tags an event names.
//
// A nil invalidator completes every event without sending it. A worker
// started without PUBLIRA_REVALIDATE_TOKEN belongs to an install with
// revalidation turned off, whose web apps refuse every drop and keep their
// entries until they expire, so there is nobody to send one to. The events
// arrive anyway, because revalidate.RecordDeferred cannot tell whether
// revalidation is on and records either way; left waiting, they would pile up
// for as long as the install runs.
func NewNextCacheRevalidationHandler(invalidator CacheInvalidator) Handler {
	if invalidator == nil {
		return func(context.Context, dbmodels.OutboxEvent) error {
			return nil
		}
	}
	return func(ctx context.Context, event dbmodels.OutboxEvent) error {
		var payload NextCacheRevalidationPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return Permanent(fmt.Errorf("decode next cache revalidation payload: %w", err))
		}
		if len(payload.Tags) == 0 {
			return Permanent(errors.New("next cache revalidation payload names no tags"))
		}
		if err := invalidator.RevalidateTags(ctx, payload.Tags); err != nil {
			return fmt.Errorf("revalidate next cache tags: %w", err)
		}
		return nil
	}
}
