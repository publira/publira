package contentranking

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// referenceDate is the last day of every window these tests rank. The seeded
// days sit 0, 3, and 6 days before it, so each one's recency fade is an exact
// power of one half and the expected scores below stay readable.
const (
	referenceDate   = "2026-08-28"
	weeklyStartDate = "2026-08-22"
)

func TestRunBuildsRankingSnapshotsPerTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "RANKTENANT01", "rankings.example.com", "Ranking Tenant")
	otherTenant := pg.SeedTenant(t, "RANKTENANT02", "other-rankings.example.com", "Other Ranking Tenant")
	rated := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKSERIES01"})
	viewed := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKSERIES02"})
	bought := pg.SeedEpisode(t, tenant.ID, rated.ID, testutil.EpisodeSeed{PublicID: "RANKEPISO001"})
	older := pg.SeedEpisode(t, tenant.ID, viewed.ID, testutil.EpisodeSeed{PublicID: "RANKEPISO002"})
	otherSeries := pg.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "RANKSERIES03"})
	otherEpisode := pg.SeedEpisode(t, otherTenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "RANKEPISO003"})

	// 1*10 views + 2*6 viewers + 8*1 follow + 3*(9 - 3*2) rating bonus = 39.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: rated.ID,
		viewCount: 10, uniqueViewerCount: 6, ratingCount: 2, ratingSum: 9, favoriteCount: 1})
	// 1*30 views + 2*2 viewers = 34 today, plus a much bigger day six days back
	// that the weekly window fades to a quarter: (100 + 2*50) * 0.25 = 50.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: viewed.ID,
		viewCount: 30, uniqueViewerCount: 2})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: weeklyStartDate, entityType: "series", entityID: viewed.ID,
		viewCount: 100, uniqueViewerCount: 50})
	// 1*5 views + 2*3 viewers + 20*2 purchases = 51.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "episode", entityID: bought.ID,
		viewCount: 5, uniqueViewerCount: 3, purchaseCount: 2})
	// Three days back, so (4 + 2*4) * 0.5 = 6 in the weekly window and nothing
	// at all in the daily one.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: "2026-08-25", entityType: "episode", entityID: older.ID,
		viewCount: 4, uniqueViewerCount: 4})
	// One day before the weekly window opens: it must not reach any snapshot.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: "2026-08-21", entityType: "series", entityID: rated.ID,
		viewCount: 1000, uniqueViewerCount: 1000})
	// Only ratings, and none of them above neutral: nothing to rank.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "episode", entityID: older.ID,
		ratingCount: 2, ratingSum: 4})

	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: otherTenant.ID, statDate: referenceDate, entityType: "series", entityID: otherSeries.ID,
		viewCount: 2, uniqueViewerCount: 1})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: otherTenant.ID, statDate: referenceDate, entityType: "episode", entityID: otherEpisode.ID,
		viewCount: 1, uniqueViewerCount: 1})

	// A snapshot left by an earlier run must be replaced in place rather than
	// joined by a second row for the same period.
	insertStaleSnapshot(t, pg.DB, tenant.ID, DailyRankingKey, referenceDate, referenceDate, "series")

	aggregator := New(pg.OpenPlatformDB(t))
	want := Result{TenantCount: 2, SnapshotCount: 8, ItemCount: 11}
	result, err := aggregator.Run(context.Background(), runOptions())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}

	snapshots := loadSnapshots(t, pg.DB)
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "series"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: rated.ID, Score: 39, ViewCount: 10, ViewerDays: 6, RatingCount: 2, RatingSum: 9, FavoriteCount: 1, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: viewed.ID, Score: 34, ViewCount: 30, ViewerDays: 2, LastActiveDate: referenceDate},
		},
	})
	// The faded older day is what puts the viewed series ahead over a week.
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: WeeklyRankingKey, entityType: "series"}, snapshot{
		PeriodStart: weeklyStartDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: viewed.ID, Score: 84, ViewCount: 130, ViewerDays: 52, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: rated.ID, Score: 39, ViewCount: 10, ViewerDays: 6, RatingCount: 2, RatingSum: 9, FavoriteCount: 1, LastActiveDate: referenceDate},
		},
	})
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "episode"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: bought.ID, Score: 51, ViewCount: 5, ViewerDays: 3, PurchaseCount: 2, LastActiveDate: referenceDate},
		},
	})
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: WeeklyRankingKey, entityType: "episode"}, snapshot{
		PeriodStart: weeklyStartDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: bought.ID, Score: 51, ViewCount: 5, ViewerDays: 3, PurchaseCount: 2, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: older.ID, Score: 6, ViewCount: 4, ViewerDays: 4, RatingCount: 2, RatingSum: 4, LastActiveDate: referenceDate},
		},
	})
	assertSnapshot(t, snapshots, snapshotKey{tenantID: otherTenant.ID, rankingKey: DailyRankingKey, entityType: "series"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: otherSeries.ID, Score: 4, ViewCount: 2, ViewerDays: 1, LastActiveDate: referenceDate},
		},
	})

	// A second run must replace the same rows rather than duplicate them, and
	// must rank the unchanged stats exactly as the first run did.
	result, err = aggregator.Run(context.Background(), runOptions())
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if result != want {
		t.Fatalf("second result = %+v, want %+v", result, want)
	}
	rebuilt := loadSnapshots(t, pg.DB)
	if len(rebuilt) != len(snapshots) {
		t.Fatalf("snapshot rows after rebuild = %d, want %d", len(rebuilt), len(snapshots))
	}
	for key, before := range snapshots {
		assertSnapshot(t, rebuilt, key, before)
	}
}

