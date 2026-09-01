package recommendfeatures

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// referenceDate is the last day of every window these tests build, and
// windowDays is short enough that a seeded row can sit just outside it.
const (
	referenceDate = "2026-08-28"
	windowDays    = 7
	windowStart   = "2026-08-22"

	// staleViewCount marks a snapshot a test seeded before the run, so an
	// assertion can tell the row the run left alone from one it rebuilt.
	staleViewCount = 999
)

func TestRunBuildsFeatureSnapshotsPerTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "FEATTENANT01", "features.example.com", "Feature Tenant")
	otherTenant := pg.SeedTenant(t, "FEATTENANT02", "other-features.example.com", "Other Feature Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "FEATSERIES01"})
	secondSeries := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "FEATSERIES02"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "FEATEPISO001"})
	otherSeries := pg.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "FEATSERIES03"})
	otherEpisode := pg.SeedEpisode(t, otherTenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "FEATEPISO002"})
	reader := pg.SeedEndUser(t, tenant.ID, "FEATREADER01", "reader@features.example.com", "Feature Reader")
	idleReader := pg.SeedEndUser(t, tenant.ID, "FEATREADER02", "idle@features.example.com", "Idle Reader")
	otherReader := pg.SeedEndUser(t, otherTenant.ID, "FEATREADER03", "reader@other-features.example.com", "Other Reader")

	// A snapshot left by an earlier run must not survive this one: the idle
	// reader has no signal in the window, and the stale item is not in it.
	insertUserFeatures(t, pg.DB, tenant.ID, idleReader.ID)
	insertItemFeatures(t, pg.DB, tenant.ID, "series", secondSeries.ID)

	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: "2026-08-22", entityType: "episode", entityID: episode.ID, viewCount: 10, uniqueViewerCount: 5, purchaseCount: 1, ratingCount: 1, ratingSum: 4})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: "2026-08-28", entityType: "episode", entityID: episode.ID, viewCount: 4, uniqueViewerCount: 3})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: "2026-08-25", entityType: "series", entityID: series.ID, viewCount: 20, uniqueViewerCount: 8, purchaseCount: 1, ratingCount: 2, ratingSum: 9, favoriteCount: 3})
	// One day before the window opens: it must not reach the snapshot.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: "2026-08-21", entityType: "episode", entityID: episode.ID, viewCount: 100, uniqueViewerCount: 90})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: otherTenant.ID, statDate: "2026-08-26", entityType: "episode", entityID: otherEpisode.ID, viewCount: 2, uniqueViewerCount: 2})

	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: reader.ID, seriesID: series.ID, episodeID: episode.ID, debounceBucket: 1, occurredAt: at("2026-08-23T01:00:00Z")})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: reader.ID, seriesID: series.ID, episodeID: episode.ID, debounceBucket: 2, occurredAt: at("2026-08-24T01:00:00Z")})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "series_view", userID: reader.ID, seriesID: series.ID, debounceBucket: 3, occurredAt: at("2026-08-25T01:00:00Z")})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "rating", userID: reader.ID, seriesID: series.ID, episodeID: episode.ID, ratingScore: 4, occurredAt: at("2026-08-26T01:00:00Z")})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "purchase", userID: reader.ID, seriesID: series.ID, episodeID: episode.ID, occurredAt: at("2026-08-26T02:00:00Z")})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "series_view", userID: reader.ID, seriesID: secondSeries.ID, debounceBucket: 4, occurredAt: at("2026-08-27T01:00:00Z")})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "favorite", userID: reader.ID, seriesID: secondSeries.ID, occurredAt: at("2026-08-27T02:00:00Z")})
	// Before the window, and an anonymous actor that has no user row to key on.
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: reader.ID, seriesID: series.ID, episodeID: episode.ID, debounceBucket: 5, occurredAt: at("2026-08-20T01:00:00Z")})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", anonymousID: uuid.Must(uuid.NewV7()), seriesID: series.ID, episodeID: episode.ID, debounceBucket: 6, occurredAt: at("2026-08-25T03:00:00Z")})
	insertEvent(t, pg.DB, eventSeed{tenantID: otherTenant.ID, eventType: "episode_view", userID: otherReader.ID, seriesID: otherSeries.ID, episodeID: otherEpisode.ID, debounceBucket: 1, occurredAt: at("2026-08-26T01:00:00Z")})

	builder := New(pg.OpenPlatformDB(t))
	want := Result{TenantCount: 2, UserRowCount: 2, ItemRowCount: 3}
	result, err := builder.Run(context.Background(), buildOptions())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}

	items := loadItemFeatures(t, pg.DB)
	assertItem(t, items, itemKey{tenantID: tenant.ID, entityType: "episode", entityID: episode.ID}, itemFeatures{
		WindowDays: windowDays, WindowStart: windowStart, WindowEnd: referenceDate,
		ViewCount: 14, ViewerDays: 8, PurchaseCount: 1, RatingCount: 1, RatingSum: 4,
		ActiveDays: 2, LastActiveDate: "2026-08-28",
	})
	assertItem(t, items, itemKey{tenantID: tenant.ID, entityType: "series", entityID: series.ID}, itemFeatures{
		WindowDays: windowDays, WindowStart: windowStart, WindowEnd: referenceDate,
		ViewCount: 20, ViewerDays: 8, PurchaseCount: 1, RatingCount: 2, RatingSum: 9, FavoriteCount: 3,
		ActiveDays: 1, LastActiveDate: "2026-08-25",
	})
	assertItem(t, items, itemKey{tenantID: otherTenant.ID, entityType: "episode", entityID: otherEpisode.ID}, itemFeatures{
		WindowDays: windowDays, WindowStart: windowStart, WindowEnd: referenceDate,
		ViewCount: 2, ViewerDays: 2, ActiveDays: 1, LastActiveDate: "2026-08-26",
	})
	if _, ok := items[itemKey{tenantID: tenant.ID, entityType: "series", entityID: secondSeries.ID}]; ok {
		t.Fatal("stale item snapshot survived a rebuild")
	}

	users := loadUserFeatures(t, pg.DB)
	assertUser(t, users, userKey{tenantID: tenant.ID, userID: reader.ID}, userFeatures{
		WindowDays: windowDays, WindowStart: windowStart, WindowEnd: referenceDate,
		EventCount: 7, ViewCount: 4, PurchaseCount: 1, RatingCount: 1, RatingSum: 4, FavoriteCount: 1,
		SeriesCount: 2, LastEventAt: "2026-08-27T02:00:00Z",
		TopSeries: []topSeriesEntry{
			{SeriesID: series.ID, EventCount: 5, ViewCount: 3, PurchaseCount: 1, RatingCount: 1, RatingSum: 4, LastEventAt: "2026-08-26T02:00:00Z"},
			{SeriesID: secondSeries.ID, EventCount: 2, ViewCount: 1, FavoriteCount: 1, LastEventAt: "2026-08-27T02:00:00Z"},
		},
	})
	assertUser(t, users, userKey{tenantID: otherTenant.ID, userID: otherReader.ID}, userFeatures{
		WindowDays: windowDays, WindowStart: windowStart, WindowEnd: referenceDate,
		EventCount: 1, ViewCount: 1, SeriesCount: 1, LastEventAt: "2026-08-26T01:00:00Z",
		TopSeries: []topSeriesEntry{
			{SeriesID: otherSeries.ID, EventCount: 1, ViewCount: 1, LastEventAt: "2026-08-26T01:00:00Z"},
		},
	})
	if _, ok := users[userKey{tenantID: tenant.ID, userID: idleReader.ID}]; ok {
		t.Fatal("stale user snapshot survived a rebuild")
	}

	// A second run must replace the same snapshot rather than duplicate it.
	result, err = builder.Run(context.Background(), buildOptions())
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if result != want {
		t.Fatalf("second result = %+v, want %+v", result, want)
	}
	if got := len(loadItemFeatures(t, pg.DB)); got != 3 {
		t.Fatalf("item feature rows after rebuild = %d, want 3", got)
	}
	if got := len(loadUserFeatures(t, pg.DB)); got != 2 {
		t.Fatalf("user feature rows after rebuild = %d, want 2", got)
	}
}

