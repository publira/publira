package contentranking

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
	discussed := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKSERIES04"})
	bought := pg.SeedEpisode(t, tenant.ID, rated.ID, testutil.EpisodeSeed{PublicID: "RANKEPISO001"})
	older := pg.SeedEpisode(t, tenant.ID, viewed.ID, testutil.EpisodeSeed{PublicID: "RANKEPISO002"})
	otherSeries := pg.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "RANKSERIES03"})
	otherEpisode := pg.SeedEpisode(t, otherTenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "RANKEPISO003"})

	// 1*10 views + 2*6 viewers + 8*1 favorite + 1.6*9 rating points = 44.4.
	// Nothing is subtracted from the rating sum: the scale has no bad end, so a
	// reader who pressed once still adds.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: rated.ID,
		viewCount: 10, uniqueViewerCount: 6, ratingCount: 2, ratingSum: 9, favoriteCount: 1})
	// 1*30 views + 2*2 viewers = 34 today, plus a much bigger day six days back
	// that the weekly window fades to a quarter: (100 + 2*50) * 0.25 = 50.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: viewed.ID,
		viewCount: 30, uniqueViewerCount: 2})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: weeklyStartDate, entityType: "series", entityID: viewed.ID,
		viewCount: 100, uniqueViewerCount: 50})
	// 1*5 views + 2*3 viewers + 20*2 purchases + 10*1 comment = 61.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "episode", entityID: bought.ID,
		viewCount: 5, uniqueViewerCount: 3, purchaseCount: 2, commentCount: 1})
	// Nobody opened it that day and three readers wrote about it: 10*3 = 30, so
	// commenting alone is enough to place.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: discussed.ID,
		commentCount: 3})
	// Three days back, so (4 + 2*4) * 0.5 = 6 in the weekly window and nothing
	// at all in the daily one.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: "2026-08-25", entityType: "episode", entityID: older.ID,
		viewCount: 4, uniqueViewerCount: 4})
	// One day before the weekly window opens: it must not reach any snapshot.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: "2026-08-21", entityType: "series", entityID: rated.ID,
		viewCount: 1000, uniqueViewerCount: 1000})
	// Ratings and nothing else, low ones at that: 1.6*4 = 6.4, which places.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "episode", entityID: older.ID,
		ratingCount: 2, ratingSum: 4})

	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: otherTenant.ID, statDate: referenceDate, entityType: "series", entityID: otherSeries.ID,
		viewCount: 2, uniqueViewerCount: 1})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: otherTenant.ID, statDate: referenceDate, entityType: "episode", entityID: otherEpisode.ID,
		viewCount: 1, uniqueViewerCount: 1})

	// A snapshot left by an earlier run must be replaced in place rather than
	// joined by a second row for the same period.
	insertStaleSnapshot(t, pg.DB, tenant.ID, DailyRankingKey, referenceDate, referenceDate, "series", "web")

	aggregator := New(pg.OpenPlatformDB(t))
	want := Result{TenantCount: 2, SnapshotCount: 12, ItemCount: 22}
	result, err := aggregator.Run(context.Background(), runOptions())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}

	snapshots := loadSnapshots(t, pg.DB)
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "series", surface: "web"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: rated.ID, Score: 44.4, ViewCount: 10, ViewerDays: 6, RatingCount: 2, RatingSum: 9, FavoriteCount: 1, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: viewed.ID, Score: 34, ViewCount: 30, ViewerDays: 2, LastActiveDate: referenceDate},
			{Rank: 3, EntityID: discussed.ID, Score: 30, CommentCount: 3, LastActiveDate: referenceDate},
		},
	})
	// The faded older day is what puts the viewed series ahead over a week.
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: WeeklyRankingKey, entityType: "series", surface: "web"}, snapshot{
		PeriodStart: weeklyStartDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: viewed.ID, Score: 84, ViewCount: 130, ViewerDays: 52, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: rated.ID, Score: 44.4, ViewCount: 10, ViewerDays: 6, RatingCount: 2, RatingSum: 9, FavoriteCount: 1, LastActiveDate: referenceDate},
			{Rank: 3, EntityID: discussed.ID, Score: 30, CommentCount: 3, LastActiveDate: referenceDate},
		},
	})
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "episode"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: bought.ID, Score: 61, ViewCount: 5, ViewerDays: 3, PurchaseCount: 2, CommentCount: 1, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: older.ID, Score: 6.4, RatingCount: 2, RatingSum: 4, LastActiveDate: referenceDate},
		},
	})
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: WeeklyRankingKey, entityType: "episode"}, snapshot{
		PeriodStart: weeklyStartDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: bought.ID, Score: 61, ViewCount: 5, ViewerDays: 3, PurchaseCount: 2, CommentCount: 1, LastActiveDate: referenceDate},
			// 6.4 from today's rating points plus the halved 12 of three days back.
			{Rank: 2, EntityID: older.ID, Score: 12.4, ViewCount: 4, ViewerDays: 4, RatingCount: 2, RatingSum: 4, LastActiveDate: referenceDate},
		},
	})
	assertSnapshot(t, snapshots, snapshotKey{tenantID: otherTenant.ID, rankingKey: DailyRankingKey, entityType: "series", surface: "web"}, snapshot{
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

	assertSnapshot(t, loadSnapshots(t, pg.DB), snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "series", surface: "web"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: busy.ID, Score: 17, ViewCount: 9, ViewerDays: 4, LastActiveDate: referenceDate},
		},
	})
}

