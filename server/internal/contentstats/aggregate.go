// Package contentstats rebuilds the daily engagement aggregates used by
// rankings. It deliberately reads every source of truth for one day and
// replaces that tenant's snapshot in a single transaction.
package contentstats

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Aggregator rebuilds content_daily_stats from content_events and purchases.
// Its database connection must use a role with BYPASSRLS (or be a superuser),
// because each run reads and writes every tenant.
type Aggregator struct {
	db *sql.DB
}

// Result describes one complete aggregate run.
type Result struct {
	TenantCount int
	RowCount    int64
}

// New constructs an Aggregator backed by db.
func New(db *sql.DB) *Aggregator {
	return &Aggregator{db: db}
}

// Run replaces the stats for statDate for every tenant. statDate is interpreted
// as a UTC calendar day; content_daily_stats is a UTC daily aggregate.
func (a *Aggregator) Run(ctx context.Context, statDate time.Time) (Result, error) {
	if a == nil || a.db == nil {
		return Result{}, errors.New("content stats aggregator requires a database")
	}
	if err := a.requireBypassRLS(ctx); err != nil {
		return Result{}, err
	}

	date := statDate.UTC().Format(time.DateOnly)
	tenants, err := a.listTenantIDs(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("list tenants: %w", err)
	}

	result := Result{TenantCount: len(tenants)}
	for _, tenantID := range tenants {
		rows, err := a.aggregateTenant(ctx, tenantID, date)
		if err != nil {
			return Result{}, fmt.Errorf("aggregate tenant %s for %s: %w", tenantID, date, err)
		}
		result.RowCount += rows
	}
	return result, nil
}