func TestRunTruncatesItemsToTheConfiguredLimit(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "RANKLIMIT001", "limit-rankings.example.com", "Limit Ranking Tenant")
	quiet := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKLIMITS01"})
	busy := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKLIMITS02"})

	// The quieter series is seeded first and sorts earlier by id, so only the
	// score can put the busy one at the head of the leaderboard.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: quiet.ID,
		viewCount: 1, uniqueViewerCount: 1})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: busy.ID,
		viewCount: 9, uniqueViewerCount: 4})

	options := runOptions()
	options.ItemLimit = 1
	if _, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), options); err != nil {
		t.Fatalf("Run: %v", err)
	}

	assertSnapshot(t, loadSnapshots(t, pg.DB), snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "series"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: busy.ID, Score: 17, ViewCount: 9, ViewerDays: 4, LastActiveDate: referenceDate},
		},
	})
}

func TestRunWritesEmptySnapshotsForATenantWithoutSignal(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "RANKEMPTY001", "empty-rankings.example.com", "Empty Ranking Tenant")

	result, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), runOptions())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := (Result{TenantCount: 1, SnapshotCount: 4}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	// An empty leaderboard is written as an empty array, never as null, so a
	// reader can iterate it without a nil check.
	assertSnapshot(t, loadSnapshots(t, pg.DB), snapshotKey{tenantID: tenant.ID, rankingKey: WeeklyRankingKey, entityType: "series"}, snapshot{
		PeriodStart: weeklyStartDate, PeriodEnd: referenceDate, Items: []rankingItem{},
	})
}

func TestRunRejectsTenantScopedRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SeedTenant(t, "RANKRLS00001", "rls-rankings.example.com", "RLS Ranking Tenant")

	_, err := New(pg.OpenAdminDB(t)).Run(context.Background(), runOptions())
	if err == nil || !strings.Contains(err.Error(), "BYPASSRLS") {
		t.Fatalf("Run error = %v, want BYPASSRLS requirement", err)
	}
}

func TestSourceQueryHasAnEligibleIndex(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "RANKPLAN0001", "plan-rankings.example.com", "Plan Ranking Tenant")

	// Every content_daily_stats index leads with tenant_id, so any of them can
	// answer the window scan; which one the planner picks depends on how much
	// data the table holds.
	assertPlanUsesIndex(t, pg.DB, `
		SELECT *
		FROM content_daily_stats
		WHERE tenant_id = $1
			AND entity_type = $2
			AND stat_date >= $3::date
			AND stat_date <= $4::date
	`, tenant.ID,
		"idx_content_daily_stats_tenant_date",
		"idx_content_daily_stats_tenant_entity",
		"idx_content_daily_stats_unique")
}

