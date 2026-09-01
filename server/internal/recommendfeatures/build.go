// Package recommendfeatures builds the daily user and item feature snapshots
// that online recommendation reads. Both tables are snapshots, not ledgers:
// every run replaces one tenant's rows with what the trailing window says
// today, so a subject that stopped producing signal loses its row instead of
// keeping a stale one.
package recommendfeatures

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/batchlock"
)

const (
	// DefaultWindowDays is the trailing window, in days, that both feature
	// sets summarise. Four weeks keeps weekly reading rhythms intact while
	// staying well inside the content_events retention window.
	DefaultWindowDays = 28

	// DefaultTopSeriesLimit bounds the per-user affinity list. That list is
	// what online inference reads to pick candidates, so it is capped to keep
	// one user's features small enough to fetch on a request path.
	DefaultTopSeriesLimit = 10

	// FeatureVersion stamps every row this package writes. Bump it whenever
	// the shape or the meaning of a field changes, so a reader can tell a
	// freshly built row from one an older build left behind.
	FeatureVersion = 1
)

// Builder rebuilds user_recommend_features and item_recommend_features.
// Its database connection must use a role with BYPASSRLS (or be a superuser),
// because one run spans every tenant.
type Builder struct {
	db *sql.DB
}

// Options describes one build run.
type Options struct {
	// ReferenceDate is the last UTC calendar day the window covers.
	ReferenceDate time.Time
	// WindowDays is the length of the trailing window, ending on
	// ReferenceDate and including it. Zero means DefaultWindowDays.
	WindowDays int
	// TopSeriesLimit bounds the per-user affinity list. Zero means
	// DefaultTopSeriesLimit.
	TopSeriesLimit int
}

// Result describes one build run. Every count covers the tenants the run
// actually finished: each tenant commits on its own, so on an error the counts
// describe the work that survived rather than the work that was planned.
type Result struct {
	TenantCount  int
	UserRowCount int64
	ItemRowCount int64
}

// New constructs a Builder backed by db.
func New(db *sql.DB) *Builder {
	return &Builder{db: db}
}

// Run replaces both feature snapshots for every tenant. Each tenant is its own
// transaction, so a failure part-way through leaves the tenants already built
// with a complete snapshot rather than a half-written one.
//
// One tenant's failure does not stop the others. The cron that drives this
// builds yesterday's window and never comes back for a day it missed, so
// letting a lock timeout on one tenant cost every tenant after it their
// features would leave them serving a snapshot a day older for nothing. The
// run finishes what it can and returns every failure together, so the exit
// status still reports the build as failed.
func (b *Builder) Run(ctx context.Context, opts Options) (Result, error) {
	if b == nil || b.db == nil {
		return Result{}, errors.New("recommend feature build requires a database")
	}
	if opts.ReferenceDate.IsZero() {
		return Result{}, errors.New("recommend feature build requires a reference date")
	}
	windowDays := opts.WindowDays
	if windowDays <= 0 {
		windowDays = DefaultWindowDays
	}
	topSeriesLimit := opts.TopSeriesLimit
	if topSeriesLimit <= 0 {
		topSeriesLimit = DefaultTopSeriesLimit
	}
	if err := b.requireBypassRLS(ctx); err != nil {
		return Result{}, err
	}

	referenceDate := opts.ReferenceDate.UTC().Format(time.DateOnly)
	tenants, err := b.listTenantIDs(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("list tenants: %w", err)
	}

	var result Result
	var failures []error
	for _, tenantID := range tenants {
		userRows, itemRows, err := b.buildTenant(ctx, tenantID, referenceDate, windowDays, topSeriesLimit)
		if err != nil {
			failures = append(failures, fmt.Errorf("build features for tenant %s at %s: %w", tenantID, referenceDate, err))
			// A cancelled context fails every remaining tenant the same way,
			// so there is nothing left to salvage by carrying on.
			if ctx.Err() != nil {
				break
			}
			continue
		}
		result.TenantCount++
		result.UserRowCount += userRows
		result.ItemRowCount += itemRows
	}
	return result, errors.Join(failures...)
}

func (b *Builder) requireBypassRLS(ctx context.Context) error {
	var bypasses bool
	err := b.db.QueryRowContext(ctx, `
		SELECT rolsuper OR rolbypassrls
		FROM pg_roles
		WHERE rolname = current_user
	`).Scan(&bypasses)
	if err != nil {
		return fmt.Errorf("check database role: %w", err)
	}
	if !bypasses {
		return errors.New("recommend feature build requires a database role with BYPASSRLS")
	}
	return nil
}

func (b *Builder) listTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := b.db.QueryContext(ctx, "SELECT id FROM tenants ORDER BY id")
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

