package contentstats

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

func TestRunRebuildsDailyStatsPerTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	statDate := time.Date(2026, time.August, 28, 0, 0, 0, 0, time.UTC)
	tenant := pg.SeedTenant(t, "STATSTENANT1", "stats.example.com", "Stats Tenant")
	otherTenant := pg.SeedTenant(t, "STATSTENANT2", "other-stats.example.com", "Other Stats Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "STATSERIES01"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "STATSEP001"})
	secondEpisode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "STATSEP002"})
	otherSeries := pg.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "OTHERSTATS01"})
	otherEpisode := pg.SeedEpisode(t, otherTenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "OTHEREP001"})
	firstViewer := pg.SeedEndUser(t, tenant.ID, "STATSVIEW001", "viewer1@stats.example.com", "Viewer One")
	secondViewer := pg.SeedEndUser(t, tenant.ID, "STATSVIEW002", "viewer2@stats.example.com", "Viewer Two")
	otherViewer := pg.SeedEndUser(t, otherTenant.ID, "OTHERVIEWER1", "viewer@other-stats.example.com", "Other Viewer")

	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: firstViewer.ID, seriesID: series.ID, episodeID: episode.ID, debounceBucket: 1, occurredAt: statDate.Add(time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: firstViewer.ID, seriesID: series.ID, episodeID: episode.ID, debounceBucket: 2, occurredAt: statDate.Add(2 * time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: secondViewer.ID, seriesID: series.ID, episodeID: episode.ID, debounceBucket: 3, occurredAt: statDate.Add(3 * time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: firstViewer.ID, seriesID: series.ID, episodeID: secondEpisode.ID, debounceBucket: 4, occurredAt: statDate.Add(4 * time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "series_view", userID: firstViewer.ID, seriesID: series.ID, debounceBucket: 5, occurredAt: statDate.Add(5 * time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "rating", userID: firstViewer.ID, seriesID: series.ID, ratingScore: 5, occurredAt: statDate.Add(6 * time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "rating", userID: firstViewer.ID, seriesID: series.ID, episodeID: episode.ID, ratingScore: 2, occurredAt: statDate.Add(7 * time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "rating", userID: secondViewer.ID, seriesID: series.ID, episodeID: episode.ID, ratingScore: 3, occurredAt: statDate.Add(8 * time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "favorite", userID: secondViewer.ID, seriesID: series.ID, occurredAt: statDate.Add(9 * time.Hour)})
	// An anonymous read of the same episode: it counts as a view, but it can
	// never become a completion, so it must stay out of member_view_count.
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", anonymousID: uuid.Must(uuid.NewV7()), seriesID: series.ID, episodeID: episode.ID, debounceBucket: 6, occurredAt: statDate.Add(9*time.Hour + 30*time.Minute)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_complete", userID: firstViewer.ID, seriesID: series.ID, episodeID: episode.ID, occurredAt: statDate.Add(9*time.Hour + 40*time.Minute)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_complete", userID: secondViewer.ID, seriesID: series.ID, episodeID: episode.ID, occurredAt: statDate.Add(9*time.Hour + 50*time.Minute)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_complete", userID: firstViewer.ID, seriesID: series.ID, episodeID: secondEpisode.ID, occurredAt: statDate.Add(9*time.Hour + 55*time.Minute)})
	insertPurchase(t, pg.DB, tenant.ID, firstViewer.ID, episode.ID, statDate.Add(10*time.Hour))
	insertPurchase(t, pg.DB, tenant.ID, secondViewer.ID, episode.ID, statDate.Add(11*time.Hour))
	insertEvent(t, pg.DB, eventSeed{tenantID: otherTenant.ID, eventType: "episode_view", userID: otherViewer.ID, seriesID: otherSeries.ID, episodeID: otherEpisode.ID, debounceBucket: 1, occurredAt: statDate.Add(time.Hour)})

	aggregator := New(pg.OpenPlatformDB(t))
	result, err := aggregator.Run(context.Background(), statDate)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result != (Result{TenantCount: 2, RowCount: 5}) {
		t.Fatalf("result = %+v, want %+v", result, Result{TenantCount: 2, RowCount: 5})
	}

	stats := loadStats(t, pg.DB, statDate)
	assertStat(t, stats, tenant.ID, "episode", episode.ID, stat{viewCount: 4, uniqueViewerCount: 3, memberViewCount: 3, purchaseCount: 2, completeCount: 2, ratingCount: 2, ratingSum: 5})
	assertStat(t, stats, tenant.ID, "episode", secondEpisode.ID, stat{viewCount: 1, uniqueViewerCount: 1, memberViewCount: 1, completeCount: 1})
	// The same reader viewed the series and two episodes, so the series rollup
	// must union actors rather than summing the per-episode distinct counts.
	// member_view_count rolls up the episode views only: a series_view is not
	// a view of anything a member could finish, so putting it in the
	// denominator would make the series read-through rate lower than the
	// episodes it is made of.
	assertStat(t, stats, tenant.ID, "series", series.ID, stat{viewCount: 6, uniqueViewerCount: 3, memberViewCount: 4, purchaseCount: 2, completeCount: 3, ratingCount: 3, ratingSum: 10, favoriteCount: 1})
	assertStat(t, stats, otherTenant.ID, "episode", otherEpisode.ID, stat{viewCount: 1, uniqueViewerCount: 1, memberViewCount: 1})
	assertStat(t, stats, otherTenant.ID, "series", otherSeries.ID, stat{viewCount: 1, uniqueViewerCount: 1, memberViewCount: 1})

	// A second full rebuild must replace, not duplicate, the same day's rows.
	result, err = aggregator.Run(context.Background(), statDate)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if result != (Result{TenantCount: 2, RowCount: 5}) {
		t.Fatalf("second result = %+v, want %+v", result, Result{TenantCount: 2, RowCount: 5})
	}
	if got := len(loadStats(t, pg.DB, statDate)); got != 5 {
		t.Fatalf("daily stats rows after rebuild = %d, want 5", got)
	}
}

func TestRunRejectsTenantScopedRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SeedTenant(t, "STATSRLS001", "rls-stats.example.com", "RLS Stats")

	_, err := New(pg.OpenAdminDB(t)).Run(context.Background(), time.Date(2026, time.August, 28, 0, 0, 0, 0, time.UTC))
	if err == nil || !strings.Contains(err.Error(), "BYPASSRLS") {
		t.Fatalf("Run error = %v, want BYPASSRLS requirement", err)
	}
}

func TestSourceQueriesHaveEligibleIndexes(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "STATSPLAN001", "plan-stats.example.com", "Plan Stats")
	statDate := "2026-08-28"

	assertPlanUsesIndex(t, pg.DB, `
		SELECT *
		FROM content_events
		WHERE tenant_id = $1
			AND occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
			AND occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
			AND event_type IN ('episode_view', 'series_view', 'episode_complete', 'rating', 'favorite')
	`, tenant.ID, statDate, "idx_content_events_tenant_type_occurred_at")
	assertPlanUsesIndex(t, pg.DB, `
		SELECT episode_id, count(*)
		FROM purchases
		WHERE tenant_id = $1
			AND purchased_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
			AND purchased_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
		GROUP BY episode_id
	`, tenant.ID, statDate, "idx_purchases_tenant_purchased_at_episode")
}

func assertPlanUsesIndex(t *testing.T, db *sql.DB, query string, tenantID uuid.UUID, statDate, index string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin explain transaction: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatalf("disable sequential scans: %v", err)
	}
	rows, err := tx.QueryContext(ctx, "EXPLAIN (COSTS OFF) "+query, tenantID, statDate)
	if err != nil {
		t.Fatalf("explain query: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("scan plan: %v", err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate plan: %v", err)
	}
	if !strings.Contains(plan.String(), index) {
		t.Fatalf("plan does not use %s:\n%s", index, plan.String())
	}
}

