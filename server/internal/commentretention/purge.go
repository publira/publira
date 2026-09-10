package commentretention

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// DefaultPurgeChunkSize bounds one DELETE statement. Every chunk is its own
// transaction, so the value trades how long a single statement holds locks and
// how much WAL it writes against how many round trips a full purge costs. It
// sits below the content_events chunk because deleting a comment cascades into
// the reports filed on it.
const DefaultPurgeChunkSize = 1000

// purgeQuerier is the generated set of queries one purge run needs.
type purgeQuerier interface {
	CountWithdrawnEpisodeCommentsBefore(ctx context.Context, arg dbmodels.CountWithdrawnEpisodeCommentsBeforeParams) (int64, error)
	PurgeWithdrawnEpisodeComments(ctx context.Context, arg dbmodels.PurgeWithdrawnEpisodeCommentsParams) (int64, error)
}

// Purger deletes the comments whose authors withdrew them longer ago than the
// retention window allows, and with each one the reports filed on it, which the
// foreign key from episode_comment_reports takes along.
//
// A comment staff removed is not its business: 'hidden' is the record of a
// moderation decision, and it is kept whatever its age.
//
// Its database connection must use a role with BYPASSRLS (or be a superuser),
// because one run spans every tenant.
type Purger struct {
	db      *sql.DB
	queries purgeQuerier
}

// PurgeOptions describes one purge run.
type PurgeOptions struct {
	// Cutoff is exclusive: a comment withdrawn before it has outlived the
	// window. A scheduled run passes the current time minus WithdrawnDays.
	Cutoff time.Time
	// ChunkSize is the row limit of a single DELETE. Zero means
	// DefaultPurgeChunkSize. It is int32 because it becomes a PostgreSQL
	// LIMIT: a wider type would let a caller wrap into a negative limit that
	// the database rejects.
	ChunkSize int32
	// DryRun counts the expired comments and deletes nothing.
	DryRun bool
}

// PurgeResult describes what one purge run did. Every count covers the tenants
// the run actually finished: each chunk commits on its own, so on an error the
// counts describe the work that survived rather than the work that was tried.
type PurgeResult struct {
	// TenantCount is the number of tenants the run drained.
	TenantCount int
	// RowCount is the number of comments deleted, or — in a dry run — the
	// number that would have been.
	RowCount int64
	// ChunkCount is how many DELETE statements ran. Outside a dry run it is at
	// least one per tenant, because every tenant is probed for expired rows.
	ChunkCount int
	// DryRun repeats PurgeOptions.DryRun so callers can log a single struct.
	DryRun bool
}

// NewPurger constructs a Purger backed by db.
func NewPurger(db *sql.DB) *Purger {
	if db == nil {
		return &Purger{}
	}
	return &Purger{db: db, queries: dbmodels.New(db)}
}

// Run deletes every comment withdrawn before opts.Cutoff, one tenant at a time,
// in chunks of opts.ChunkSize. Each chunk commits on its own: a cancelled or
// timed-out run keeps the chunks it already finished, and the next run resumes
// from there, which is also why running it again after it has caught up deletes
// nothing.
//
// One tenant's failure does not stop the others. A lock timeout on a busy
// tenant would otherwise leave every tenant sorted after it holding comments
// their authors deleted, until someone noticed the job had been failing. The
// run finishes what it can and returns every failure together, so the exit
// status still reports the run as failed.
func (p *Purger) Run(ctx context.Context, opts PurgeOptions) (PurgeResult, error) {
	if p == nil || p.db == nil {
		return PurgeResult{}, errors.New("withdrawn comment purge requires a database")
	}
	if opts.Cutoff.IsZero() {
		return PurgeResult{}, errors.New("withdrawn comment purge requires a cutoff")
	}
	chunkSize := opts.ChunkSize
	if chunkSize <= 0 {
		chunkSize = DefaultPurgeChunkSize
	}
	if err := p.requireBypassRLS(ctx); err != nil {
		return PurgeResult{}, err
	}

	tenantIDs, err := p.listTenantIDs(ctx)
	if err != nil {
		return PurgeResult{}, fmt.Errorf("list tenants: %w", err)
	}

	result := PurgeResult{DryRun: opts.DryRun}
	var failures []error
	for _, tenantID := range tenantIDs {
		rows, chunks, err := p.purgeTenant(ctx, tenantID, opts.Cutoff, chunkSize, opts.DryRun)
		result.RowCount += rows
		result.ChunkCount += chunks
		if err != nil {
			failures = append(failures, fmt.Errorf("purge withdrawn comments of tenant %s: %w", tenantID, err))
			// A cancelled context fails every remaining tenant the same way,
			// so there is nothing left to salvage by carrying on.
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
	chunkSize int32,
	dryRun bool,
) (rowCount int64, chunkCount int, err error) {
	if dryRun {
		candidates, err := p.queries.CountWithdrawnEpisodeCommentsBefore(ctx, dbmodels.CountWithdrawnEpisodeCommentsBeforeParams{
			TenantID: tenantID,
			Cutoff:   cutoff,
		})
		if err != nil {
			return 0, 0, fmt.Errorf("count expired comments: %w", err)
		}
		return candidates, 0, nil
	}

	for {
		deleted, err := p.queries.PurgeWithdrawnEpisodeComments(ctx, dbmodels.PurgeWithdrawnEpisodeCommentsParams{
			TenantID: tenantID,
			Cutoff:   cutoff,
			Limit:    chunkSize,
		})
		if err != nil {
			return rowCount, chunkCount, fmt.Errorf("delete expired comments: %w", err)
		}
		rowCount += deleted
		chunkCount++
		// A short chunk means the scan hit the end of the expired range. This
		// tenant is done; anything an author withdraws next belongs to a run
		// a window from now.
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
		return errors.New("withdrawn comment purge requires a database role with BYPASSRLS")
	}
	return nil
}
