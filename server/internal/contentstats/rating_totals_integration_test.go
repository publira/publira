package contentstats

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// readRatingTotals reads the tenant mean's two stored halves, answering -1 for
// a tenant with no row so a missing total cannot be mistaken for an empty one.
func readRatingTotals(t *testing.T, db *sql.DB, tenantID uuid.UUID) (int64, int64) {
	t.Helper()
	var points, completedReads int64
	if err := db.QueryRowContext(context.Background(), `
		SELECT COALESCE((SELECT points FROM tenant_rating_totals WHERE tenant_id = $1), -1),
			COALESCE((SELECT completed_reads FROM tenant_rating_totals WHERE tenant_id = $1), -1)
	`, tenantID).Scan(&points, &completedReads); err != nil {
		t.Fatalf("read the tenant rating totals: %v", err)
	}
	return points, completedReads
}

// The tenant mean a series with few finished reads is rated against is left
// behind by the run that changes it, so a series page reads a stored number
// instead of summing every day the tenant has ever had.
//
// It is restated over the whole history each run rather than moved by the day's
// difference, so rebuilding a day that already counted does not count it twice.
func TestRunStoresTheTenantRatingTotals(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	statDate := time.Date(2026, time.August, 28, 0, 0, 0, 0, time.UTC)
	nextDate := statDate.AddDate(0, 0, 1)
	tenant := pg.SeedTenant(t, "RATETOTTNT01", "rating-totals.example.com", "Rating Totals Tenant")
	otherTenant := pg.SeedTenant(t, "RATETOTTNT02", "other-rating-totals.example.com", "Other Rating Totals Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RATETOTSER01"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "RATETOTEP001"})
	reader := pg.SeedEndUser(t, tenant.ID, "RATETOTRDR01", "reader@rating-totals.example.com", "Rating Reader")

	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "rating", userID: reader.ID, seriesID: series.ID, episodeID: episode.ID, ratingScore: 5, occurredAt: statDate.Add(time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_complete", userID: reader.ID, seriesID: series.ID, episodeID: episode.ID, occurredAt: statDate.Add(2 * time.Hour)})

	aggregator := New(pg.OpenPlatformDB(t))
	if _, err := aggregator.Run(context.Background(), Options{StatDate: statDate}); err != nil {
		t.Fatalf("Run for the day of the reaction: %v", err)
	}
	if points, reads := readRatingTotals(t, pg.DB, tenant.ID); points != 5 || reads != 1 {
		t.Fatalf("tenant rating totals = %d points over %d reads, want 5 over 1", points, reads)
	}
	// A tenant with nothing to count still gets its row, so a series page reads
	// a mean of nothing rather than no answer at all.
	if points, reads := readRatingTotals(t, pg.DB, otherTenant.ID); points != 0 || reads != 0 {
		t.Fatalf("the other tenant's totals = %d points over %d reads, want 0 over 0", points, reads)
	}

	// A second day adds to the totals rather than replacing them.
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "rating", userID: reader.ID, seriesID: series.ID, episodeID: episode.ID, ratingScore: 3, occurredAt: nextDate.Add(time.Hour)})
	insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, eventType: "episode_complete", userID: reader.ID, seriesID: series.ID, episodeID: episode.ID, occurredAt: nextDate.Add(2 * time.Hour)})
	if _, err := aggregator.Run(context.Background(), Options{StatDate: nextDate}); err != nil {
		t.Fatalf("Run for the day after: %v", err)
	}
	if points, reads := readRatingTotals(t, pg.DB, tenant.ID); points != 8 || reads != 2 {
		t.Fatalf("tenant rating totals after the second day = %d points over %d reads, want 8 over 2", points, reads)
	}

	// Rebuilding a day that already counted leaves the totals where they are.
	if _, err := aggregator.Run(context.Background(), Options{StatDate: statDate}); err != nil {
		t.Fatalf("second Run for the first day: %v", err)
	}
	if points, reads := readRatingTotals(t, pg.DB, tenant.ID); points != 8 || reads != 2 {
		t.Fatalf("tenant rating totals after a rebuild = %d points over %d reads, want 8 over 2", points, reads)
	}
}