func TestRunRanksTheRemainingTenantsAfterOneFails(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Tenant ids are UUIDv7 and Run walks them in id order, so the tenant
	// seeded first is the one that fails first: anything the second tenant
	// ends up with was written after that failure.
	broken := pg.SeedTenant(t, "RANKBROKEN01", "broken-rankings.example.com", "Broken Ranking Tenant")
	healthy := pg.SeedTenant(t, "RANKHEALTHY1", "healthy-rankings.example.com", "Healthy Ranking Tenant")
	brokenSeries := pg.SeedSeries(t, broken.ID, testutil.SeriesSeed{PublicID: "RANKBROKENS1"})
	healthySeries := pg.SeedSeries(t, healthy.ID, testutil.SeriesSeed{PublicID: "RANKHEALTHS1"})

	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: broken.ID, statDate: referenceDate, entityType: "series", entityID: brokenSeries.ID,
		viewCount: 7, uniqueViewerCount: 3})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: healthy.ID, statDate: referenceDate, entityType: "series", entityID: healthySeries.ID,
		viewCount: 2, uniqueViewerCount: 1})

	rejectSnapshotsForTenant(t, pg.DB, broken.ID)

	result, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), runOptions())
	if err == nil || !strings.Contains(err.Error(), broken.ID.String()) {
		t.Fatalf("Run error = %v, want a failure naming tenant %s", err, broken.ID)
	}
	if want := (Result{TenantCount: 1, SnapshotCount: 6, ItemCount: 4}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}

	snapshots := loadSnapshots(t, pg.DB)
	if _, ok := snapshots[snapshotKey{tenantID: broken.ID, rankingKey: DailyRankingKey, entityType: "series", surface: "web"}]; ok {
		t.Fatal("the failing tenant committed a snapshot")
	}
	assertSnapshot(t, snapshots, snapshotKey{tenantID: healthy.ID, rankingKey: DailyRankingKey, entityType: "series", surface: "web"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: healthySeries.ID, Score: 4, ViewCount: 2, ViewerDays: 1, LastActiveDate: referenceDate},
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
	if want := (Result{TenantCount: 1, SnapshotCount: 6}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	// An empty leaderboard is written as an empty array, never as null, so a
	// reader can iterate it without a nil check.
	assertSnapshot(t, loadSnapshots(t, pg.DB), snapshotKey{tenantID: tenant.ID, rankingKey: WeeklyRankingKey, entityType: "series", surface: "web"}, snapshot{
		PeriodStart: weeklyStartDate, PeriodEnd: referenceDate, Items: []rankingItem{},
	})
}

func TestRunBuildsARankingPerGenre(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "RANKGENRE001", "genre-rankings.example.com", "Genre Ranking Tenant")
	action := pg.SeedGenre(t, tenant.ID, testutil.GenreSeed{Name: "Action"})
	romance := pg.SeedGenre(t, tenant.ID, testutil.GenreSeed{Name: "Romance"})
	quiet := pg.SeedGenre(t, tenant.ID, testutil.GenreSeed{Name: "Quiet"})
	unused := pg.SeedGenre(t, tenant.ID, testutil.GenreSeed{Name: "Unused"})

	duel := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKGENRES01", Published: true})
	chase := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKGENRES02", Published: true})
	letters := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKGENRES03", Published: true})
	rated := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKGENRES04", Published: true, AgeRating: "r18"})
	draft := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKGENRES05"})
	upcoming := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKGENRES06", Published: true, PublishedAt: time.Now().Add(24 * time.Hour)})
	silent := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKGENRES07", Published: true})

	// The duel belongs to both genres, so it places in each of them.
	pg.SeedSeriesGenre(t, tenant.ID, duel.ID, action.ID)
	pg.SeedSeriesGenre(t, tenant.ID, duel.ID, romance.ID)
	pg.SeedSeriesGenre(t, tenant.ID, chase.ID, action.ID)
	pg.SeedSeriesGenre(t, tenant.ID, letters.ID, romance.ID)
	pg.SeedSeriesGenre(t, tenant.ID, rated.ID, action.ID)
	pg.SeedSeriesGenre(t, tenant.ID, draft.ID, action.ID)
	pg.SeedSeriesGenre(t, tenant.ID, upcoming.ID, romance.ID)
	pg.SeedSeriesGenre(t, tenant.ID, silent.ID, quiet.ID)

	// 1*10 views + 2*5 viewers = 20.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: duel.ID,
		viewCount: 10, uniqueViewerCount: 5})
	// 1*4 views + 2*2 viewers = 8 today, plus (8 + 2*4) * 0.25 = 4 six days
	// back, which only the weekly window reaches.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: chase.ID,
		viewCount: 4, uniqueViewerCount: 2})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: weeklyStartDate, entityType: "series", entityID: chase.ID,
		viewCount: 8, uniqueViewerCount: 4})
	// 10*3 comments = 30, ahead of the duel.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: letters.ID,
		commentCount: 3})
	// The rated, the draft, and the upcoming series outscore everything and
	// still rank in no genre, though the tenant-wide ranking keeps them.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: rated.ID,
		viewCount: 500})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: draft.ID,
		viewCount: 400})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: upcoming.ID,
		viewCount: 300})
	// Engagement with the quiet genre's series falls outside the weekly window.
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: "2026-08-21", entityType: "series", entityID: silent.ID,
		viewCount: 50})

	aggregator := New(pg.OpenPlatformDB(t))
	// Six tenant-wide snapshots, then a daily and a weekly one per genre and
	// surface.
	want := Result{TenantCount: 1, SnapshotCount: 22, ItemCount: 40}
	result, err := aggregator.Run(context.Background(), runOptions())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}

	snapshots := loadSnapshots(t, pg.DB)
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "series", genreID: action.ID, surface: "web"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: duel.ID, Score: 20, ViewCount: 10, ViewerDays: 5, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: chase.ID, Score: 8, ViewCount: 4, ViewerDays: 2, LastActiveDate: referenceDate},
		},
	})
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: WeeklyRankingKey, entityType: "series", genreID: action.ID, surface: "web"}, snapshot{
		PeriodStart: weeklyStartDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: duel.ID, Score: 20, ViewCount: 10, ViewerDays: 5, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: chase.ID, Score: 12, ViewCount: 12, ViewerDays: 6, LastActiveDate: referenceDate},
		},
	})
	romanceDaily := snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: letters.ID, Score: 30, CommentCount: 3, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: duel.ID, Score: 20, ViewCount: 10, ViewerDays: 5, LastActiveDate: referenceDate},
		},
	}
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "series", genreID: romance.ID, surface: "web"}, romanceDaily)
	for _, genreID := range []uuid.UUID{quiet.ID, unused.ID} {
		assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: WeeklyRankingKey, entityType: "series", genreID: genreID, surface: "web"}, snapshot{
			PeriodStart: weeklyStartDate, PeriodEnd: referenceDate, Items: []rankingItem{},
		})
	}
	// The tenant-wide ranking is not held to the genre rankings' rules.
	if got := len(snapshots[snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "series", surface: "web"}].Items); got != 6 {
		t.Fatalf("tenant-wide daily series items = %d, want 6", got)
	}

	// A second run on the same day replaces every row, the genre ones included.
	result, err = aggregator.Run(context.Background(), runOptions())
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if result != want {
		t.Fatalf("second result = %+v, want %+v", result, want)
	}
	rebuilt := loadSnapshots(t, pg.DB)
	if got := countSnapshots(t, pg.DB); got != int64(len(snapshots)) {
		t.Fatalf("snapshot rows after rebuild = %d, want %d", got, len(snapshots))
	}
	for key, before := range snapshots {
		assertSnapshot(t, rebuilt, key, before)
	}

	// Deleting a genre takes its rankings with it.
	if _, err := pg.DB.Exec("DELETE FROM series_genres WHERE genre_id = $1", romance.ID); err != nil {
		t.Fatalf("unassign genre: %v", err)
	}
	if _, err := pg.DB.Exec("DELETE FROM genres WHERE id = $1", romance.ID); err != nil {
		t.Fatalf("delete genre: %v", err)
	}
	for key := range loadSnapshots(t, pg.DB) {
		if key.genreID == romance.ID {
			t.Fatalf("the deleted genre kept its %s snapshot", key.rankingKey)
		}
	}
}

