package contentstats

import (
	"context"
	"database/sql"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// savePosition stands in for a reader's viewer saving where they stopped,
// moved at updatedAt.
func savePosition(t *testing.T, db *sql.DB, tenantID, userID, episodeID uuid.UUID, pageIndex int, updatedAt time.Time) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO episode_reading_positions (tenant_id, user_id, episode_id, page_index, page_count, updated_at)
		VALUES ($1, $2, $3, $4, 10, $5)
		ON CONFLICT (tenant_id, user_id, episode_id) DO UPDATE
		SET page_index = EXCLUDED.page_index, updated_at = EXCLUDED.updated_at
	`, tenantID, userID, episodeID, pageIndex, updatedAt); err != nil {
		t.Fatalf("save a reading position: %v", err)
	}
}

// loadPageReach reads one tenant day's reader counts, each episode's in page
// order. A gap in an episode's pages fails the test, since every row past it
// would be read as the page before it.
func loadPageReach(t *testing.T, db *sql.DB, tenantID uuid.UUID, statDate time.Time) map[uuid.UUID][]int64 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `
		SELECT episode_id, page_index, reader_count
		FROM episode_page_reach_stats
		WHERE tenant_id = $1 AND stat_date = $2::date
		ORDER BY episode_id, page_index
	`, tenantID, statDate.Format(time.DateOnly))
	if err != nil {
		t.Fatalf("load page reach: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	reach := map[uuid.UUID][]int64{}
	for rows.Next() {
		var episodeID uuid.UUID
		var pageIndex int
		var readers int64
		if err := rows.Scan(&episodeID, &pageIndex, &readers); err != nil {
			t.Fatalf("scan page reach: %v", err)
		}
		if pageIndex != len(reach[episodeID]) {
			t.Fatalf("episode %s has page %d after %d pages", episodeID, pageIndex, len(reach[episodeID]))
		}
		reach[episodeID] = append(reach[episodeID], readers)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate page reach: %v", err)
	}
	return reach
}

// A day's readers are the ones whose position was last moved during the
// tenant's own day, and each reached every page up to the one they stopped at.
// A reader who moves again later leaves the day for the later one the next time
// it is rebuilt, since the position keeps no history.
func TestRunFilesHowFarTheDaysReadersGot(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	seoul, err := time.LoadLocation("Asia/Seoul")
	if err != nil {
		t.Fatalf("load Asia/Seoul: %v", err)
	}
	at := func(day, hour, minute int) time.Time {
		return time.Date(2026, time.August, day, hour, minute, 0, 0, seoul)
	}
	statDate := time.Date(2026, time.August, 28, 0, 0, 0, 0, time.UTC)
	nextDate := statDate.AddDate(0, 0, 1)

	tenant := pg.SeedTenant(t, "REACHTENANT1", "reach.example.com", "Reach Tenant")
	setTenantTimeZone(t, pg.DB, tenant.ID, "Asia/Seoul")
	otherTenant := pg.SeedTenant(t, "REACHTENANT2", "other-reach.example.com", "Other Reach Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "REACHSERIES1"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "REACHEPISOD1"})
	secondEpisode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "REACHEPISOD2"})
	otherSeries := pg.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "REACHSERIES2"})
	otherEpisode := pg.SeedEpisode(t, otherTenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "REACHEPISOD3"})
	var readers [5]uuid.UUID
	for i := range readers {
		suffix := string(rune('1' + i))
		readers[i] = pg.SeedEndUser(t, tenant.ID, "REACHREADER"+suffix, "reader"+suffix+"@reach.example.com", "Reader "+suffix).ID
	}
	otherReader := pg.SeedEndUser(t, otherTenant.ID, "REACHREADER9", "reader@other-reach.example.com", "Other Reader")

	savePosition(t, pg.DB, tenant.ID, readers[0], episode.ID, 2, at(28, 10, 0))
	// Ten minutes past the tenant's midnight is the 28th's, however UTC dates
	// it.
	savePosition(t, pg.DB, tenant.ID, readers[1], episode.ID, 4, at(28, 0, 10))
	savePosition(t, pg.DB, tenant.ID, readers[2], episode.ID, 4, at(28, 23, 30))
	// Either side of the day, so in neither of its counts.
	savePosition(t, pg.DB, tenant.ID, readers[3], episode.ID, 1, at(29, 0, 30))
	savePosition(t, pg.DB, tenant.ID, readers[4], episode.ID, 3, at(27, 23, 50))
	savePosition(t, pg.DB, tenant.ID, readers[0], secondEpisode.ID, 0, at(28, 12, 0))
	savePosition(t, pg.DB, otherTenant.ID, otherReader.ID, otherEpisode.ID, 1, statDate.Add(12*time.Hour))

	aggregator := newAggregator(pg.OpenContentStatsDB(t))
	result, err := aggregator.Run(context.Background(), Options{StatDate: statDate})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := (Result{TenantCount: 2, RowCount: 8}); !reflect.DeepEqual(result, want) {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	want := map[uuid.UUID][]int64{
		episode.ID:       {3, 3, 3, 2, 2},
		secondEpisode.ID: {1},
	}
	if got := loadPageReach(t, pg.DB, tenant.ID, statDate); !reflect.DeepEqual(got, want) {
		t.Fatalf("page reach of the 28th = %v, want %v", got, want)
	}
	if got, want := loadPageReach(t, pg.DB, otherTenant.ID, statDate), (map[uuid.UUID][]int64{otherEpisode.ID: {1, 1}}); !reflect.DeepEqual(got, want) {
		t.Fatalf("the other tenant's page reach = %v, want %v", got, want)
	}

	// A second rebuild replaces the day rather than adding to it.
	if _, err := aggregator.Run(context.Background(), Options{StatDate: statDate}); err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if got := loadPageReach(t, pg.DB, tenant.ID, statDate); !reflect.DeepEqual(got, want) {
		t.Fatalf("page reach of the 28th after a rebuild = %v, want %v", got, want)
	}

	// The first reader reads on the next day. Rebuilt again, the 28th no longer
	// holds them, and the 29th counts them where they stopped then.
	savePosition(t, pg.DB, tenant.ID, readers[0], episode.ID, 5, at(29, 9, 0))
	for _, day := range []time.Time{statDate, nextDate} {
		if _, err := aggregator.Run(context.Background(), Options{StatDate: day}); err != nil {
			t.Fatalf("Run for %s: %v", day.Format(time.DateOnly), err)
		}
	}
	if got, want := loadPageReach(t, pg.DB, tenant.ID, statDate)[episode.ID], []int64{2, 2, 2, 2, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("page reach of the 28th once a reader moved on = %v, want %v", got, want)
	}
	if got, want := loadPageReach(t, pg.DB, tenant.ID, nextDate)[episode.ID], []int64{2, 2, 1, 1, 1, 1}; !reflect.DeepEqual(got, want) {
		t.Fatalf("page reach of the 29th = %v, want %v", got, want)
	}
}