func runOptions() Options {
	return Options{ReferenceDate: at(referenceDate)}
}

func at(date string) time.Time {
	parsed, err := time.Parse(time.DateOnly, date)
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
	rows, err := tx.QueryContext(ctx, "EXPLAIN (COSTS OFF) "+query, tenantID, "series", weeklyStartDate, referenceDate)
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

func insertStaleSnapshot(t *testing.T, db *sql.DB, tenantID uuid.UUID, rankingKey, periodStart, periodEnd, entityType string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_ranking_snapshots (
			id, tenant_id, ranking_key, period_start, period_end, entity_type, items, algorithm_version
		) VALUES ($1, $2, $3, $4::date, $5::date, $6, '[{"rank": 1, "score": 999}]'::jsonb, $7)
	`, uuid.Must(uuid.NewV7()), tenantID, rankingKey, periodStart, periodEnd, entityType, AlgorithmVersion); err != nil {
		t.Fatalf("insert stale snapshot: %v", err)
	}
}

type snapshotKey struct {
	tenantID   uuid.UUID
	rankingKey string
	entityType string
}

type rankingItem struct {
	Rank           int       `json:"rank"`
	EntityID       uuid.UUID `json:"entity_id"`
	Score          float64   `json:"score"`
	ViewCount      int64     `json:"view_count"`
	ViewerDays     int64     `json:"viewer_days"`
	PurchaseCount  int64     `json:"purchase_count"`
	RatingCount    int64     `json:"rating_count"`
	RatingSum      int64     `json:"rating_sum"`
	FavoriteCount  int64     `json:"favorite_count"`
	LastActiveDate string    `json:"last_active_date"`
}

type snapshot struct {
	PeriodStart string        `json:"period_start"`
	PeriodEnd   string        `json:"period_end"`
	Items       []rankingItem `json:"items"`
}

func loadSnapshots(t *testing.T, db *sql.DB) map[snapshotKey]snapshot {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `
		SELECT tenant_id, ranking_key, entity_type,
			to_char(period_start, 'YYYY-MM-DD'), to_char(period_end, 'YYYY-MM-DD'),
			items, algorithm_version
		FROM content_ranking_snapshots
	`)
	if err != nil {
		t.Fatalf("list ranking snapshots: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	snapshots := make(map[snapshotKey]snapshot)
	for rows.Next() {
		var key snapshotKey
		var value snapshot
		var raw []byte
		var version int
		if err := rows.Scan(&key.tenantID, &key.rankingKey, &key.entityType,
			&value.PeriodStart, &value.PeriodEnd, &raw, &version); err != nil {
			t.Fatalf("scan ranking snapshot: %v", err)
		}
		if version != AlgorithmVersion {
			t.Fatalf("algorithm_version = %d, want %d", version, AlgorithmVersion)
		}
		if err := json.Unmarshal(raw, &value.Items); err != nil {
			t.Fatalf("decode ranking items: %v", err)
		}
		snapshots[key] = value
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate ranking snapshots: %v", err)
	}
	return snapshots
}

func assertSnapshot(t *testing.T, snapshots map[snapshotKey]snapshot, key snapshotKey, want snapshot) {
	t.Helper()
	got, ok := snapshots[key]
	if !ok {
		t.Fatalf("missing %s %s snapshot for tenant %s", key.rankingKey, key.entityType, key.tenantID)
	}
	gotJSON, wantJSON := mustMarshal(t, got), mustMarshal(t, want)
	if gotJSON != wantJSON {
		t.Fatalf("%s %s snapshot for tenant %s = %s, want %s", key.rankingKey, key.entityType, key.tenantID, gotJSON, wantJSON)
	}
}

func mustMarshal(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode snapshot: %v", err)
	}
	return string(encoded)
}