func (b *Builder) buildTenant(
	ctx context.Context,
	tenantID uuid.UUID,
	referenceDate string,
	windowDays, topSeriesLimit int,
) (userRows, itemRows int64, err error) {
	tx, err := b.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback() //nolint:errcheck

	// This lock belongs inside the transaction: it protects the delete/insert
	// replacement from a concurrent cron invocation for the same tenant. Its
	// bounded wait turns an overlapping run into a failed run rather than one
	// that waits out the day holding a transaction open.
	if err := batchlock.TakeTenant(ctx, tx, tenantID.String()+":recommend-features"); err != nil {
		return 0, 0, err
	}

	sources, err := countSources(ctx, tx, tenantID, referenceDate, windowDays)
	if err != nil {
		return 0, 0, fmt.Errorf("count feature sources: %w", err)
	}

	itemRows, err = replaceSnapshot(ctx, tx, deleteItemFeaturesSQL, insertItemFeaturesSQL,
		tenantID, referenceDate, windowDays, FeatureVersion)
	if err != nil {
		return 0, 0, fmt.Errorf("rebuild item features: %w", err)
	}
	userRows, err = replaceSnapshot(ctx, tx, deleteUserFeaturesSQL, insertUserFeaturesSQL,
		tenantID, referenceDate, windowDays, FeatureVersion, topSeriesLimit)
	if err != nil {
		return 0, 0, fmt.Errorf("rebuild user features: %w", err)
	}

	// A source row must yield at least one feature row. This catches an
	// accidental empty read before the transaction commits the deletion of a
	// good prior snapshot.
	if sources.dailyStats > 0 && itemRows == 0 {
		return 0, 0, fmt.Errorf("item features produced no rows from %d daily stats rows", sources.dailyStats)
	}
	if sources.identifiedEvents > 0 && userRows == 0 {
		return 0, 0, fmt.Errorf("user features produced no rows from %d identified events", sources.identifiedEvents)
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return userRows, itemRows, nil
}

// replaceSnapshot clears this tenant's rows and rebuilds them from the window.
// The delete takes the tenant id alone; the insert takes it as $1 followed by
// the rest of its parameters.
func replaceSnapshot(
	ctx context.Context,
	tx *sql.Tx,
	deleteSQL, insertSQL string,
	tenantID uuid.UUID,
	insertArgs ...any,
) (int64, error) {
	if _, err := tx.ExecContext(ctx, deleteSQL, tenantID); err != nil {
		return 0, fmt.Errorf("delete previous snapshot: %w", err)
	}
	inserted, err := tx.ExecContext(ctx, insertSQL, append([]any{tenantID}, insertArgs...)...)
	if err != nil {
		return 0, fmt.Errorf("insert rebuilt snapshot: %w", err)
	}
	return inserted.RowsAffected()
}

type sourceCounts struct {
	dailyStats       int64
	identifiedEvents int64
}

// countSources counts the two inputs separately, because they gate different
// output tables: daily stats feed the item snapshot, and the events carrying a
// user_id feed the user snapshot.
func countSources(ctx context.Context, tx *sql.Tx, tenantID uuid.UUID, referenceDate string, windowDays int) (sourceCounts, error) {
	var counts sourceCounts
	err := tx.QueryRowContext(ctx, `
		SELECT
			(SELECT count(*)
			 FROM content_daily_stats
			 WHERE tenant_id = $1
			   AND stat_date >= ($2::date - ($3::int - 1))
			   AND stat_date <= $2::date),
			(SELECT count(*)
			 FROM content_events
			 WHERE tenant_id = $1
			   AND user_id IS NOT NULL
			   AND occurred_at >= ((($2::date - ($3::int - 1)))::timestamp AT TIME ZONE 'UTC')
			   AND occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC'))
	`, tenantID, referenceDate, windowDays).Scan(&counts.dailyStats, &counts.identifiedEvents)
	return counts, err
}

const deleteItemFeaturesSQL = `DELETE FROM item_recommend_features WHERE tenant_id = $1`

const deleteUserFeaturesSQL = `DELETE FROM user_recommend_features WHERE tenant_id = $1`

// insertItemFeaturesSQL rolls content_daily_stats up over the trailing window.
// viewer_days sums a per-day distinct count, so a reader who came back on five
// days counts five times; a window-wide distinct count would have to re-read
// the raw events, and online v1 does not score on it.
const insertItemFeaturesSQL = `
WITH bounds AS (
	SELECT ($2::date - ($3::int - 1)) AS window_start, $2::date AS window_end
)
INSERT INTO item_recommend_features (
	tenant_id, entity_type, entity_id, features, feature_version, computed_at
)
SELECT
	$1,
	cds.entity_type,
	cds.entity_id,
	jsonb_build_object(
		'window_days', $3::int,
		'window_start', to_char(b.window_start, 'YYYY-MM-DD'),
		'window_end', to_char(b.window_end, 'YYYY-MM-DD'),
		'view_count', sum(cds.view_count)::bigint,
		'viewer_days', sum(cds.unique_viewer_count)::bigint,
		'purchase_count', sum(cds.purchase_count)::bigint,
		'rating_count', sum(cds.rating_count)::bigint,
		'rating_sum', sum(cds.rating_sum)::bigint,
		'favorite_count', sum(cds.favorite_count)::bigint,
		'active_days', count(*)::bigint,
		'last_active_date', to_char(max(cds.stat_date), 'YYYY-MM-DD')
	),
	$4::int,
	now()
FROM content_daily_stats cds
CROSS JOIN bounds b
WHERE cds.tenant_id = $1
	AND cds.stat_date >= b.window_start
	AND cds.stat_date <= b.window_end
GROUP BY cds.entity_type, cds.entity_id, b.window_start, b.window_end
`

// insertUserFeaturesSQL summarises the trailing window per signed-in reader.
// Anonymous actors are excluded on purpose: user_recommend_features is keyed by
// users(tenant_id, id), so a publira_aid actor has nowhere to be stored and
// stays a fallback case for online inference.
const insertUserFeaturesSQL = `
WITH bounds AS (
	SELECT ($2::date - ($3::int - 1)) AS window_start, $2::date AS window_end
), windowed_events AS (
	SELECT ce.user_id, ce.series_id, ce.event_type, ce.rating_score, ce.occurred_at
	FROM content_events ce
	CROSS JOIN bounds b
	WHERE ce.tenant_id = $1
		AND ce.user_id IS NOT NULL
		AND ce.occurred_at >= (b.window_start::timestamp AT TIME ZONE 'UTC')
		AND ce.occurred_at < ((b.window_end + 1)::timestamp AT TIME ZONE 'UTC')
), per_series AS (
	SELECT
		user_id,
		series_id,
		count(*)::bigint AS event_count,
		count(*) FILTER (WHERE event_type IN ('episode_view', 'series_view'))::bigint AS view_count,
		count(*) FILTER (WHERE event_type = 'purchase')::bigint AS purchase_count,
		count(*) FILTER (WHERE event_type = 'rating')::bigint AS rating_count,
		COALESCE(sum(rating_score) FILTER (WHERE event_type = 'rating'), 0)::bigint AS rating_sum,
		count(*) FILTER (WHERE event_type = 'favorite')::bigint AS favorite_count,
		max(occurred_at) AS last_event_at
	FROM windowed_events
	GROUP BY user_id, series_id
), ranked_series AS (
	SELECT
		per_series.*,
		row_number() OVER (
			PARTITION BY user_id
			ORDER BY event_count DESC, purchase_count DESC, series_id
		) AS position
	FROM per_series
), top_series AS (
	SELECT
		user_id,
		jsonb_agg(
			jsonb_build_object(
				'series_id', series_id,
				'event_count', event_count,
				'view_count', view_count,
				'purchase_count', purchase_count,
				'rating_count', rating_count,
				'rating_sum', rating_sum,
				'favorite_count', favorite_count,
				'last_event_at', to_char(last_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
			)
			ORDER BY position
		) AS series
	FROM ranked_series
	WHERE position <= $5::int
	GROUP BY user_id
), totals AS (
	SELECT
		user_id,
		sum(event_count)::bigint AS event_count,
		sum(view_count)::bigint AS view_count,
		sum(purchase_count)::bigint AS purchase_count,
		sum(rating_count)::bigint AS rating_count,
		sum(rating_sum)::bigint AS rating_sum,
		sum(favorite_count)::bigint AS favorite_count,
		count(*)::bigint AS series_count,
		max(last_event_at) AS last_event_at
	FROM per_series
	GROUP BY user_id
)
INSERT INTO user_recommend_features (
	tenant_id, user_id, features, feature_version, computed_at
)
SELECT
	$1,
	t.user_id,
	jsonb_build_object(
		'window_days', $3::int,
		'window_start', to_char(b.window_start, 'YYYY-MM-DD'),
		'window_end', to_char(b.window_end, 'YYYY-MM-DD'),
		'event_count', t.event_count,
		'view_count', t.view_count,
		'purchase_count', t.purchase_count,
		'rating_count', t.rating_count,
		'rating_sum', t.rating_sum,
		'favorite_count', t.favorite_count,
		'series_count', t.series_count,
		'last_event_at', to_char(t.last_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		'top_series', COALESCE(ts.series, '[]'::jsonb)
	),
	$4::int,
	now()
FROM totals t
LEFT JOIN top_series ts ON ts.user_id = t.user_id
CROSS JOIN bounds b
`