func (a *Aggregator) requireBypassRLS(ctx context.Context) error {
	var bypasses bool
	err := a.db.QueryRowContext(ctx, `
		SELECT rolsuper OR rolbypassrls
		FROM pg_roles
		WHERE rolname = current_user
	`).Scan(&bypasses)
	if err != nil {
		return fmt.Errorf("check database role: %w", err)
	}
	if !bypasses {
		return errors.New("content stats aggregation requires a database role with BYPASSRLS")
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

func (a *Aggregator) aggregateTenant(ctx context.Context, tenantID uuid.UUID, statDate string) (int64, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck

	// This lock belongs inside the transaction: it protects the delete/insert
	// replacement from a concurrent cron invocation for the same tenant/day.
	if _, err := tx.ExecContext(ctx, `
		SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))
	`, tenantID, statDate); err != nil {
		return 0, fmt.Errorf("lock tenant date: %w", err)
	}

	sources, err := countSources(ctx, tx, tenantID, statDate)
	if err != nil {
		return 0, fmt.Errorf("count aggregate sources: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM content_daily_stats
		WHERE tenant_id = $1 AND stat_date = $2::date
	`, tenantID, statDate); err != nil {
		return 0, fmt.Errorf("delete previous stats: %w", err)
	}

	inserted, err := tx.ExecContext(ctx, insertStatsSQL, tenantID, statDate)
	if err != nil {
		return 0, fmt.Errorf("insert rebuilt stats: %w", err)
	}
	rowCount, err := inserted.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("count inserted stats: %w", err)
	}
	// A source row must yield at least one non-zero aggregate row. This catches
	// accidental empty reads before the transaction deletes good prior stats.
	if sources.total() > 0 && rowCount == 0 {
		return 0, fmt.Errorf("aggregate produced no rows from %d source rows", sources.total())
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rowCount, nil
}

type sourceCounts struct {
	events    int64
	purchases int64
}

func (s sourceCounts) total() int64 {
	return s.events + s.purchases
}

func countSources(ctx context.Context, tx *sql.Tx, tenantID uuid.UUID, statDate string) (sourceCounts, error) {
	var counts sourceCounts
	err := tx.QueryRowContext(ctx, `
		SELECT
			(SELECT count(*)
			 FROM content_events
			 WHERE tenant_id = $1
			   AND occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
			   AND occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
			   AND event_type IN ('episode_view', 'series_view', 'episode_complete', 'rating', 'favorite')),
			(SELECT count(*)
			 FROM purchases
			 WHERE tenant_id = $1
			   AND purchased_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
			   AND purchased_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC'))
	`, tenantID, statDate).Scan(&counts.events, &counts.purchases)
	return counts, err
}

const insertStatsSQL = `
WITH episode_events AS (
	SELECT
		ce.episode_id AS entity_id,
		count(*) FILTER (WHERE ce.event_type = 'episode_view') AS view_count,
		count(DISTINCT ce.actor_key) FILTER (WHERE ce.event_type = 'episode_view') AS unique_viewer_count,
		count(*) FILTER (WHERE ce.event_type = 'episode_view' AND ce.user_id IS NOT NULL) AS member_view_count,
		count(*) FILTER (WHERE ce.event_type = 'episode_complete') AS complete_count,
		count(*) FILTER (WHERE ce.event_type = 'rating') AS rating_count,
		COALESCE(sum(ce.rating_score) FILTER (WHERE ce.event_type = 'rating'), 0) AS rating_sum
	FROM content_events ce
	JOIN episodes e ON e.tenant_id = ce.tenant_id AND e.id = ce.episode_id
	WHERE ce.tenant_id = $1
		AND ce.occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
		AND ce.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
		AND ce.event_type IN ('episode_view', 'episode_complete', 'rating')
		AND ce.episode_id IS NOT NULL
	GROUP BY ce.episode_id
), purchases_by_episode AS (
	SELECT p.episode_id AS entity_id, count(*) AS purchase_count
	FROM purchases p
	JOIN episodes e ON e.tenant_id = p.tenant_id AND e.id = p.episode_id
	WHERE p.tenant_id = $1
		AND p.purchased_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
		AND p.purchased_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
	GROUP BY p.episode_id
), episode_stats AS (
	SELECT
		COALESCE(ee.entity_id, pe.entity_id) AS entity_id,
		COALESCE(ee.view_count, 0) AS view_count,
		COALESCE(ee.unique_viewer_count, 0) AS unique_viewer_count,
		COALESCE(ee.member_view_count, 0) AS member_view_count,
		COALESCE(pe.purchase_count, 0) AS purchase_count,
		COALESCE(ee.complete_count, 0) AS complete_count,
		COALESCE(ee.rating_count, 0) AS rating_count,
		COALESCE(ee.rating_sum, 0) AS rating_sum
	FROM episode_events ee
	FULL OUTER JOIN purchases_by_episode pe ON pe.entity_id = ee.entity_id
), series_direct_stats AS (
	SELECT
		ce.series_id AS entity_id,
		count(*) FILTER (WHERE ce.event_type = 'series_view') AS view_count,
		count(*) FILTER (WHERE ce.event_type = 'rating') AS rating_count,
		COALESCE(sum(ce.rating_score) FILTER (WHERE ce.event_type = 'rating'), 0) AS rating_sum,
		count(*) FILTER (WHERE ce.event_type = 'favorite') AS favorite_count
	FROM content_events ce
	WHERE ce.tenant_id = $1
		AND ce.occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
		AND ce.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
		AND (
			ce.event_type IN ('series_view', 'favorite')
			OR (ce.event_type = 'rating' AND ce.episode_id IS NULL)
		)
	GROUP BY ce.series_id
), series_episode_rollup AS (
	SELECT
		e.series_id AS entity_id,
		sum(es.view_count) AS view_count,
		sum(es.member_view_count) AS member_view_count,
		sum(es.purchase_count) AS purchase_count,
		sum(es.complete_count) AS complete_count,
		sum(es.rating_count) AS rating_count,
		sum(es.rating_sum) AS rating_sum
	FROM episode_stats es
	JOIN episodes e ON e.id = es.entity_id AND e.tenant_id = $1
	GROUP BY e.series_id
), series_viewers AS (
	SELECT e.series_id AS entity_id, ce.actor_key
	FROM content_events ce
	JOIN episodes e ON e.tenant_id = ce.tenant_id AND e.id = ce.episode_id
	WHERE ce.tenant_id = $1
		AND ce.occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
		AND ce.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
		AND ce.event_type = 'episode_view'
	UNION
	SELECT ce.series_id AS entity_id, ce.actor_key
	FROM content_events ce
	WHERE ce.tenant_id = $1
		AND ce.occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
		AND ce.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
		AND ce.event_type = 'series_view'
), series_viewer_counts AS (
	SELECT entity_id, count(*) AS unique_viewer_count
	FROM series_viewers
	GROUP BY entity_id
), series_entities AS (
	SELECT entity_id FROM series_direct_stats
	UNION
	SELECT entity_id FROM series_episode_rollup
	UNION
	SELECT entity_id FROM series_viewer_counts
), rebuilt_stats AS (
	SELECT
		'episode'::text AS entity_type,
		entity_id,
		view_count,
		unique_viewer_count,
		member_view_count,
		purchase_count,
		complete_count,
		rating_count,
		rating_sum,
		0::bigint AS favorite_count
	FROM episode_stats
	UNION ALL
	SELECT
		'series'::text AS entity_type,
		se.entity_id,
		COALESCE(sd.view_count, 0) + COALESCE(sr.view_count, 0) AS view_count,
		COALESCE(sv.unique_viewer_count, 0) AS unique_viewer_count,
		COALESCE(sr.member_view_count, 0) AS member_view_count,
		COALESCE(sr.purchase_count, 0) AS purchase_count,
		COALESCE(sr.complete_count, 0) AS complete_count,
		COALESCE(sd.rating_count, 0) + COALESCE(sr.rating_count, 0) AS rating_count,
		COALESCE(sd.rating_sum, 0) + COALESCE(sr.rating_sum, 0) AS rating_sum,
		COALESCE(sd.favorite_count, 0) AS favorite_count
	FROM series_entities se
	LEFT JOIN series_direct_stats sd ON sd.entity_id = se.entity_id
	LEFT JOIN series_episode_rollup sr ON sr.entity_id = se.entity_id
	LEFT JOIN series_viewer_counts sv ON sv.entity_id = se.entity_id
)
INSERT INTO content_daily_stats (
	id, tenant_id, stat_date, entity_type, entity_id,
	view_count, unique_viewer_count, member_view_count, purchase_count, complete_count,
	rating_count, rating_sum, favorite_count
)
SELECT
	gen_random_uuid(), $1, $2::date, entity_type, entity_id,
	view_count, unique_viewer_count, member_view_count, purchase_count, complete_count,
	rating_count, rating_sum, favorite_count
FROM rebuilt_stats
WHERE view_count > 0
	OR unique_viewer_count > 0
	OR member_view_count > 0
	OR purchase_count > 0
	OR complete_count > 0
	OR rating_count > 0
	OR rating_sum > 0
	OR favorite_count > 0
`
