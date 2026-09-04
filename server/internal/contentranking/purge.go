package contentranking

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/lib/pq"
)

// DefaultPurgeChunkSize bounds one DELETE statement. Every chunk is its own
// transaction, so the value trades how long a single statement holds locks and
// how much WAL it writes against how many round trips a full purge costs. It
// is an order of magnitude below the content_events chunk because a snapshot
// row carries a whole leaderboard in its items array rather than one event.
const DefaultPurgeChunkSize = 1000

// Purger deletes ranking snapshots whose period has fallen out of its
// retention window. Its database connection must use a role with BYPASSRLS
// (or be a superuser), because one run spans every tenant.
type Purger struct {
	db *sql.DB
}

// PurgeOptions describes one purge run.
type PurgeOptions struct {
	// Cutoffs is the oldest period_end that survives, per ranking key. The
	// comparison is exclusive: a snapshot has expired when its period_end is
	// before the cutoff of its ranking_key.
	//
	// period_end rather than computed_at, because re-running an old period is
	// a repair and must not buy that period another full window of life. For
	// the same reason an AlgorithmVersion bump needs nothing special here: the
	// new version starts writing the periods the old one no longer does, so
	// the old rows stop being anyone's newest period and age out normally.
	//
	// A ranking_key that has no entry here is never deleted. Retention is a
	// decision about a particular kind of leaderboard, so a key this build
	// does not know about is left for the build that does.
	Cutoffs map[string]time.Time
	// ChunkSize is the row limit of a single DELETE. Zero means
	// DefaultPurgeChunkSize.
	ChunkSize int
	// DryRun counts the expired snapshots and deletes nothing.
	DryRun bool
}

// PurgeResult describes what one purge run did.
type PurgeResult struct {
	// RowCount is the number of snapshots deleted, or — in a dry run — the
	// number that would have been deleted.
	RowCount int64
	// ChunkCount is how many DELETE statements ran. Outside a dry run it is
	// at least one, because a run always probes for expired snapshots.
	ChunkCount int
	// DryRun repeats PurgeOptions.DryRun so callers can log a single struct.
	DryRun bool
}

// NewPurger constructs a Purger backed by db.
func NewPurger(db *sql.DB) *Purger {
	return &Purger{db: db}
}

