package contentstats

import (
	"context"
	"database/sql"
	"fmt"
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

func TestRunAggregatesTheRemainingTenantsAfterOneFails(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	statDate := time.Date(2026, time.August, 28, 0, 0, 0, 0, time.UTC)
	// Tenant ids are UUIDv7 and Run walks them in id order, so the tenant
	// seeded first is the one that fails first: anything the second tenant
	// ends up with was written after that failure.
	broken := pg.SeedTenant(t, "STATSBROKEN1", "broken-stats.example.com", "Broken Stats Tenant")
	healthy := pg.SeedTenant(t, "STATSHEALTH1", "healthy-stats.example.com", "Healthy Stats Tenant")
	brokenSeries := pg.SeedSeries(t, broken.ID, testutil.SeriesSeed{PublicID: "STATSBROKSER"})
	brokenEpisode := pg.SeedEpisode(t, broken.ID, brokenSeries.ID, testutil.EpisodeSeed{PublicID: "STATSBROKEP1"})
	healthySeries := pg.SeedSeries(t, healthy.ID, testutil.SeriesSeed{PublicID: "STATSHEALSER"})
	healthyEpisode := pg.SeedEpisode(t, healthy.ID, healthySeries.ID, testutil.EpisodeSeed{PublicID: "STATSHEALEP1"})
	brokenViewer := pg.SeedEndUser(t, broken.ID, "STATSBROKVWR", "viewer@broken-stats.example.com", "Broken Viewer")
	healthyViewer := pg.SeedEndUser(t, healthy.ID, "STATSHEALVWR", "viewer@healthy-stats.example.com", "Healthy Viewer")

	insertEvent(t, pg.DB, eventSeed{tenantID: broken.ID, eventType: "episode_view", userID: brokenViewer.ID, seriesID: brokenSeries.ID, episodeID: brokenEpisode.ID, debounceBucket: 1, occurredAt: statDate.Add(time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: healthy.ID, eventType: "episode_view", userID: healthyViewer.ID, seriesID: healthySeries.ID, episodeID: healthyEpisode.ID, debounceBucket: 1, occurredAt: statDate.Add(time.Hour)})

	// The failing tenant already has a row for this day, which its transaction
	// deletes before the rejected insert. Finding it unchanged afterwards is
	// what proves the failure rolled the deletion back rather than leaving the
	// tenant with nothing at all.
	insertStaleStat(t, pg.DB, broken.ID, statDate, "episode", brokenEpisode.ID)

	rejectDailyStatsForTenants(t, pg.DB, broken.ID)

	result, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), statDate)
	if err == nil || !strings.Contains(err.Error(), broken.ID.String()) {
		t.Fatalf("Run error = %v, want a failure naming tenant %s", err, broken.ID)
	}
	if want := (Result{TenantCount: 1, RowCount: 2}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}

	stats := loadStats(t, pg.DB, statDate)
	assertStat(t, stats, broken.ID, "episode", brokenEpisode.ID, stat{viewCount: staleViewCount})
	if _, ok := stats[statKey{tenantID: broken.ID, entityType: "series", entityID: brokenSeries.ID}]; ok {
		t.Fatal("the failing tenant committed stats")
	}
	assertStat(t, stats, healthy.ID, "episode", healthyEpisode.ID, stat{viewCount: 1, uniqueViewerCount: 1, memberViewCount: 1})
	assertStat(t, stats, healthy.ID, "series", healthySeries.ID, stat{viewCount: 1, uniqueViewerCount: 1, memberViewCount: 1})
}

func TestRunReportsEveryFailedTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	statDate := time.Date(2026, time.August, 28, 0, 0, 0, 0, time.UTC)
	firstBroken := pg.SeedTenant(t, "STATSBROKEN2", "broken2-stats.example.com", "First Broken Stats Tenant")
	secondBroken := pg.SeedTenant(t, "STATSBROKEN3", "broken3-stats.example.com", "Second Broken Stats Tenant")
	healthy := pg.SeedTenant(t, "STATSHEALTH2", "healthy2-stats.example.com", "Healthy Stats Tenant")
	seedViewedEpisode(t, pg, firstBroken.ID, "BRK2", statDate)
	seedViewedEpisode(t, pg, secondBroken.ID, "BRK3", statDate)
	seedViewedEpisode(t, pg, healthy.ID, "HLT2", statDate)

	rejectDailyStatsForTenants(t, pg.DB, firstBroken.ID, secondBroken.ID)

	result, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), statDate)
	if err == nil {
		t.Fatal("Run error = nil, want failures for both broken tenants")
	}
	// Both ids have to be in the joined error: an operator reading the log
	// decides which tenants to rebuild from it, and a run that named only the
	// first would hide the second.
	for _, tenantID := range []uuid.UUID{firstBroken.ID, secondBroken.ID} {
		if !strings.Contains(err.Error(), tenantID.String()) {
			t.Errorf("Run error = %v, want it to name tenant %s", err, tenantID)
		}
	}
	if want := (Result{TenantCount: 1, RowCount: 2}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	if got := len(loadStats(t, pg.DB, statDate)); got != 2 {
		t.Fatalf("daily stats rows = %d, want the healthy tenant's 2", got)
	}
}

