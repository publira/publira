package contentranking

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"

	"github.com/publira/publira/server/internal/retention"
)

// DefaultPurgeChunkSize bounds one DELETE statement. Every chunk is its own
// transaction, so the value trades how long a single statement holds locks and
// how much WAL it writes against how many round trips a full purge costs. It
// is an order of magnitude below the content_events chunk because a snapshot
// row carries a whole leaderboard in its items array rather than one event.
const DefaultPurgeChunkSize = 1000

// Purger deletes ranking snapshots whose period has fallen out of its
// tenant's retention period. Its database connection must use a role with BYPASSRLS
// (or be a superuser), because one run spans every tenant.
type Purger struct {
	db *sql.DB
}

// PurgeOptions describes one purge run.
type PurgeOptions struct {
	// Now is the instant each tenant's cutoffs are counted back from.
	Now time.Time
	// Retention answers each tenant's periods.
	Retention retention.Table
	// ChunkSize is the row limit of a single DELETE. Zero means
	// DefaultPurgeChunkSize.
	ChunkSize int
	// DryRun counts the expired snapshots and deletes nothing.
	DryRun bool
}

// retentionCutoffs is the oldest period_end that survives, per ranking key.
// The comparison is exclusive: a snapshot has expired when its period_end is
// before the cutoff of its ranking_key.
//
// period_end rather than computed_at, because re-running an old period is a
// repair and must not buy that period another full period of life. For the
// same reason an AlgorithmVersion bump needs nothing special here: the new
// version starts writing the periods the old one no longer does, so the old
// rows stop being anyone's newest period and age out normally.
//
// A ranking_key that has no entry here is never deleted. Retention is a
// decision about a particular kind of leaderboard, so a key this build does
// not know about is left for the build that does.
func retentionCutoffs(periods retention.Periods, now time.Time) map[string]time.Time {
	return map[string]time.Time{
		DailyRankingKey:  periods.DailyRankingSnapshotCutoff(now),
		WeeklyRankingKey: periods.WeeklyRankingSnapshotCutoff(now),
	}
}

// PurgeResult describes what one purge run did. Every count covers the tenants
// the run actually finished: each chunk commits on its own, so on an error the
// counts describe the work that survived rather than the work that was tried.
type PurgeResult struct {
	// TenantCount is the number of tenants the run drained.
	TenantCount int
	// RowCount is the number of snapshots deleted, or — in a dry run — the
	// number that would have been deleted.
	RowCount int64
	// ChunkCount is how many DELETE statements ran. Outside a dry run it is
	// at least one per tenant, because every tenant is probed for expired
	// snapshots.
	ChunkCount int
	// DryRun repeats PurgeOptions.DryRun so callers can log a single struct.
	DryRun bool
}

// NewPurger constructs a Purger backed by db.
func NewPurger(db *sql.DB) *Purger {
	return &Purger{db: db}
}

