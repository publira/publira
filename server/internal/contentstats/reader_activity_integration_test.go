package contentstats

import (
	"cmp"
	"context"
	"database/sql"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// readerActivity is one reader_daily_activity row of a tenant day.
type readerActivity struct {
	userID   uuid.UUID
	seriesID uuid.UUID
}

func loadReaderActivity(t *testing.T, db *sql.DB, tenantID uuid.UUID, statDate time.Time) []readerActivity {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `
		SELECT user_id, series_id
		FROM reader_daily_activity
		WHERE tenant_id = $1 AND stat_date = $2::date
		ORDER BY user_id, series_id
	`, tenantID, statDate.Format(time.DateOnly))
	if err != nil {
		t.Fatalf("load reader activity: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	activity := []readerActivity{}
	for rows.Next() {
		var row readerActivity
		if err := rows.Scan(&row.userID, &row.seriesID); err != nil {
			t.Fatalf("scan reader activity: %v", err)
		}
		activity = append(activity, row)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate reader activity: %v", err)
	}
	return activity
}

// sortedActivity orders rows the way loadReaderActivity reads them, so a test
// can write its expectation in any order.
func sortedActivity(rows ...readerActivity) []readerActivity {
	slices.SortFunc(rows, func(a, b readerActivity) int {
		return cmp.Or(
			strings.Compare(a.userID.String(), b.userID.String()),
			strings.Compare(a.seriesID.String(), b.seriesID.String()),
		)
	})
	return rows
}

// A day's active readers are the members who viewed, finished, or bought an
// episode during the tenant's own day, once per series however many events
// they left in it. A signed-out view, a series page, a rating, and a favourite
// are not activity of this kind, and a rebuild replaces the day.
func TestRunFilesTheDaysActiveReaders(t *testing.T) {
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

	tenant := pg.SeedTenant(t, "ACTVTENANT01", "activity.example.com", "Activity Tenant")
	setTenantTimeZone(t, pg.DB, tenant.ID, "Asia/Seoul")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "ACTVSERIES01"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "ACTVEPISOD01"})
	secondEpisode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "ACTVEPISOD02"})
	otherSeries := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "ACTVSERIES02"})
	otherEpisode := pg.SeedEpisode(t, tenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "ACTVEPISOD03"})
	var readers [5]uuid.UUID
	for i := range readers {
		suffix := string(rune('1' + i))
		readers[i] = pg.SeedEndUser(t, tenant.ID, "ACTVREADER0"+suffix, "reader"+suffix+"@activity.example.com", "Reader "+suffix).ID
	}

	// Two views and a completed read of two episodes of one series, ten
	// minutes past the tenant's midnight among them, are one row.
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: readers[0], seriesID: series.ID, episodeID: episode.ID, debounceBucket: 1, occurredAt: at(28, 0, 10)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: readers[0], seriesID: series.ID, episodeID: secondEpisode.ID, debounceBucket: 2, occurredAt: at(28, 9, 0)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_complete", userID: readers[0], seriesID: series.ID, episodeID: episode.ID, occurredAt: at(28, 9, 30)})
	// A view of another series is a row of its own.
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: readers[0], seriesID: otherSeries.ID, episodeID: otherEpisode.ID, debounceBucket: 3, occurredAt: at(28, 10, 0)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_complete", userID: readers[1], seriesID: series.ID, episodeID: episode.ID, occurredAt: at(28, 23, 30)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "purchase", userID: readers[2], seriesID: otherSeries.ID, episodeID: otherEpisode.ID, occurredAt: at(28, 12, 0)})
	// Not activity of this kind, or not on this day.
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "series_view", userID: readers[3], seriesID: series.ID, debounceBucket: 4, occurredAt: at(28, 12, 0)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "rating", userID: readers[3], seriesID: series.ID, episodeID: episode.ID, ratingScore: 4, occurredAt: at(28, 12, 30)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "favorite", userID: readers[3], seriesID: series.ID, occurredAt: at(28, 13, 0)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", anonymousID: uuid.Must(uuid.NewV7()), seriesID: series.ID, episodeID: episode.ID, debounceBucket: 5, occurredAt: at(28, 14, 0)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: readers[4], seriesID: series.ID, episodeID: episode.ID, debounceBucket: 6, occurredAt: at(29, 0, 30)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_view", userID: readers[4], seriesID: series.ID, episodeID: episode.ID, debounceBucket: 7, occurredAt: at(27, 23, 50)})

	want := sortedActivity(
		readerActivity{readers[0], series.ID},
		readerActivity{readers[0], otherSeries.ID},
		readerActivity{readers[1], series.ID},
		readerActivity{readers[2], otherSeries.ID},
	)
	aggregator := newAggregator(pg.OpenContentStatsDB(t))
	for _, run := range []string{"first", "second"} {
		if _, err := aggregator.Run(context.Background(), Options{StatDate: statDate}); err != nil {
			t.Fatalf("%s Run: %v", run, err)
		}
		if got := loadReaderActivity(t, pg.DB, tenant.ID, statDate); !reflect.DeepEqual(got, want) {
			t.Fatalf("active readers of the 28th after the %s run = %v, want %v", run, got, want)
		}
	}
}

// The active days outlive the content events they were filed from: once the
// purge has taken a day's events, a run naming the day leaves its rows as they
// are rather than rebuilding it empty.
func TestRunKeepsTheActiveReadersOfADayPastTheTenantsRetention(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "ACTVTENANT02", "kept-activity.example.com", "Kept Activity Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "ACTVSERIES03"})
	reader := pg.SeedEndUser(t, tenant.ID, "ACTVREADER06", "reader@kept-activity.example.com", "Reader")
	statDate := time.Date(2026, time.March, 1, 0, 0, 0, 0, time.UTC)
	if _, err := pg.DB.ExecContext(context.Background(), `
		INSERT INTO reader_daily_activity (tenant_id, stat_date, user_id, series_id)
		VALUES ($1, $2::date, $3, $4)
	`, tenant.ID, statDate.Format(time.DateOnly), reader.ID, series.ID); err != nil {
		t.Fatalf("seed an active day: %v", err)
	}
	if _, err := pg.DB.ExecContext(context.Background(), `
		INSERT INTO content_event_purges (tenant_id, purged_before) VALUES ($1, $2)
	`, tenant.ID, statDate.AddDate(0, 0, 10)); err != nil {
		t.Fatalf("record the purge: %v", err)
	}

	result, err := newAggregator(pg.OpenContentStatsDB(t)).Run(context.Background(), Options{StatDate: statDate})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Skipped) != 1 || result.Skipped[0].TenantID != tenant.ID {
		t.Fatalf("skipped = %+v, want the tenant", result.Skipped)
	}
	if got, want := loadReaderActivity(t, pg.DB, tenant.ID, statDate), []readerActivity{{reader.ID, series.ID}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("active readers of a purged day = %v, want %v", got, want)
	}
}