func TestRunRanksSeriesPerSurface(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "RANKSURFACE1", "surface-rankings.example.com", "Surface Ranking Tenant")
	drama := pg.SeedGenre(t, tenant.ID, testutil.GenreSeed{Name: "Drama"})
	appFirst := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKSURFSE01", Published: true, Availability: "app"})
	appSecond := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKSURFSE02", Published: true, Availability: "app"})
	webOnly := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKSURFSE03", Published: true, Availability: "web"})
	both := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RANKSURFSE04", Published: true})
	for _, series := range []testutil.Series{appFirst, appSecond, webOnly, both} {
		pg.SeedSeriesGenre(t, tenant.ID, series.ID, drama.ID)
	}

	// The app-only series lead on views alone and fill a two-item leaderboard
	// by themselves.
	for _, seed := range []struct {
		id    uuid.UUID
		views int64
	}{{appFirst.ID, 100}, {appSecond.ID, 90}, {webOnly.ID, 20}, {both.ID, 10}} {
		insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: tenant.ID, statDate: referenceDate, entityType: "series", entityID: seed.id, viewCount: seed.views})
	}

	// Every signal of this tenant belongs to a series the web may not show.
	appTenant := pg.SeedTenant(t, "RANKSURFACE2", "app-surface-rankings.example.com", "App Surface Ranking Tenant")
	appTitle := pg.SeedSeries(t, appTenant.ID, testutil.SeriesSeed{PublicID: "RANKSURFSE05", Published: true, Availability: "app"})
	insertDailyStat(t, pg.DB, dailyStatSeed{tenantID: appTenant.ID, statDate: referenceDate, entityType: "series", entityID: appTitle.ID, viewCount: 5})

	options := runOptions()
	options.ItemLimit = 2
	if _, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), options); err != nil {
		t.Fatalf("Run: %v", err)
	}

	snapshots := loadSnapshots(t, pg.DB)
	webDaily := snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: webOnly.ID, Score: 20, ViewCount: 20, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: both.ID, Score: 10, ViewCount: 10, LastActiveDate: referenceDate},
		},
	}
	appDaily := snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: appFirst.ID, Score: 100, ViewCount: 100, LastActiveDate: referenceDate},
			{Rank: 2, EntityID: appSecond.ID, Score: 90, ViewCount: 90, LastActiveDate: referenceDate},
		},
	}
	for _, genreID := range []uuid.UUID{uuid.Nil, drama.ID} {
		assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "series", genreID: genreID, surface: "web"}, webDaily)
		assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "series", genreID: genreID, surface: "app"}, appDaily)
	}

	assertSnapshot(t, snapshots, snapshotKey{tenantID: appTenant.ID, rankingKey: DailyRankingKey, entityType: "series", surface: "web"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate, Items: []rankingItem{},
	})
	assertSnapshot(t, snapshots, snapshotKey{tenantID: appTenant.ID, rankingKey: DailyRankingKey, entityType: "series", surface: "app"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate,
		Items: []rankingItem{
			{Rank: 1, EntityID: appTitle.ID, Score: 5, ViewCount: 5, LastActiveDate: referenceDate},
		},
	})
	// Episode rankings are not read by surface and stay one per window.
	assertSnapshot(t, snapshots, snapshotKey{tenantID: tenant.ID, rankingKey: DailyRankingKey, entityType: "episode"}, snapshot{
		PeriodStart: referenceDate, PeriodEnd: referenceDate, Items: []rankingItem{},
	})
}