func TestRunTruncatesTheAffinityListToTheConfiguredLimit(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "FEATTOPN0001", "topn-features.example.com", "Top-N Feature Tenant")
	quiet := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "FEATTOPNSER1"})
	busy := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "FEATTOPNSER2"})
	reader := pg.SeedEndUser(t, tenant.ID, "FEATTOPNRDR1", "reader@topn-features.example.com", "Top-N Reader")

	// The quieter series is seeded first and sorts earlier by id, so only the
	// event count can put the busy one at the head of the list.
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "series_view", userID: reader.ID, seriesID: quiet.ID, debounceBucket: 1, occurredAt: at("2026-08-23T01:00:00Z")})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "series_view", userID: reader.ID, seriesID: busy.ID, debounceBucket: 2, occurredAt: at("2026-08-24T01:00:00Z")})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "series_view", userID: reader.ID, seriesID: busy.ID, debounceBucket: 3, occurredAt: at("2026-08-25T01:00:00Z")})

	options := buildOptions()
	options.TopSeriesLimit = 1
	if _, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), options); err != nil {
		t.Fatalf("Run: %v", err)
	}

	// The totals still span both series; only top_series is truncated.
	assertUser(t, loadUserFeatures(t, pg.DB), userKey{tenantID: tenant.ID, userID: reader.ID}, userFeatures{
		WindowDays: windowDays, WindowStart: windowStart, WindowEnd: referenceDate,
		EventCount: 3, ViewCount: 3, SeriesCount: 2, LastEventAt: "2026-08-25T01:00:00Z",
		TopSeries: []topSeriesEntry{
			{SeriesID: busy.ID, EventCount: 2, ViewCount: 2, LastEventAt: "2026-08-25T01:00:00Z"},
		},
	})
}