type eventSeed struct {
	tenantID  uuid.UUID
	eventType string
	// Exactly one of userID / anonymousID identifies the actor, the way
	// content_events' own actor check requires.
	userID         uuid.UUID
	anonymousID    uuid.UUID
	seriesID       uuid.UUID
	episodeID      uuid.UUID
	debounceBucket int64
	ratingScore    int16
	occurredAt     time.Time
}

func insertEvent(t *testing.T, db *sql.DB, seed eventSeed) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var episodeID any
	if seed.episodeID != uuid.Nil {
		episodeID = seed.episodeID
	}
	var userID any
	if seed.userID != uuid.Nil {
		userID = seed.userID
	}
	var anonymousID any
	if seed.anonymousID != uuid.Nil {
		anonymousID = seed.anonymousID
	}
	var debounceBucket any
	if seed.debounceBucket != 0 {
		debounceBucket = seed.debounceBucket
	}
	var ratingScore any
	if seed.ratingScore != 0 {
		ratingScore = seed.ratingScore
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, anonymous_id, series_id, episode_id,
			debounce_bucket, rating_score, occurred_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.eventType, userID, anonymousID, seed.seriesID, episodeID, debounceBucket, ratingScore, seed.occurredAt); err != nil {
		t.Fatalf("insert %s event: %v", seed.eventType, err)
	}
}

func insertPurchase(t *testing.T, db *sql.DB, tenantID, userID, episodeID uuid.UUID, purchasedAt time.Time) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at)
		VALUES ($1, $2, $3, $4, 100, $5)
	`, uuid.Must(uuid.NewV7()), tenantID, userID, episodeID, purchasedAt); err != nil {
		t.Fatalf("insert purchase: %v", err)
	}
}

type stat struct {
	viewCount         int64
	uniqueViewerCount int64
	memberViewCount   int64
	purchaseCount     int64
	completeCount     int64
	ratingCount       int64
	ratingSum         int64
	favoriteCount     int64
}

type statKey struct {
	tenantID   uuid.UUID
	entityType string
	entityID   uuid.UUID
}

func loadStats(t *testing.T, db *sql.DB, statDate time.Time) map[statKey]stat {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `
		SELECT tenant_id, entity_type, entity_id, view_count, unique_viewer_count,
			member_view_count, purchase_count, complete_count, rating_count,
			rating_sum, favorite_count
		FROM content_daily_stats
		WHERE stat_date = $1
	`, statDate.Format(time.DateOnly))
	if err != nil {
		t.Fatalf("list stats: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	stats := make(map[statKey]stat)
	for rows.Next() {
		var key statKey
		var value stat
		if err := rows.Scan(&key.tenantID, &key.entityType, &key.entityID,
			&value.viewCount, &value.uniqueViewerCount, &value.memberViewCount,
			&value.purchaseCount, &value.completeCount, &value.ratingCount,
			&value.ratingSum, &value.favoriteCount); err != nil {
			t.Fatalf("scan stat: %v", err)
		}
		stats[key] = value
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate stats: %v", err)
	}
	return stats
}

func assertStat(t *testing.T, stats map[statKey]stat, tenantID uuid.UUID, entityType string, entityID uuid.UUID, want stat) {
	t.Helper()
	key := statKey{tenantID: tenantID, entityType: entityType, entityID: entityID}
	if got, ok := stats[key]; !ok {
		t.Fatalf("missing stat for tenant=%s type=%s entity=%s", tenantID, entityType, entityID)
	} else if got != want {
		t.Fatalf("stat for tenant=%s type=%s entity=%s = %+v, want %+v", tenantID, entityType, entityID, got, want)
	}
}