func TestRunMintsUUIDv7Keys(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SeedTenant(t, "RANKUUID0001", "uuid-rankings.example.com", "UUID Ranking Tenant")

	if _, err := New(pg.OpenPlatformDB(t)).Run(context.Background(), runOptions()); err != nil {
		t.Fatalf("Run: %v", err)
	}

	var rows, v7 int
	if err := pg.DB.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE uuid_extract_version(id) = 7)
		FROM content_ranking_snapshots
	`).Scan(&rows, &v7); err != nil {
		t.Fatalf("count ranking snapshot ids: %v", err)
	}
	if rows == 0 || v7 != rows {
		t.Fatalf("UUIDv7 ids = %d of %d ranking snapshot rows, want all of at least one", v7, rows)
	}
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
	commentCount      int64
}

func insertDailyStat(t *testing.T, db *sql.DB, seed dailyStatSeed) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_daily_stats (
			id, tenant_id, stat_date, entity_type, entity_id,
			view_count, unique_viewer_count, purchase_count, rating_count, rating_sum, favorite_count,
			comment_count
		) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, uuid.Must(uuid.NewV7()), seed.tenantID, seed.statDate, seed.entityType, seed.entityID,
		seed.viewCount, seed.uniqueViewerCount, seed.purchaseCount,
		seed.ratingCount, seed.ratingSum, seed.favoriteCount, seed.commentCount); err != nil {
		t.Fatalf("insert daily stat: %v", err)
	}
}

func insertStaleSnapshot(t *testing.T, db *sql.DB, tenantID uuid.UUID, rankingKey, periodStart, periodEnd, entityType, surface string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_ranking_snapshots (
			id, tenant_id, ranking_key, period_start, period_end, entity_type, surface, items, algorithm_version
		) VALUES ($1, $2, $3, $4::date, $5::date, $6, NULLIF($7, ''), '[{"rank": 1, "score": 999}]'::jsonb, $8)
	`, uuid.Must(uuid.NewV7()), tenantID, rankingKey, periodStart, periodEnd, entityType, surface, AlgorithmVersion); err != nil {
		t.Fatalf("insert stale snapshot: %v", err)
	}
}