func TestRunLeavesEmptySnapshotsForATenantWithoutSignal(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SeedTenant(t, "FEATEMPTY001", "empty-features.example.com", "Empty Feature Tenant")

	result, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), buildOptions())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := (Result{TenantCount: 1}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
}

func TestRunBuildsTheRemainingTenantsAfterOneFails(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Tenant ids are UUIDv7 and Run walks them in id order, so the tenant
	// seeded first is the one that fails first: anything the second tenant
	// ends up with was written after that failure.
	broken := pg.SeedTenant(t, "FEATBROKEN01", "broken-features.example.com", "Broken Feature Tenant")
	healthy := pg.SeedTenant(t, "FEATHEALTHY1", "healthy-features.example.com", "Healthy Feature Tenant")
	brokenSeries := pg.SeedSeries(t, broken.ID, testutil.SeriesSeed{PublicID: "FEATBROKSER1"})
	healthySeries := pg.SeedSeries(t, healthy.ID, testutil.SeriesSeed{PublicID: "FEATHEALSER1"})
	healthyReader := pg.SeedEndUser(t, healthy.ID, "FEATHEALRDR1", "reader@healthy-features.example.com", "Healthy Reader")

	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: broken.ID, statDate: referenceDate, entityType: "series", entityID: brokenSeries.ID, viewCount: 5, uniqueViewerCount: 2})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: healthy.ID, statDate: referenceDate, entityType: "series", entityID: healthySeries.ID, viewCount: 2, uniqueViewerCount: 1})
	insertEvent(t, pg.DB, eventSeed{tenantID: healthy.ID, eventType: "series_view", userID: healthyReader.ID, seriesID: healthySeries.ID, debounceBucket: 1, occurredAt: at("2026-08-26T01:00:00Z")})

	// The failing tenant already has a snapshot, which its transaction deletes
	// before the rejected insert. Finding it unchanged afterwards is what
	// proves the failure rolled the deletion back rather than leaving the
	// tenant with no features at all.
	insertItemFeatures(t, pg.DB, broken.ID, "series", brokenSeries.ID)

	rejectItemFeaturesForTenants(t, pg.DB, broken.ID)

	result, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), buildOptions())
	if err == nil || !strings.Contains(err.Error(), broken.ID.String()) {
		t.Fatalf("Run error = %v, want a failure naming tenant %s", err, broken.ID)
	}
	if want := (Result{TenantCount: 1, UserRowCount: 1, ItemRowCount: 1}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}

	items := loadItemFeatures(t, pg.DB)
	assertItem(t, items, itemKey{tenantID: broken.ID, entityType: "series", entityID: brokenSeries.ID}, itemFeatures{
		ViewCount: staleViewCount,
	})
	assertItem(t, items, itemKey{tenantID: healthy.ID, entityType: "series", entityID: healthySeries.ID}, itemFeatures{
		WindowDays: windowDays, WindowStart: windowStart, WindowEnd: referenceDate,
		ViewCount: 2, ViewerDays: 1, ActiveDays: 1, LastActiveDate: referenceDate,
	})
	assertUser(t, loadUserFeatures(t, pg.DB), userKey{tenantID: healthy.ID, userID: healthyReader.ID}, userFeatures{
		WindowDays: windowDays, WindowStart: windowStart, WindowEnd: referenceDate,
		EventCount: 1, ViewCount: 1, SeriesCount: 1, LastEventAt: "2026-08-26T01:00:00Z",
		TopSeries: []topSeriesEntry{
			{SeriesID: healthySeries.ID, EventCount: 1, ViewCount: 1, LastEventAt: "2026-08-26T01:00:00Z"},
		},
	})
}

func TestRunReportsEveryFailedTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	firstBroken := pg.SeedTenant(t, "FEATBROKEN02", "broken2-features.example.com", "First Broken Feature Tenant")
	secondBroken := pg.SeedTenant(t, "FEATBROKEN03", "broken3-features.example.com", "Second Broken Feature Tenant")
	healthy := pg.SeedTenant(t, "FEATHEALTHY2", "healthy2-features.example.com", "Healthy Feature Tenant")
	seedViewedSeries(t, pg, firstBroken.ID, "BRK2")
	seedViewedSeries(t, pg, secondBroken.ID, "BRK3")
	healthySeries := seedViewedSeries(t, pg, healthy.ID, "HLT2")

	rejectItemFeaturesForTenants(t, pg.DB, firstBroken.ID, secondBroken.ID)

	result, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), buildOptions())
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
	if want := (Result{TenantCount: 1, ItemRowCount: 1}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	items := loadItemFeatures(t, pg.DB)
	if got := len(items); got != 1 {
		t.Fatalf("item feature rows = %d, want the healthy tenant's 1", got)
	}
	assertItem(t, items, itemKey{tenantID: healthy.ID, entityType: "series", entityID: healthySeries}, itemFeatures{
		WindowDays: windowDays, WindowStart: windowStart, WindowEnd: referenceDate,
		ViewCount: 2, ViewerDays: 1, ActiveDays: 1, LastActiveDate: referenceDate,
	})
}

