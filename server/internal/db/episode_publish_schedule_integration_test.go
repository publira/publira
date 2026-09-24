package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

type episodeListingSchedule struct {
	status      string
	scheduledAt sql.NullTime
	publishedAt sql.NullTime
}

func readEpisodeListingSchedule(t *testing.T, ctx context.Context, db *sql.DB, episodeID uuid.UUID) episodeListingSchedule {
	t.Helper()
	var got episodeListingSchedule
	if err := db.QueryRowContext(ctx, `
		SELECT status, scheduled_at, published_at FROM episode_listings WHERE episode_id = $1
	`, episodeID).Scan(&got.status, &got.scheduledAt, &got.publishedAt); err != nil {
		t.Fatalf("read episode_listings %s: %v", episodeID, err)
	}
	return got
}

// The statement runs on PostgreSQL here because sqlmock never prepares it, and
// a parameter the planner cannot type fails only there.
func TestUpdateEpisodePublishScheduleSetsAndClearsTheSchedule(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "SCHEDULETN01", "schedule.example.com", "Schedule Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SCHEDULESR01", Title: "Series", Published: true})
	draft := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "SCHEDULEEP01", Title: "Draft", Status: testutil.EpisodeStatusDraft})
	published := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "SCHEDULEEP02", Title: "Published", Status: testutil.EpisodeStatusPublished})

	queries := dbmodels.New(pg.DB)
	scheduledAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)

	if err := queries.UpdateEpisodePublishScheduleByPublicIDForTenant(ctx, dbmodels.UpdateEpisodePublishScheduleByPublicIDForTenantParams{
		ScheduledAt: sql.NullTime{Time: scheduledAt, Valid: true},
		TenantID:    tenant.ID,
		PublicID:    draft.PublicID,
	}); err != nil {
		t.Fatalf("schedule the draft: %v", err)
	}
	got := readEpisodeListingSchedule(t, ctx, pg.DB, draft.ID)
	if got.status != testutil.EpisodeStatusScheduled || !got.scheduledAt.Valid || !got.scheduledAt.Time.Equal(scheduledAt) || got.publishedAt.Valid {
		t.Fatalf("scheduled draft = %+v, want scheduled at %s and never published", got, scheduledAt)
	}

	if err := queries.UpdateEpisodePublishScheduleByPublicIDForTenant(ctx, dbmodels.UpdateEpisodePublishScheduleByPublicIDForTenantParams{
		TenantID: tenant.ID,
		PublicID: published.PublicID,
	}); err != nil {
		t.Fatalf("clear the published episode's schedule: %v", err)
	}
	got = readEpisodeListingSchedule(t, ctx, pg.DB, published.ID)
	if got.status != testutil.EpisodeStatusDraft || got.scheduledAt.Valid || got.publishedAt.Valid {
		t.Fatalf("cleared episode = %+v, want a draft with neither instant", got)
	}
}