// Run deletes every expired ranking snapshot, one tenant at a time, in chunks
// of opts.ChunkSize. Each chunk commits on its own: a cancelled or timed-out
// run keeps the chunks it already finished, and the next run resumes from
// there. Deleting is idempotent — a second run at the same time finds nothing
// left.
//
// The newest period a tenant has for a ranking key and entity type always
// survives, whatever the cutoff says. That row is what the public site reads,
// and a tenant whose rebuilds have stopped for longer than its retention period
// would otherwise lose its ranking entirely rather than serve a stale one.
//
// One tenant's failure does not stop the others; the run finishes what it can
// and returns every failure together, so the exit status still reports it.
func (p *Purger) Run(ctx context.Context, opts PurgeOptions) (PurgeResult, error) {
	if p == nil || p.db == nil {
		return PurgeResult{}, errors.New("ranking snapshot purge requires a database")
	}
	if opts.Now.IsZero() {
		return PurgeResult{}, errors.New("ranking snapshot purge requires a current time")
	}
	chunkSize := opts.ChunkSize
	if chunkSize <= 0 {
		chunkSize = DefaultPurgeChunkSize
	}
	if err := requireBypassRLS(ctx, p.db, "ranking snapshot purge"); err != nil {
		return PurgeResult{}, err
	}

	tenantIDs, err := listTenantIDs(ctx, p.db)
	if err != nil {
		return PurgeResult{}, fmt.Errorf("list tenants: %w", err)
	}

	result := PurgeResult{DryRun: opts.DryRun}
	var failures []error
	for _, tenantID := range tenantIDs {
		rankingKeys, cutoffs := flattenCutoffs(retentionCutoffs(opts.Retention.For(tenantID), opts.Now))
		rows, chunks, err := p.purgeTenant(ctx, tenantID, rankingKeys, cutoffs, chunkSize, opts.DryRun)
		result.RowCount += rows
		result.ChunkCount += chunks
		if err != nil {
			failures = append(failures, fmt.Errorf("purge ranking snapshots of tenant %s: %w", tenantID, err))
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
	rankingKeys, cutoffs []string,
	chunkSize int,
	dryRun bool,
) (rowCount int64, chunkCount int, err error) {
	if dryRun {
		candidates, err := p.countExpired(ctx, tenantID, rankingKeys, cutoffs)
		if err != nil {
			return 0, 0, fmt.Errorf("count expired snapshots: %w", err)
		}
		return candidates, 0, nil
	}

	for {
		deleted, err := p.deleteChunk(ctx, tenantID, rankingKeys, cutoffs, chunkSize)
		if err != nil {
			return rowCount, chunkCount, fmt.Errorf("delete expired snapshots: %w", err)
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

// flattenCutoffs turns the per-key retention into the two parallel arrays the
// statement unnests. Sorting by ranking key keeps one run's parameters in the
// same order on every chunk, so a plan cached for the first chunk fits the
// rest.
func flattenCutoffs(cutoffs map[string]time.Time) (rankingKeys, dates []string) {
	rankingKeys = slices.Sorted(maps.Keys(cutoffs))
	dates = make([]string, 0, len(rankingKeys))
	for _, rankingKey := range rankingKeys {
		dates = append(dates, cutoffs[rankingKey].UTC().Format(time.DateOnly))
	}
	return rankingKeys, dates
}

func (p *Purger) countExpired(ctx context.Context, tenantID uuid.UUID, rankingKeys, cutoffs []string) (int64, error) {
	var count int64
	err := p.db.QueryRowContext(ctx, countExpiredSnapshotsSQL, tenantID, pq.Array(rankingKeys), pq.Array(cutoffs)).Scan(&count)
	return count, err
}

func (p *Purger) deleteChunk(ctx context.Context, tenantID uuid.UUID, rankingKeys, cutoffs []string, chunkSize int) (int64, error) {
	deleted, err := p.db.ExecContext(ctx, deleteExpiredSnapshotChunkSQL, tenantID, pq.Array(rankingKeys), pq.Array(cutoffs), chunkSize)
	if err != nil {
		return 0, err
	}
	return deleted.RowsAffected()
}

func listTenantIDs(ctx context.Context, db *sql.DB) ([]uuid.UUID, error) {
	rows, err := db.QueryContext(ctx, "SELECT id FROM tenants ORDER BY id")
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

// retentionCTEs resolve what "expired" means for one tenant in this run. $1 is
// the tenant; $2 and $3 are the ranking keys and their cutoffs, paired by
// position, so a key absent from the arrays joins to nothing and keeps every
// one of its snapshots.
//
// latest names the newest period the tenant still holds per ranking key and
// entity type; the grouping keys are the leading columns of
// idx_content_ranking_snapshots_tenant_key_computed, so it can be answered
// from that index. It is re-derived on every chunk rather than read once for
// the run, which keeps the guarantee exact even while aggregate-rankings is
// writing a newer period underneath the purge.
const retentionCTEs = `
WITH retention AS (
	SELECT ranking_key, cutoff
	FROM unnest($2::text[], $3::date[]) AS t(ranking_key, cutoff)
), latest AS (
	SELECT ranking_key, entity_type, max(period_end) AS period_end
	FROM content_ranking_snapshots
	WHERE tenant_id = $1
	GROUP BY ranking_key, entity_type
)`

// expiredSnapshots selects the tenant's rows past their retention period that
// are not the newest period their group has. Both the dry-run count and the
// chunked delete read through it, so the two can never disagree about what
// expired.
//
// The tenant filter narrows the scan through the tenant-leading indexes, and
// retention itself keeps a tenant to roughly a thousand rows, so nothing here
// needs an index of its own. A purge that stops fitting its interval,
// judged from the elapsed time in its completion log, is the trigger to add
// one.
const expiredSnapshots = `
FROM content_ranking_snapshots s
JOIN retention r ON r.ranking_key = s.ranking_key
JOIN latest l
	ON l.ranking_key = s.ranking_key
	AND l.entity_type = s.entity_type
WHERE s.tenant_id = $1
	AND s.period_end < r.cutoff
	AND s.period_end < l.period_end
`

const countExpiredSnapshotsSQL = retentionCTEs + `
SELECT count(*)` + expiredSnapshots

// deleteExpiredSnapshotChunkSQL removes at most $4 expired snapshots, oldest
// period first. SKIP LOCKED keeps the purge from serializing on a row an
// overlapping run or an aggregate-rankings upsert already holds — whatever one
// run skips, the next one picks up. Only s is locked: retention and latest are
// derived, and there are no rows of theirs to lock.
const deleteExpiredSnapshotChunkSQL = retentionCTEs + `, expired AS (
	SELECT s.id` + expiredSnapshots + `	ORDER BY s.period_end
	LIMIT $4
	FOR UPDATE OF s SKIP LOCKED
)
DELETE FROM content_ranking_snapshots crs
USING expired
WHERE crs.id = expired.id`