func TestRunStopsAtACancelledContext(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// The first tenant blocks on the advisory lock a concurrent run is holding
	// until the context deadline cancels the wait. The second must then be left
	// alone rather than tried and failed for the same expired context.
	blocked := pg.SeedTenant(t, "FEATBLOCK001", "blocked-features.example.com", "Blocked Feature Tenant")
	untried := pg.SeedTenant(t, "FEATUNTRIED1", "untried-features.example.com", "Untried Feature Tenant")
	seedViewedSeries(t, pg, untried.ID, "UNTR")

	holdTenantLock(t, pg.DB, blocked.ID.String()+":recommend-features")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result, err := New(pg.OpenPlatformDB(t)).Run(ctx, buildOptions())
	if err == nil || !strings.Contains(err.Error(), blocked.ID.String()) {
		t.Fatalf("Run error = %v, want a failure naming tenant %s", err, blocked.ID)
	}
	if strings.Contains(err.Error(), untried.ID.String()) {
		t.Fatalf("Run error = %v, want the tenants after the cancellation left untried", err)
	}
	if want := (Result{}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	if got := len(loadItemFeatures(t, pg.DB)); got != 0 {
		t.Fatalf("item feature rows = %d, want none", got)
	}
}

func TestRunRejectsTenantScopedRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SeedTenant(t, "FEATRLS00001", "rls-features.example.com", "RLS Feature Tenant")

	_, err := New(pg.OpenAdminDB(t)).Run(context.Background(), buildOptions())
	if err == nil || !strings.Contains(err.Error(), "BYPASSRLS") {
		t.Fatalf("Run error = %v, want BYPASSRLS requirement", err)
	}
}

func TestSourceQueriesHaveEligibleIndexes(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "FEATPLAN0001", "plan-features.example.com", "Plan Feature Tenant")

	// Both content_daily_stats indexes lead with (tenant_id, stat_date), so
	// either one answers the window scan; which of them the planner picks
	// depends on how much data the table holds.
	assertPlanUsesIndex(t, pg.DB, `
		SELECT *
		FROM content_daily_stats
		WHERE tenant_id = $1
			AND stat_date >= ($2::date - ($3::int - 1))
			AND stat_date <= $2::date
	`, tenant.ID, "idx_content_daily_stats_tenant_date", "idx_content_daily_stats_unique")
	assertPlanUsesIndex(t, pg.DB, `
		SELECT *
		FROM content_events
		WHERE tenant_id = $1
			AND user_id IS NOT NULL
			AND occurred_at >= (($2::date - ($3::int - 1))::timestamp AT TIME ZONE 'UTC')
			AND occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
	`, tenant.ID, "idx_content_events_tenant_user_occurred_at")
}

func buildOptions() Options {
	return Options{ReferenceDate: at(referenceDate + "T00:00:00Z"), WindowDays: windowDays}
}

func at(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return parsed
}

// assertPlanUsesIndex fails unless the plan reaches the rows through one of
// the named indexes rather than a sequential scan.
func assertPlanUsesIndex(t *testing.T, db *sql.DB, query string, tenantID uuid.UUID, indexes ...string) {
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
	rows, err := tx.QueryContext(ctx, "EXPLAIN (COSTS OFF) "+query, tenantID, referenceDate, windowDays)
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
	for _, index := range indexes {
		if strings.Contains(plan.String(), index) {
			return
		}
	}
	t.Fatalf("plan does not use any of %s:\n%s", strings.Join(indexes, ", "), plan.String())
}

type dailyStatSeed struct {
	tenantID          uuid.UUID
	statDate          string
	entityType        string
	entityID          uuid.UUID
	viewCount         int64
	uniqueViewerCount int64
	purchaseCount     int64
	ratingCount       int64
	ratingSum         int64
	favoriteCount     int64
}

func insertDailyStat(t *testing.T, db *sql.DB, seed dailyStatSeed) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_daily_stats (
			id, tenant_id, stat_date, entity_type, entity_id,
			view_count, unique_viewer_count, purchase_count, rating_count, rating_sum, favorite_count
		) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.statDate, seed.entityType, seed.entityID,
		seed.viewCount, seed.uniqueViewerCount, seed.purchaseCount,
		seed.ratingCount, seed.ratingSum, seed.favoriteCount); err != nil {
		t.Fatalf("insert daily stat: %v", err)
	}
}

