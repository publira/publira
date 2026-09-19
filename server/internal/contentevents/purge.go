// Package contentevents holds the parts of the raw engagement log that belong
// to no single caller: the projections that file an event from the table which
// owns the fact, and the retention that takes the rows away again.
// content_events is append-only and high volume, so the rows themselves are
// kept for a bounded window and the durable numbers live in the aggregates
// (content_daily_stats) built from them. Keeping the raw log short is also
// what keeps the personal data in it bounded.
//
// The shape is one table plus chunked deletes, which is the simplest thing
// that reclaims the space. Either of two observations is the trigger to
// reconsider it in favour of declarative partitioning by occurred_at, dropping
// a partition instead of deleting rows: one purge no longer fits in the cron
// interval (the elapsed time is in its completion log), or the table and its
// indexes outgrow what autovacuum keeps up with, since the bloat a delete
// leaves does not come back down on its own.
package contentevents

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/retention"
)

// DefaultChunkSize bounds one DELETE statement. Every chunk is its own
// transaction, so the value trades how long a single statement holds locks and
// how much WAL it writes against how many round trips a full purge costs.
const DefaultChunkSize = 10000

// Purger deletes content_events rows that fell out of their tenant's
// retention period. Its database connection must use a role with BYPASSRLS
// (or be a superuser), because one run spans every tenant.
type Purger struct {
	db *sql.DB
}

// Options describes one purge run.
type Options struct {
	// Now is the instant each tenant's cutoff is counted back from. Rows with
	// occurred_at before their tenant's cutoff are expired.
	Now time.Time
	// Retention answers each tenant's period.
	Retention retention.Table
	// ChunkSize is the row limit of a single DELETE. Zero means DefaultChunkSize.
	ChunkSize int
	// DryRun counts the expired rows and deletes nothing.
	DryRun bool
}

// Result describes what one purge run did. Every count covers the tenants the
// run actually finished: each chunk commits on its own, so on an error the
// counts describe the work that survived rather than the work that was tried.
type Result struct {
	// TenantCount is the number of tenants the run drained.
	TenantCount int
	// RowCount is the number of rows deleted, or — in a dry run — the number
	// of rows that would have been deleted.
	RowCount int64
	// ChunkCount is how many DELETE statements ran. Outside a dry run it is
	// at least one per tenant, because every tenant is probed for expired rows.
	ChunkCount int
	// DryRun repeats Options.DryRun so callers can log a single struct.
	DryRun bool
}

// New constructs a Purger backed by db.
func New(db *sql.DB) *Purger {
	return &Purger{db: db}
}

// Run deletes every content_events row older than its tenant's cutoff, one
// tenant at a time, in chunks of opts.ChunkSize. Each chunk commits on its
// own: a cancelled or timed-out run keeps the chunks it already finished, and
// the next run resumes from there.
//
// One tenant's failure does not stop the others; the run finishes what it can
// and returns every failure together, so the exit status still reports it.
func (p *Purger) Run(ctx context.Context, opts Options) (Result, error) {
	if p == nil || p.db == nil {
		return Result{}, errors.New("content events purge requires a database")
	}
	if opts.Now.IsZero() {
		return Result{}, errors.New("content events purge requires a current time")
	}
	chunkSize := opts.ChunkSize
	if chunkSize <= 0 {
		chunkSize = DefaultChunkSize
	}
	if err := p.requireBypassRLS(ctx); err != nil {
		return Result{}, err
	}

	tenantIDs, err := p.listTenantIDs(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("list tenants: %w", err)
	}

	result := Result{DryRun: opts.DryRun}
	var failures []error
	for _, tenantID := range tenantIDs {
		cutoff := opts.Retention.For(tenantID).ContentEventCutoff(opts.Now)
		rows, chunks, err := p.purgeTenant(ctx, tenantID, cutoff, chunkSize, opts.DryRun)
		result.RowCount += rows
		result.ChunkCount += chunks
		if err != nil {
			failures = append(failures, fmt.Errorf("purge content events of tenant %s: %w", tenantID, err))
			// A cancelled context fails every remaining tenant the same way.
			if ctx.Err() != nil {
				break
			}
			continue
		}
		result.TenantCount++
	}
	return result, errors.Join(failures...)
}

// purgeTenant drains one tenant, returning what it managed to delete even when
// a chunk fails: the chunks before it are already committed.
func (p *Purger) purgeTenant(
	ctx context.Context,
	tenantID uuid.UUID,
	cutoff time.Time,
	chunkSize int,
	dryRun bool,
) (rowCount int64, chunkCount int, err error) {
	if dryRun {
		candidates, err := p.countExpired(ctx, tenantID, cutoff)
		if err != nil {
			return 0, 0, fmt.Errorf("count expired events: %w", err)
		}
		return candidates, 0, nil
	}

	for {
		deleted, err := p.deleteChunk(ctx, tenantID, cutoff, chunkSize)
		if err != nil {
			return rowCount, chunkCount, fmt.Errorf("delete expired events: %w", err)
		}
		rowCount += deleted
		chunkCount++
		// A short chunk means the scan hit the end of the expired range, or
		// skipped rows a concurrent run had locked. Either way this tenant is
		// done; anything left over belongs to the next run.
		if deleted < int64(chunkSize) {
			return rowCount, chunkCount, nil
		}
		if err := ctx.Err(); err != nil {
			return rowCount, chunkCount, err
		}
	}
}

func (p *Purger) listTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := p.db.QueryContext(ctx, "SELECT id FROM tenants ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close() //nolint:errcheck

	var tenantIDs []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		tenantIDs = append(tenantIDs, id)
	}
	return tenantIDs, rows.Err()
}

func (p *Purger) requireBypassRLS(ctx context.Context) error {
	var bypasses bool
	err := p.db.QueryRowContext(ctx, `
		SELECT rolsuper OR rolbypassrls
		FROM pg_roles
		WHERE rolname = current_user
	`).Scan(&bypasses)
	if err != nil {
		return fmt.Errorf("check database role: %w", err)
	}
	if !bypasses {
		return errors.New("content events purge requires a database role with BYPASSRLS")
	}
	return nil
}

func (p *Purger) countExpired(ctx context.Context, tenantID uuid.UUID, cutoff time.Time) (int64, error) {
	var count int64
	err := p.db.QueryRowContext(ctx, `
		SELECT count(*) FROM content_events WHERE tenant_id = $1 AND occurred_at < $2
	`, tenantID, cutoff).Scan(&count)
	return count, err
}

func (p *Purger) deleteChunk(ctx context.Context, tenantID uuid.UUID, cutoff time.Time, chunkSize int) (int64, error) {
	deleted, err := p.db.ExecContext(ctx, deleteChunkSQL, tenantID, cutoff, chunkSize)
	if err != nil {
		return 0, err
	}
	return deleted.RowsAffected()
}

// deleteChunkSQL removes at most $3 rows of tenant $1 older than $2. The
// ordered subquery is what keeps a chunk bounded:
// idx_content_events_tenant_occurred_at hands back the tenant's oldest rows
// without scanning the table. SKIP LOCKED then keeps two overlapping runs from
// serializing on the same rows — whatever one run skips, the next one picks up.
const deleteChunkSQL = `
WITH expired AS (
	SELECT id
	FROM content_events
	WHERE tenant_id = $1
		AND occurred_at < $2
	ORDER BY occurred_at
	LIMIT $3
	FOR UPDATE SKIP LOCKED
)
DELETE FROM content_events ce
USING expired
WHERE ce.id = expired.id
`
