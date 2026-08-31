// Package contentranking turns the daily engagement aggregates into the
// ranking snapshots the public site reads. It owns the score formula for this
// repository: which signals count, how much each is worth, and how quickly an
// older day fades. Every run recomputes a whole period from
// content_daily_stats, so re-running a day replaces its snapshot instead of
// adding to it. It also owns the retention side of the same table: snapshots
// accumulate one period at a time and are dropped on a deadline.
package contentranking

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	// AlgorithmVersion stamps every snapshot this package writes. Bump it
	// whenever the score formula changes — the weights, the recency decay, or
	// the shape of an item — so a reader can tell a snapshot built by this
	// build from one an older build left behind. It is part of the snapshot's
	// unique key, so a bumped version writes alongside the old rows rather
	// than overwriting them.
	AlgorithmVersion = 1

	// DailyRankingKey ranks a single UTC day, WeeklyRankingKey the seven days
	// ending on it. Both are recomputed from the same daily stats, so the
	// weekly ranking never depends on a previous weekly run.
	DailyRankingKey  = "daily"
	WeeklyRankingKey = "weekly"

	// weeklyWindowDays is the length of the weekly window, including its last
	// day. It is fixed rather than configurable because period_start and
	// period_end identify the snapshot: a ten-day window filed under the key
	// "weekly" would describe itself incorrectly.
	weeklyWindowDays = 7

	// DefaultItemLimit bounds how many entities one snapshot carries. The
	// items array is fetched whole by whoever renders the ranking, so the
	// snapshot holds a leaderboard rather than the entire catalogue.
	DefaultItemLimit = 50

	// lockTimeout bounds how long one tenant waits for the advisory lock. A
	// cron one-shot has no deadline of its own, so without this an overlapping
	// run would block forever with a transaction open instead of exiting.
	lockTimeout = "30s"
)

// The score weights. They are constants rather than settings: a snapshot
// records AlgorithmVersion, not the weights, so two runs that disagreed about
// them would file incomparable rankings under the same version. Changing any
// of these means bumping AlgorithmVersion.
//
// The ordering behind the numbers: paying for an episode is the strongest
// statement a reader makes, following a series the next strongest, and a view
// the weakest. A distinct viewer counts for more than a repeat view, so a
// title read once by many outranks one refreshed by a few.
const (
	viewWeight          = 1
	uniqueViewerWeight  = 2
	purchaseWeight      = 20
	favoriteWeight      = 8
	ratingWeight        = 3
	neutralRatingScore  = 3
	recencyHalfLifeDays = 3
)

// Aggregator rebuilds content_ranking_snapshots from content_daily_stats.
// Its database connection must use a role with BYPASSRLS (or be a superuser),
// because one run spans every tenant.
type Aggregator struct {
	db *sql.DB
}

// Options describes one ranking run.
type Options struct {
	// ReferenceDate is the last UTC calendar day every window covers.
	ReferenceDate time.Time
	// ItemLimit bounds the items array of each snapshot. Zero means
	// DefaultItemLimit.
	ItemLimit int
}

// Result describes one ranking run. Every count covers the tenants the run
// actually finished: each tenant commits on its own, so on an error the counts
// describe the tenants that succeeded rather than the ones that were tried.
type Result struct {
	TenantCount   int
	SnapshotCount int
	ItemCount     int
}

// New constructs an Aggregator backed by db.
func New(db *sql.DB) *Aggregator {
	return &Aggregator{db: db}
}

// window is one period a run ranks, named by the key it is filed under.
type window struct {
	key  string
	days int
}

// windows and entityTypes together decide how many snapshots one tenant gets:
// each combination is its own row, because a reader asks for one period and
// one kind of entity at a time.
var (
	windows     = []window{{key: DailyRankingKey, days: 1}, {key: WeeklyRankingKey, days: weeklyWindowDays}}
	entityTypes = []string{"series", "episode"}
)