type eventSeed struct {
	tenantID       uuid.UUID
	eventType      string
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

	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, anonymous_id, series_id, episode_id,
			debounce_bucket, rating_score, occurred_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.eventType,
		nullableUUID(seed.userID), nullableUUID(seed.anonymousID),
		seed.seriesID, nullableUUID(seed.episodeID),
		nullableInt64(seed.debounceBucket), nullableInt16(seed.ratingScore), seed.occurredAt); err != nil {
		t.Fatalf("insert %s event: %v", seed.eventType, err)
	}
}

func insertUserFeatures(t *testing.T, db *sql.DB, tenantID, userID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO user_recommend_features (tenant_id, user_id, features, feature_version)
		VALUES ($1, $2, '{"event_count": 999}'::jsonb, $3)
	`, tenantID, userID, FeatureVersion); err != nil {
		t.Fatalf("insert user features: %v", err)
	}
}

func insertItemFeatures(t *testing.T, db *sql.DB, tenantID uuid.UUID, entityType string, entityID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO item_recommend_features (tenant_id, entity_type, entity_id, features, feature_version)
		VALUES ($1, $2, $3, jsonb_build_object('view_count', $4::bigint), $5)
	`, tenantID, entityType, entityID, staleViewCount, FeatureVersion); err != nil {
		t.Fatalf("insert item features: %v", err)
	}
}

// seedViewedSeries gives one tenant a series with a day of engagement inside
// the window, which builds to exactly one item feature row and no user row.
func seedViewedSeries(t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, prefix string) uuid.UUID {
	t.Helper()
	series := pg.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: "FEATSER" + prefix})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenantID, statDate: referenceDate,
		entityType: "series", entityID: series.ID, viewCount: 2, uniqueViewerCount: 1})
	return series.ID
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

// rejectItemFeaturesForTenants makes every item feature insert for the named
// tenants fail, so a test can watch what the run does with the tenants around
// them.
func rejectItemFeaturesForTenants(t *testing.T, db *sql.DB, tenantIDs ...uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := db.ExecContext(ctx, `
		CREATE FUNCTION reject_item_features() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			RAISE EXCEPTION 'item features rejected by test trigger';
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
		CREATE TRIGGER reject_item_features
		BEFORE INSERT ON item_recommend_features
		FOR EACH ROW WHEN (NEW.tenant_id IN (%s))
		EXECUTE FUNCTION reject_item_features()
	`, strings.Join(quoted, ", "))); err != nil {
		t.Fatalf("create rejection trigger: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cancelCleanup := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelCleanup()
		if _, err := db.ExecContext(cleanupCtx, "DROP TRIGGER IF EXISTS reject_item_features ON item_recommend_features"); err != nil {
			t.Errorf("drop rejection trigger: %v", err)
		}
		if _, err := db.ExecContext(cleanupCtx, "DROP FUNCTION IF EXISTS reject_item_features()"); err != nil {
			t.Errorf("drop rejection function: %v", err)
		}
	})
}

func nullableUUID(value uuid.UUID) any {
	if value == uuid.Nil {
		return nil
	}
	return value
}

func nullableInt64(value int64) any {
	if value == 0 {
		return nil
	}
	return value
}

func nullableInt16(value int16) any {
	if value == 0 {
		return nil
	}
	return value
}

type itemKey struct {
	tenantID   uuid.UUID
	entityType string
	entityID   uuid.UUID
}

type itemFeatures struct {
	WindowDays     int    `json:"window_days"`
	WindowStart    string `json:"window_start"`
	WindowEnd      string `json:"window_end"`
	ViewCount      int64  `json:"view_count"`
	ViewerDays     int64  `json:"viewer_days"`
	PurchaseCount  int64  `json:"purchase_count"`
	RatingCount    int64  `json:"rating_count"`
	RatingSum      int64  `json:"rating_sum"`
	FavoriteCount  int64  `json:"favorite_count"`
	ActiveDays     int64  `json:"active_days"`
	LastActiveDate string `json:"last_active_date"`
}

type userKey struct {
	tenantID uuid.UUID
	userID   uuid.UUID
}

