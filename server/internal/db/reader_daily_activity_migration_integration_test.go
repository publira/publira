package dbtest

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before the
// readers' active days were filed, and the one that files them.
const (
	beforeReaderDailyActivityVersion = 20261025162643
	readerDailyActivityVersion       = 20261026003554
)

// The days rebuilt before reader_daily_activity existed are filed from the
// content events still kept, in the tenant's own days, once per member and
// series. A day the purge has begun on is left out, as the rebuild leaves it
// out.
func TestReaderDailyActivityMigrationFilesTheKeptEvents(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	pg.MigrateTo(t, beforeReaderDailyActivityVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	tenant := pg.SeedTenantOnOlderSchema(t, "ACTVMIGRATE1", "activity-migration.example.com", "Activity Migration")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "ACTVMIGSER01", Title: "Series"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "ACTVMIGEP001", Title: "Episode"})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := pg.DB.ExecContext(ctx, "UPDATE tenants SET timezone = 'Asia/Seoul' WHERE id = $1", tenant.ID); err != nil {
		t.Fatalf("set the tenant's time zone: %v", err)
	}
	seoul, err := time.LoadLocation("Asia/Seoul")
	if err != nil {
		t.Fatalf("load Asia/Seoul: %v", err)
	}
	readerID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO users (id, tenant_id, public_id, email, password_hash, name)
		VALUES ($1, $2, 'ACTVMIGUSR01', 'reader@activity-migration.example.com', '', 'Reader')
	`, readerID, tenant.ID); err != nil {
		t.Fatalf("insert reader: %v", err)
	}
	bucket := int64(0)
	event := func(eventType string, userID any, at time.Time) {
		t.Helper()
		bucket++
		var anonymousID any
		if userID == nil {
			anonymousID = uuid.Must(uuid.NewV7())
		}
		if _, err := pg.DB.ExecContext(ctx, `
			INSERT INTO content_events (id, tenant_id, event_type, user_id, anonymous_id, series_id, episode_id, debounce_bucket, occurred_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, uuid.Must(uuid.NewV7()), tenant.ID, eventType, userID, anonymousID, series.ID, episode.ID, bucket, at); err != nil {
			t.Fatalf("insert %s event: %v", eventType, err)
		}
	}
	// The purge has taken the events before noon on the 3rd, so that day is
	// partial and left out.
	if _, err := pg.DB.ExecContext(ctx, "INSERT INTO content_event_purges (tenant_id, purged_before) VALUES ($1, $2)",
		tenant.ID, time.Date(2026, time.October, 3, 12, 0, 0, 0, seoul)); err != nil {
		t.Fatalf("record the purge: %v", err)
	}
	event("episode_view", readerID, time.Date(2026, time.October, 3, 20, 0, 0, 0, seoul))
	// Ten minutes into the 5th in Seoul, which is still the 4th in UTC.
	event("episode_view", readerID, time.Date(2026, time.October, 5, 0, 10, 0, 0, seoul))
	event("episode_complete", readerID, time.Date(2026, time.October, 5, 9, 0, 0, 0, seoul))
	event("purchase", readerID, time.Date(2026, time.October, 6, 9, 0, 0, 0, seoul))
	event("episode_view", nil, time.Date(2026, time.October, 7, 9, 0, 0, 0, seoul))

	pg.MigrateTo(t, readerDailyActivityVersion)

	rows, err := pg.DB.QueryContext(ctx, `
		SELECT stat_date::text FROM reader_daily_activity
		WHERE tenant_id = $1 AND user_id = $2 AND series_id = $3
		ORDER BY stat_date
	`, tenant.ID, readerID, series.ID)
	if err != nil {
		t.Fatalf("read the active days: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var days []string
	for rows.Next() {
		var day string
		if err := rows.Scan(&day); err != nil {
			t.Fatalf("scan an active day: %v", err)
		}
		days = append(days, day)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate the active days: %v", err)
	}
	if got, want := days, []string{"2026-10-05", "2026-10-06"}; !slices.Equal(got, want) {
		t.Fatalf("active days = %v, want %v", got, want)
	}
	var total int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM reader_daily_activity WHERE tenant_id = $1", tenant.ID).Scan(&total); err != nil {
		t.Fatalf("count the active days: %v", err)
	}
	if total != 2 {
		t.Fatalf("rows filed = %d, want 2", total)
	}
}
