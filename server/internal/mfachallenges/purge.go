// Package mfachallenges holds the retention side of the spent admin MFA
// challenges. A row in user_mfa_used_challenges exists to refuse the second
// exchange of a challenge token, so it stops meaning anything the moment that
// token expires — five minutes after it was issued.
package mfachallenges

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// DefaultChunkSize bounds one DELETE statement. Every chunk is its own
// transaction, so the value trades how long a single statement holds locks and
// how much WAL it writes against how many round trips a full purge costs.
const DefaultChunkSize = 10000

// Purger deletes the spent challenges whose tokens have expired. Its database
// connection must use a role with BYPASSRLS (or be a superuser), because one
// run spans every tenant.
type Purger struct {
	db *sql.DB
}

// Options describes one purge run.
type Options struct {
	// Cutoff is exclusive: rows with expires_at < Cutoff are expired. A
	// scheduled run passes the current time — a spent challenge outlives its
	// token by nothing.
	Cutoff time.Time
	// ChunkSize is the row limit of a single DELETE. Zero means DefaultChunkSize.
	ChunkSize int
	// DryRun counts the expired rows and deletes nothing.
	DryRun bool
}

// Result describes what one purge run did.
type Result struct {
	// RowCount is the number of rows deleted, or — in a dry run — the number
	// of rows that would have been deleted.
	RowCount int64
	// ChunkCount is how many DELETE statements ran. Outside a dry run it is
	// at least one, because a run always probes for expired rows.
	ChunkCount int
	// DryRun repeats Options.DryRun so callers can log a single struct.
	DryRun bool
}

// New constructs a Purger backed by db.
func New(db *sql.DB) *Purger {
	return &Purger{db: db}
}

// Run deletes every spent challenge whose token expired before opts.Cutoff, in
// chunks of opts.ChunkSize. Each chunk commits on its own: a cancelled or
// timed-out run keeps the chunks it already finished, and the next run resumes
// from there.
func (p *Purger) Run(ctx context.Context, opts Options) (Result, error) {
	if p == nil || p.db == nil {
		return Result{}, errors.New("mfa challenge purge requires a database")
	}
	if opts.Cutoff.IsZero() {
		return Result{}, errors.New("mfa challenge purge requires a cutoff")
	}
	chunkSize := opts.ChunkSize
	if chunkSize <= 0 {
		chunkSize = DefaultChunkSize
	}
	if err := p.requireBypassRLS(ctx); err != nil {
		return Result{}, err
	}

	if opts.DryRun {
		candidates, err := p.countExpired(ctx, opts.Cutoff)
		if err != nil {
			return Result{}, fmt.Errorf("count expired challenges: %w", err)
		}
		return Result{RowCount: candidates, DryRun: true}, nil
	}

	var result Result
	for {
		deleted, err := p.deleteChunk(ctx, opts.Cutoff, chunkSize)
		if err != nil {
			return result, fmt.Errorf("delete expired challenges: %w", err)
		}
		result.RowCount += deleted
		result.ChunkCount++
		// A short chunk means the scan hit the end of the expired range, or
		// skipped rows a concurrent run had locked. Either way this run is
		// done; anything left over belongs to the next one.
		if deleted < int64(chunkSize) {
			return result, nil
		}
		if err := ctx.Err(); err != nil {
			return result, err
		}
	}
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
		return errors.New("mfa challenge purge requires a database role with BYPASSRLS")
	}
	return nil
}

func (p *Purger) countExpired(ctx context.Context, cutoff time.Time) (int64, error) {
	var count int64
	err := p.db.QueryRowContext(ctx, `
		SELECT count(*) FROM user_mfa_used_challenges WHERE expires_at < $1
	`, cutoff).Scan(&count)
	return count, err
}

func (p *Purger) deleteChunk(ctx context.Context, cutoff time.Time, chunkSize int) (int64, error) {
	deleted, err := p.db.ExecContext(ctx, deleteChunkSQL, cutoff, chunkSize)
	if err != nil {
		return 0, err
	}
	return deleted.RowsAffected()
}

// deleteChunkSQL removes at most $2 rows whose token expired before $1. The
// ordered subquery is what keeps a chunk bounded:
// idx_user_mfa_used_challenges_expires_at hands back the oldest rows without
// scanning the table. SKIP LOCKED then keeps two overlapping runs from
// serializing on the same rows — whatever one run skips, the next one picks up.
const deleteChunkSQL = `
WITH expired AS (
	SELECT jti
	FROM user_mfa_used_challenges
	WHERE expires_at < $1
	ORDER BY expires_at
	LIMIT $2
	FOR UPDATE SKIP LOCKED
)
DELETE FROM user_mfa_used_challenges c
USING expired
WHERE c.jti = expired.jti
`