type topSeriesEntry struct {
	SeriesID      uuid.UUID `json:"series_id"`
	EventCount    int64     `json:"event_count"`
	ViewCount     int64     `json:"view_count"`
	PurchaseCount int64     `json:"purchase_count"`
	RatingCount   int64     `json:"rating_count"`
	RatingSum     int64     `json:"rating_sum"`
	FavoriteCount int64     `json:"favorite_count"`
	LastEventAt   string    `json:"last_event_at"`
}

type userFeatures struct {
	WindowDays    int              `json:"window_days"`
	WindowStart   string           `json:"window_start"`
	WindowEnd     string           `json:"window_end"`
	EventCount    int64            `json:"event_count"`
	ViewCount     int64            `json:"view_count"`
	PurchaseCount int64            `json:"purchase_count"`
	RatingCount   int64            `json:"rating_count"`
	RatingSum     int64            `json:"rating_sum"`
	FavoriteCount int64            `json:"favorite_count"`
	SeriesCount   int64            `json:"series_count"`
	LastEventAt   string           `json:"last_event_at"`
	TopSeries     []topSeriesEntry `json:"top_series"`
}

func loadItemFeatures(t *testing.T, db *sql.DB) map[itemKey]itemFeatures {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `
		SELECT tenant_id, entity_type, entity_id, features, feature_version
		FROM item_recommend_features
	`)
	if err != nil {
		t.Fatalf("list item features: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	features := make(map[itemKey]itemFeatures)
	for rows.Next() {
		var key itemKey
		var raw []byte
		var version int
		if err := rows.Scan(&key.tenantID, &key.entityType, &key.entityID, &raw, &version); err != nil {
			t.Fatalf("scan item features: %v", err)
		}
		if version != FeatureVersion {
			t.Fatalf("item feature_version = %d, want %d", version, FeatureVersion)
		}
		var value itemFeatures
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatalf("decode item features: %v", err)
		}
		features[key] = value
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate item features: %v", err)
	}
	return features
}

func loadUserFeatures(t *testing.T, db *sql.DB) map[userKey]userFeatures {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `
		SELECT tenant_id, user_id, features, feature_version
		FROM user_recommend_features
	`)
	if err != nil {
		t.Fatalf("list user features: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	features := make(map[userKey]userFeatures)
	for rows.Next() {
		var key userKey
		var raw []byte
		var version int
		if err := rows.Scan(&key.tenantID, &key.userID, &raw, &version); err != nil {
			t.Fatalf("scan user features: %v", err)
		}
		if version != FeatureVersion {
			t.Fatalf("user feature_version = %d, want %d", version, FeatureVersion)
		}
		var value userFeatures
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Fatalf("decode user features: %v", err)
		}
		features[key] = value
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate user features: %v", err)
	}
	return features
}

func assertItem(t *testing.T, features map[itemKey]itemFeatures, key itemKey, want itemFeatures) {
	t.Helper()
	got, ok := features[key]
	if !ok {
		t.Fatalf("missing item features for tenant=%s type=%s entity=%s", key.tenantID, key.entityType, key.entityID)
	}
	if got != want {
		t.Fatalf("item features for tenant=%s type=%s entity=%s = %+v, want %+v", key.tenantID, key.entityType, key.entityID, got, want)
	}
}

func assertUser(t *testing.T, features map[userKey]userFeatures, key userKey, want userFeatures) {
	t.Helper()
	got, ok := features[key]
	if !ok {
		t.Fatalf("missing user features for tenant=%s user=%s", key.tenantID, key.userID)
	}
	gotJSON, wantJSON := mustMarshal(t, got), mustMarshal(t, want)
	if gotJSON != wantJSON {
		t.Fatalf("user features for tenant=%s user=%s = %s, want %s", key.tenantID, key.userID, gotJSON, wantJSON)
	}
}

func mustMarshal(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode features: %v", err)
	}
	return string(encoded)
}