// Run rebuilds every ranking snapshot ending on the reference date, for every
// tenant. Each tenant is its own transaction, so a failure part-way through
// leaves the tenants already ranked with a complete set of snapshots rather
// than a half-written one.
//
// One tenant's failure does not stop the others. The cron that drives this
// ranks yesterday and never comes back for a day it missed, so letting a lock
// timeout on one tenant cost every tenant after it their snapshot would lose
// that day for good. The run finishes what it can and returns every failure
// together, so the exit status still reports the day as failed.
func (a *Aggregator) Run(ctx context.Context, opts Options) (Result, error) {
	if a == nil || a.db == nil {
		return Result{}, errors.New("ranking aggregation requires a database")
	}
	if opts.ReferenceDate.IsZero() {
		return Result{}, errors.New("ranking aggregation requires a reference date")
	}
	itemLimit := opts.ItemLimit
	if itemLimit <= 0 {
		itemLimit = DefaultItemLimit
	}
	if err := requireBypassRLS(ctx, a.db, "ranking aggregation"); err != nil {
		return Result{}, err
	}

	referenceDate := opts.ReferenceDate.UTC().Truncate(24 * time.Hour)
	tenants, err := a.listTenantIDs(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("list tenants: %w", err)
	}

	var result Result
	var failures []error
	for _, tenantID := range tenants {
		snapshots, items, err := a.rankTenant(ctx, tenantID, referenceDate, itemLimit)
		if err != nil {
			failures = append(failures, fmt.Errorf("rank tenant %s at %s: %w", tenantID, referenceDate.Format(time.DateOnly), err))
			// A cancelled context fails every remaining tenant the same way,
			// so there is nothing left to salvage by carrying on.
			if ctx.Err() != nil {
				break
			}
			continue
		}
		result.TenantCount++
		result.SnapshotCount += snapshots
		result.ItemCount += items
	}
	return result, errors.Join(failures...)
}

// requireBypassRLS refuses a connection that row-level security would scope to
// one tenant. Both the aggregation and the purge span every tenant, and under
// a tenant-scoped role they would silently do a fraction of their work; task
// names the caller in the error.
func requireBypassRLS(ctx context.Context, db *sql.DB, task string) error {
	var bypasses bool
	err := db.QueryRowContext(ctx, `
		SELECT rolsuper OR rolbypassrls
		FROM pg_roles
		WHERE rolname = current_user
	`).Scan(&bypasses)
	if err != nil {
		return fmt.Errorf("check database role: %w", err)
	}
	if !bypasses {
		return fmt.Errorf("%s requires a database role with BYPASSRLS", task)
	}
	return nil
}

func (a *Aggregator) listTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := a.db.QueryContext(ctx, "SELECT id FROM tenants ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close() //nolint:errcheck

	var tenantIDs []uuid.UUID
	for rows.Next() {
		var tenantID uuid.UUID
		if err := rows.Scan(&tenantID); err != nil {
			return nil, err
		}
		tenantIDs = append(tenantIDs, tenantID)
	}
	return tenantIDs, rows.Err()
}