func TestRunStopsAtACancelledContext(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	statDate := time.Date(2026, time.August, 28, 0, 0, 0, 0, time.UTC)
	// The first tenant blocks on the advisory lock a concurrent run is holding
	// until the context deadline cancels the wait. The second must then be left
	// alone rather than tried and failed for the same expired context.
	blocked := pg.SeedTenant(t, "STATSBLOCK01", "blocked-stats.example.com", "Blocked Stats Tenant")
	untried := pg.SeedTenant(t, "STATSUNTRIED", "untried-stats.example.com", "Untried Stats Tenant")
	untriedSeries := pg.SeedSeries(t, untried.ID, testutil.SeriesSeed{PublicID: "STATSUNTRSER"})
	untriedEpisode := pg.SeedEpisode(t, untried.ID, untriedSeries.ID, testutil.EpisodeSeed{PublicID: "STATSUNTREPI"})
	untriedViewer := pg.SeedEndUser(t, untried.ID, "STATSUNTRVWR", "viewer@untried-stats.example.com", "Untried Viewer")
	insertEvent(t, pg.DB, eventSeed{tenantID: untried.ID, eventType: "episode_view", userID: untriedViewer.ID, seriesID: untriedSeries.ID, episodeID: untriedEpisode.ID, debounceBucket: 1, occurredAt: statDate.Add(time.Hour)})

	holdTenantLock(t, pg.DB, blocked.ID.String()+":"+statDate.Format(time.DateOnly))

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result, err := New(pg.OpenPlatformDB(t)).Run(ctx, statDate)
	if err == nil || !strings.Contains(err.Error(), blocked.ID.String()) {
		t.Fatalf("Run error = %v, want a failure naming tenant %s", err, blocked.ID)
	}
	if strings.Contains(err.Error(), untried.ID.String()) {
		t.Fatalf("Run error = %v, want the tenants after the cancellation left untried", err)
	}
	if want := (Result{}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	if got := len(loadStats(t, pg.DB, statDate)); got != 0 {
		t.Fatalf("daily stats rows = %d, want none", got)
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

// staleViewCount marks a stats row a test seeded before the run, so an
// assertion can tell the row the run left alone from one it rebuilt.
const staleViewCount = 999

// seedViewedEpisode gives one tenant a single episode view on statDate, which
// aggregates to exactly two rows: the episode and the series holding it.
func seedViewedEpisode(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, prefix string, statDate time.Time) {
	t.Helper()
	series := pg.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: "STATSSER" + prefix})
	episode := pg.SeedEpisode(t, tenantID, series.ID, testutil.EpisodeSeed{PublicID: "STATSEPI" + prefix})
	viewer := pg.SeedEndUser(t, tenantID, "STATSVWR"+prefix, "viewer-"+prefix+"@stats.example.com", "Viewer "+prefix)
	insertEvent(t, pg.DB, eventSeed{tenantID: tenantID, eventType: "episode_view", userID: viewer.ID,
		seriesID: series.ID, episodeID: episode.ID, debounceBucket: 1, occurredAt: statDate.Add(time.Hour)})
}

// insertStaleStat plants the row a previous run would have left behind, so a
// test can tell a rolled-back rebuild from one that deleted and never replaced.
func insertStaleStat(t *testing.T, db *sql.DB, tenantID uuid.UUID, statDate time.Time, entityType string, entityID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_daily_stats (id, tenant_id, stat_date, entity_type, entity_id, view_count)
		VALUES ($1, $2, $3::date, $4, $5, $6)
	`, uuid.Must(uuid.NewV7()), tenantID, statDate.Format(time.DateOnly), entityType, entityID, staleViewCount); err != nil {
		t.Fatalf("insert stale stat: %v", err)
	}
}

// holdTenantLock takes one batch's advisory lock on a connection of its own and
// keeps it for the rest of the test, standing in for a run that overlaps this
// one. A batch that asks for the same key waits until its context gives up.
func holdTenantLock(t *testing.T, db *sql.DB, key string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("open lock holder connection: %v", err)
	}
	// Session scoped rather than transaction scoped: nothing here commits, and
	// the lock has to outlive this call.
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock(hashtextextended($1::text, 0))", key); err != nil {
		t.Fatalf("take advisory lock: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cancelCleanup := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelCleanup()
		if _, err := conn.ExecContext(cleanupCtx, "SELECT pg_advisory_unlock(hashtextextended($1::text, 0))", key); err != nil {
			t.Errorf("release advisory lock: %v", err)
		}
		if err := conn.Close(); err != nil {
			t.Errorf("close lock holder connection: %v", err)
		}
	})
}

// rejectDailyStatsForTenants makes every stats insert for the named tenants
// fail, so a test can watch what the run does with the tenants around them.
func rejectDailyStatsForTenants(t *testing.T, db *sql.DB, tenantIDs ...uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := db.ExecContext(ctx, `
		CREATE FUNCTION reject_daily_stat() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			RAISE EXCEPTION 'daily stat rejected by test trigger';
		END;
		$$
	`); err != nil {
		t.Fatalf("create rejection function: %v", err)
	}
	quoted := make([]string, 0, len(tenantIDs))
	for _, tenantID := range tenantIDs {
		quoted = append(quoted, fmt.Sprintf("'%s'::uuid", tenantID))
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`
		CREATE TRIGGER reject_daily_stat
		BEFORE INSERT ON content_daily_stats
		FOR EACH ROW WHEN (NEW.tenant_id IN (%s))
		EXECUTE FUNCTION reject_daily_stat()
	`, strings.Join(quoted, ", "))); err != nil {
		t.Fatalf("create rejection trigger: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cancelCleanup := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelCleanup()
		if _, err := db.ExecContext(cleanupCtx, "DROP TRIGGER IF EXISTS reject_daily_stat ON content_daily_stats"); err != nil {
			t.Errorf("drop rejection trigger: %v", err)
		}
		if _, err := db.ExecContext(cleanupCtx, "DROP FUNCTION IF EXISTS reject_daily_stat()"); err != nil {
			t.Errorf("drop rejection function: %v", err)
		}
	})
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