// Run deletes every expired ranking snapshot, in chunks of opts.ChunkSize.
// Each chunk commits on its own: a cancelled or timed-out run keeps the chunks
// it already finished, and the next run resumes from there. Deleting is
// idempotent — a second run over the same cutoffs finds nothing left.
//
// The newest period a tenant has for a ranking key and entity type always
// survives, whatever the cutoff says. That row is what the public site reads,
// and a tenant whose cron has been stopped longer than its retention window
// would otherwise lose its ranking entirely rather than serve a stale one.
func (p *Purger) Run(ctx context.Context, opts PurgeOptions) (PurgeResult, error) {
	if p == nil || p.db == nil {
		return PurgeResult{}, errors.New("ranking snapshot purge requires a database")
	}
	rankingKeys, cutoffs, err := flattenCutoffs(opts.Cutoffs)
	if err != nil {
		return PurgeResult{}, err
	}
	chunkSize := opts.ChunkSize
	if chunkSize <= 0 {
		chunkSize = DefaultPurgeChunkSize
	}
	if err := requireBypassRLS(ctx, p.db, "ranking snapshot purge"); err != nil {
		return PurgeResult{}, err
	}

	if opts.DryRun {
		candidates, err := p.countExpired(ctx, rankingKeys, cutoffs)
		if err != nil {
			return PurgeResult{}, fmt.Errorf("count expired snapshots: %w", err)
		}
		return PurgeResult{RowCount: candidates, DryRun: true}, nil
	}

	var result PurgeResult
	for {
		deleted, err := p.deleteChunk(ctx, rankingKeys, cutoffs, chunkSize)
		if err != nil {
			return result, fmt.Errorf("delete expired snapshots: %w", err)
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

// flattenCutoffs turns the per-key retention into the two parallel arrays the
// statement unnests. Sorting by ranking key keeps one run's parameters in the
// same order on every chunk, so a plan cached for the first chunk fits the
// rest.
func flattenCutoffs(cutoffs map[string]time.Time) (rankingKeys, dates []string, err error) {
	if len(cutoffs) == 0 {
		return nil, nil, errors.New("ranking snapshot purge requires at least one retention cutoff")
	}
	rankingKeys = slices.Sorted(maps.Keys(cutoffs))
	dates = make([]string, 0, len(rankingKeys))
	for _, rankingKey := range rankingKeys {
		cutoff := cutoffs[rankingKey]
		if cutoff.IsZero() {
			return nil, nil, fmt.Errorf("ranking snapshot purge requires a cutoff for the %q ranking key", rankingKey)
		}
		dates = append(dates, cutoff.UTC().Format(time.DateOnly))
	}
	return rankingKeys, dates, nil
}

func (p *Purger) countExpired(ctx context.Context, rankingKeys, cutoffs []string) (int64, error) {
	var count int64
	err := p.db.QueryRowContext(ctx, countExpiredSnapshotsSQL, pq.Array(rankingKeys), pq.Array(cutoffs)).Scan(&count)
	return count, err
}

func (p *Purger) deleteChunk(ctx context.Context, rankingKeys, cutoffs []string, chunkSize int) (int64, error) {
	deleted, err := p.db.ExecContext(ctx, deleteExpiredSnapshotChunkSQL, pq.Array(rankingKeys), pq.Array(cutoffs), chunkSize)
	if err != nil {
		return 0, err
	}
	return deleted.RowsAffected()
}

// retentionCTEs resolve what "expired" means for this run. $1 and $2 are the
// ranking keys and their cutoffs, paired by position, so a key absent from the
// arrays joins to nothing and keeps every one of its snapshots.
//
// latest names the newest period each tenant still holds per ranking key and
// entity type; the grouping keys are the leading columns of
// idx_content_ranking_snapshots_tenant_key_computed, so it can be answered
// from that index. It is re-derived on every chunk rather than read once for
// the run, which keeps the guarantee exact even while aggregate-rankings is
// writing a newer period underneath the purge.
const retentionCTEs = `
WITH retention AS (
	SELECT ranking_key, cutoff
	FROM unnest($1::text[], $2::date[]) AS t(ranking_key, cutoff)
), latest AS (
	SELECT tenant_id, ranking_key, entity_type, max(period_end) AS period_end
	FROM content_ranking_snapshots
	GROUP BY tenant_id, ranking_key, entity_type
)`

// expiredSnapshots selects the rows past their retention window that are not
// the newest period their group has. Both the dry-run count and the chunked
// delete read through it, so the two can never disagree about what expired.
//
// Nothing here is indexed for the purge, and deliberately so: every index on
// the table leads with tenant_id, which cannot narrow a scan that spans every
// tenant. Both this scan and the latest grouping are sequential-scan-sized
// work on a table retention itself keeps to roughly a thousand rows per
// tenant, while every write to it goes through the daily aggregate-rankings
// run — so an index would cost more on that path than it saves here. A purge
// that stops fitting the cron interval, judged from the elapsed time in its
// completion log, is the trigger to add one.
const expiredSnapshots = `
FROM content_ranking_snapshots s
JOIN retention r ON r.ranking_key = s.ranking_key
JOIN latest l
	ON l.tenant_id = s.tenant_id
	AND l.ranking_key = s.ranking_key
	AND l.entity_type = s.entity_type
WHERE s.period_end < r.cutoff
	AND s.period_end < l.period_end
`

const countExpiredSnapshotsSQL = retentionCTEs + `
SELECT count(*)` + expiredSnapshots

// deleteExpiredSnapshotChunkSQL removes at most $3 expired snapshots, oldest
// period first. SKIP LOCKED keeps the purge from serializing on a row an
// overlapping run or an aggregate-rankings upsert already holds — whatever one
// run skips, the next one picks up. Only s is locked: retention and latest are
// derived, and there are no rows of theirs to lock.
const deleteExpiredSnapshotChunkSQL = retentionCTEs + `, expired AS (
	SELECT s.id` + expiredSnapshots + `	ORDER BY s.period_end
	LIMIT $3
	FOR UPDATE OF s SKIP LOCKED
)
DELETE FROM content_ranking_snapshots crs
USING expired
WHERE crs.id = expired.id`