// rejectSnapshotsForTenant makes every snapshot insert for one tenant fail, so
// a test can watch what the run does with the tenants that come after it.
func rejectSnapshotsForTenant(t *testing.T, db *sql.DB, tenantID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := db.ExecContext(ctx, `
		CREATE FUNCTION reject_ranking_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			RAISE EXCEPTION 'ranking snapshot rejected by test trigger';
		END;
		$$
	`); err != nil {
		t.Fatalf("create rejection function: %v", err)
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`
		CREATE TRIGGER reject_ranking_snapshot
		BEFORE INSERT ON content_ranking_snapshots
		FOR EACH ROW WHEN (NEW.tenant_id = '%s'::uuid)
		EXECUTE FUNCTION reject_ranking_snapshot()
	`, tenantID)); err != nil {
		t.Fatalf("create rejection trigger: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cancelCleanup := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelCleanup()
		if _, err := db.ExecContext(cleanupCtx, "DROP TRIGGER IF EXISTS reject_ranking_snapshot ON content_ranking_snapshots"); err != nil {
			t.Errorf("drop rejection trigger: %v", err)
		}
		if _, err := db.ExecContext(cleanupCtx, "DROP FUNCTION IF EXISTS reject_ranking_snapshot()"); err != nil {
			t.Errorf("drop rejection function: %v", err)
		}
	})
}

type snapshotKey struct {
	tenantID   uuid.UUID
	rankingKey string
	entityType string
	// genreID is uuid.Nil for the tenant-wide ranking.
	genreID uuid.UUID
	// surface is empty for an episode ranking, which is not cut per surface.
	surface string
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
	CommentCount   int64     `json:"comment_count"`
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
		SELECT tenant_id, ranking_key, entity_type, COALESCE(genre_id, '00000000-0000-0000-0000-000000000000'::uuid),
			COALESCE(surface, ''), to_char(period_start, 'YYYY-MM-DD'), to_char(period_end, 'YYYY-MM-DD'),
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
		if err := rows.Scan(&key.tenantID, &key.rankingKey, &key.entityType, &key.genreID, &key.surface,
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
		t.Fatalf("missing %s %s %s snapshot of genre %s for tenant %s", key.surface, key.rankingKey, key.entityType, key.genreID, key.tenantID)
	}
	gotJSON, wantJSON := mustMarshal(t, got), mustMarshal(t, want)
	if gotJSON != wantJSON {
		t.Fatalf("%s %s %s snapshot of genre %s for tenant %s = %s, want %s", key.surface, key.rankingKey, key.entityType, key.genreID, key.tenantID, gotJSON, wantJSON)
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