// rankTenant writes every window and entity type for one tenant in a single
// transaction, so a reader never sees the daily ranking of this run beside the
// weekly ranking of the last one.
func (a *Aggregator) rankTenant(
	ctx context.Context,
	tenantID uuid.UUID,
	referenceDate time.Time,
	itemLimit int,
) (snapshotCount, itemCount int, err error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.ExecContext(ctx, "SELECT set_config('lock_timeout', $1, true)", lockTimeout); err != nil {
		return 0, 0, fmt.Errorf("set lock timeout: %w", err)
	}
	// This lock belongs inside the transaction: it keeps a concurrent cron
	// invocation from rewriting the same tenant's snapshots underneath this
	// one. The timeout above turns an overlapping run into a failed run rather
	// than one that waits out the day holding a transaction open.
	if _, err := tx.ExecContext(ctx, `
		SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':content-ranking', 0))
	`, tenantID); err != nil {
		return 0, 0, fmt.Errorf("lock tenant (waited up to %s): %w", lockTimeout, err)
	}

	for _, w := range windows {
		periodEnd := referenceDate
		periodStart := periodEnd.AddDate(0, 0, -(w.days - 1))
		for _, entityType := range entityTypes {
			items, err := writeSnapshot(ctx, tx, snapshotRequest{
				tenantID:    tenantID,
				rankingKey:  w.key,
				periodStart: periodStart.Format(time.DateOnly),
				periodEnd:   periodEnd.Format(time.DateOnly),
				entityType:  entityType,
				itemLimit:   itemLimit,
			})
			if err != nil {
				return 0, 0, fmt.Errorf("write %s %s snapshot: %w", w.key, entityType, err)
			}
			snapshotCount++
			itemCount += items
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return snapshotCount, itemCount, nil
}

type snapshotRequest struct {
	tenantID    uuid.UUID
	rankingKey  string
	periodStart string
	periodEnd   string
	entityType  string
	itemLimit   int
}

// writeSnapshot replaces one snapshot and reports how many items it holds.
func writeSnapshot(ctx context.Context, tx *sql.Tx, req snapshotRequest) (int, error) {
	rankable, err := countRankableRows(ctx, tx, req)
	if err != nil {
		return 0, fmt.Errorf("count rankable stats: %w", err)
	}

	var items int
	err = tx.QueryRowContext(ctx, upsertSnapshotSQL,
		req.tenantID, req.periodStart, req.periodEnd, req.entityType, req.rankingKey,
		req.itemLimit, AlgorithmVersion,
		viewWeight, uniqueViewerWeight, purchaseWeight, favoriteWeight, ratingWeight,
		neutralRatingScore, recencyHalfLifeDays,
	).Scan(&items)
	if err != nil {
		return 0, fmt.Errorf("upsert snapshot: %w", err)
	}

	// Every rankable row scores above zero, so an empty ranking built from one
	// is a failed read rather than an unpopular period. Failing here rolls the
	// transaction back before it can replace a good snapshot with an empty one.
	if rankable > 0 && items == 0 {
		return 0, fmt.Errorf("ranking produced no items from %d rankable daily stats rows", rankable)
	}
	return items, nil
}

// countRankableRows counts the daily rows that can contribute a positive score.
// The condition mirrors the score formula: every weight is positive, so a row
// carrying any of these signals reaches the ranking, and a row without them
// cannot.
func countRankableRows(ctx context.Context, tx *sql.Tx, req snapshotRequest) (int64, error) {
	var rankable int64
	err := tx.QueryRowContext(ctx, `
		SELECT count(*)
		FROM content_daily_stats
		WHERE tenant_id = $1
			AND entity_type = $2
			AND stat_date >= $3::date
			AND stat_date <= $4::date
			AND (
				view_count > 0
				OR unique_viewer_count > 0
				OR purchase_count > 0
				OR favorite_count > 0
				OR rating_sum > $5::numeric * rating_count
			)
	`, req.tenantID, req.entityType, req.periodStart, req.periodEnd, neutralRatingScore).Scan(&rankable)
	return rankable, err
}

// upsertSnapshotSQL scores one window and files the leaderboard under the
// snapshot's unique key.
//
// The score is a weighted sum over the window's daily rows, each faded by how
// far it sits from the last day of the window. Ratings only ever add: a score
// above neutral is a bonus, and one below it contributes nothing rather than
// pushing a title down a popularity chart. Because the fade is measured
// against the window rather than against now, re-running a past day produces
// exactly the snapshot the first run produced.
//
// The order is fully determined — score, then purchases, then viewers, then
// entity id — so two runs over unchanged stats agree on every position, not
// just on the set of entities.
const upsertSnapshotSQL = `
WITH bounds AS (
	SELECT $2::date AS window_start, $3::date AS window_end
), windowed AS (
	SELECT
		cds.entity_id,
		sum(cds.view_count)::bigint AS view_count,
		sum(cds.unique_viewer_count)::bigint AS viewer_days,
		sum(cds.purchase_count)::bigint AS purchase_count,
		sum(cds.rating_count)::bigint AS rating_count,
		sum(cds.rating_sum)::bigint AS rating_sum,
		sum(cds.favorite_count)::bigint AS favorite_count,
		max(cds.stat_date) AS last_active_date,
		sum(
			(
				$8::numeric * cds.view_count
				+ $9::numeric * cds.unique_viewer_count
				+ $10::numeric * cds.purchase_count
				+ $11::numeric * cds.favorite_count
				+ $12::numeric * greatest(cds.rating_sum - $13::numeric * cds.rating_count, 0)
			) * power(0.5, (b.window_end - cds.stat_date)::numeric / $14::numeric)
		) AS score
	FROM content_daily_stats cds
	CROSS JOIN bounds b
	WHERE cds.tenant_id = $1
		AND cds.entity_type = $4
		AND cds.stat_date >= b.window_start
		AND cds.stat_date <= b.window_end
	GROUP BY cds.entity_id
), ranked AS (
	SELECT
		windowed.*,
		row_number() OVER (
			ORDER BY score DESC, purchase_count DESC, viewer_days DESC, entity_id
		) AS position
	FROM windowed
	WHERE score > 0
)
INSERT INTO content_ranking_snapshots (
	id, tenant_id, ranking_key, period_start, period_end, entity_type,
	items, algorithm_version, computed_at
)
SELECT
	gen_random_uuid(), $1, $5, b.window_start, b.window_end, $4,
	COALESCE((
		SELECT jsonb_agg(
			jsonb_build_object(
				'rank', r.position,
				'entity_id', r.entity_id,
				'score', trim_scale(round(r.score, 4)),
				'view_count', r.view_count,
				'viewer_days', r.viewer_days,
				'purchase_count', r.purchase_count,
				'rating_count', r.rating_count,
				'rating_sum', r.rating_sum,
				'favorite_count', r.favorite_count,
				'last_active_date', to_char(r.last_active_date, 'YYYY-MM-DD')
			)
			ORDER BY r.position
		)
		FROM ranked r
		WHERE r.position <= $6::int
	), '[]'::jsonb),
	$7::int,
	now()
FROM bounds b
ON CONFLICT (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version)
DO UPDATE SET items = EXCLUDED.items, computed_at = EXCLUDED.computed_at
RETURNING jsonb_array_length(items)
`
