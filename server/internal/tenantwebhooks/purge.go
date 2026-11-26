package tenantwebhooks

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dbroles"
)

// DeliveryRetention is how long a delivery is kept once it is settled:
// delivered, or given up. A dead one stays resendable for as long, which is
// time for a Tenant admin to notice a receiver that was down and send again
// what it missed, and the console's list of deliveries reaches back as far.
// Past it, a delivery is kept for nobody: what it carried about a reader is
// the tenant's to keep in its own systems, not in the record of a send.
const DeliveryRetention = 30 * 24 * time.Hour

// DefaultPurgeChunkSize bounds one DELETE statement. Every chunk is its own
// transaction, so the value trades how long a single statement holds locks and
// how much WAL it writes against how many round trips a full purge costs. It
// is low because a dead delivery still carries the whole body it was to send.
const DefaultPurgeChunkSize = 1000

// purgeQuerier is the generated set of queries one purge run needs.
type purgeQuerier interface {
	CountSettledWebhookDeliveries(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteSettledWebhookDeliveries(ctx context.Context, arg dbmodels.DeleteSettledWebhookDeliveriesParams) (int64, error)
}

// Purger deletes the deliveries settled longer ago than [DeliveryRetention].
// A delivery still owed — pending, or failed with another attempt due — is
// not its business, whatever its age: the worker is still sending it.
//
// Its database connection must use a role that reaches every tenant, because
// one run spans every tenant: [dbroles.RequireEveryTenant] refuses any other.
type Purger struct {
	db      *sql.DB
	queries purgeQuerier
}

// PurgeOptions describes one purge run.
type PurgeOptions struct {
	// Now is the instant the cutoff is counted back from. A delivery settled
	// before Now minus [DeliveryRetention] is deleted.
	Now time.Time
	// ChunkSize is the row limit of a single DELETE. Zero means
	// DefaultPurgeChunkSize. It is int32 because it becomes a PostgreSQL
	// LIMIT: a wider type would let a caller wrap into a negative limit that
	// the database rejects.
	ChunkSize int32
	// DryRun counts the deliveries past the cutoff and deletes nothing.
	DryRun bool
}

// PurgeResult describes what one purge run did.
type PurgeResult struct {
	// Cutoff is the exclusive bound the run deleted below.
	Cutoff time.Time
	// RowCount is the number of deliveries deleted, or — in a dry run — the
	// number that would have been.
	RowCount int64
	// ChunkCount is how many DELETE statements ran. Outside a dry run it is at
	// least one, because a run always probes for settled deliveries.
	ChunkCount int
	// DryRun repeats PurgeOptions.DryRun so callers can log a single struct.
	DryRun bool
}

// NewPurger constructs a Purger backed by db.
func NewPurger(db *sql.DB) *Purger {
	return &Purger{db: db, queries: dbmodels.New(db)}
}

// Run deletes every delivery settled before opts.Now minus
// [DeliveryRetention], in chunks of opts.ChunkSize. Each chunk commits on its
// own: a cancelled or timed-out run keeps the chunks it already finished, and
// the next run resumes from there.
func (p *Purger) Run(ctx context.Context, opts PurgeOptions) (PurgeResult, error) {
	if p == nil || p.db == nil {
		return PurgeResult{}, errors.New("webhook delivery purge requires a database")
	}
	if opts.Now.IsZero() {
		return PurgeResult{}, errors.New("webhook delivery purge requires a current time")
	}
	chunkSize := opts.ChunkSize
	if chunkSize <= 0 {
		chunkSize = DefaultPurgeChunkSize
	}
	if err := dbroles.RequireEveryTenant(ctx, p.db, "webhook delivery purge"); err != nil {
		return PurgeResult{}, err
	}

	result := PurgeResult{Cutoff: opts.Now.UTC().Add(-DeliveryRetention), DryRun: opts.DryRun}
	if opts.DryRun {
		count, err := p.queries.CountSettledWebhookDeliveries(ctx, result.Cutoff)
		if err != nil {
			return PurgeResult{}, fmt.Errorf("count settled webhook deliveries: %w", err)
		}
		result.RowCount = count
		return result, nil
	}
	for {
		deleted, err := p.queries.DeleteSettledWebhookDeliveries(ctx, dbmodels.DeleteSettledWebhookDeliveriesParams{
			Cutoff:    result.Cutoff,
			ChunkSize: chunkSize,
		})
		if err != nil {
			return result, fmt.Errorf("delete settled webhook deliveries: %w", err)
		}
		result.RowCount += deleted
		result.ChunkCount++
		// A short chunk means the scan reached the end of what is past the
		// cutoff, or skipped deliveries a resend had locked. Either way the
		// run is done; anything left over belongs to the next one.
		if deleted < int64(chunkSize) {
			return result, nil
		}
		if err := ctx.Err(); err != nil {
			return result, err
		}
	}
}
