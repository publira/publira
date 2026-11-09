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

	saved, err := queries.UpdateEpisodePublishScheduleByIDForTenant(ctx, dbmodels.UpdateEpisodePublishScheduleByIDForTenantParams{
		ScheduledAt: sql.NullTime{Time: scheduledAt, Valid: true},
		TenantID:    tenant.ID,
		ID:          draft.ID,
	})
	if err != nil {
		t.Fatalf("schedule the draft: %v", err)
	}
	if saved.WithdrawsPublication {
		t.Fatalf("scheduling the draft withdraws a publication: %+v", saved)
	}
	got := readEpisodeListingSchedule(t, ctx, pg.DB, draft.ID)
	if got.status != testutil.EpisodeStatusScheduled || !got.scheduledAt.Valid || !got.scheduledAt.Time.Equal(scheduledAt) || got.publishedAt.Valid {
		t.Fatalf("scheduled draft = %+v, want scheduled at %s and never published", got, scheduledAt)
	}

	publishedAt := readEpisodeListingSchedule(t, ctx, pg.DB, published.ID).publishedAt
	saved, err = queries.UpdateEpisodePublishScheduleByIDForTenant(ctx, dbmodels.UpdateEpisodePublishScheduleByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       published.ID,
	})
	if err != nil {
		t.Fatalf("clear the published episode's schedule: %v", err)
	}
	if !saved.WithdrawsPublication || !publishedAt.Valid || !saved.WithdrawnPublishedAt.Valid || !saved.WithdrawnPublishedAt.Time.Equal(publishedAt.Time) {
		t.Fatalf("clearing the published episode = %+v, want the publication at %+v withdrawn", saved, publishedAt)
	}
	got = readEpisodeListingSchedule(t, ctx, pg.DB, published.ID)
	if got.status != testutil.EpisodeStatusDraft || got.scheduledAt.Valid || got.publishedAt.Valid {
		t.Fatalf("cleared episode = %+v, want a draft with neither instant", got)
	}
}

// A save that clears the schedule of an episode the publication job is
// publishing waits for the job, and once the job commits the save takes that
// publication back and says so, rather than reading the listing it started on,
// which was still scheduled.
func TestUpdateEpisodePublishScheduleTakesBackAPublicationCommittedWhileItWaits(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "SCHEDULETN02", "schedule-race.example.com", "Schedule Race Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SCHEDULESR02", Title: "Series", Published: true})
	due := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "SCHEDULEEP03",
		Title:       "Due",
		Status:      testutil.EpisodeStatusScheduled,
		ScheduledAt: time.Now().UTC().Add(-time.Minute),
	})

	job, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the job's transaction: %v", err)
	}
	defer func() { _ = job.Rollback() }()
	if rows, err := dbmodels.New(job).MarkEpisodePublished(ctx, due.ID); err != nil || rows != 1 {
		t.Fatalf("MarkEpisodePublished = %d, %v; want the episode published", rows, err)
	}

	save, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the save's transaction: %v", err)
	}
	defer func() { _ = save.Rollback() }()
	var savePID int
	if err := save.QueryRowContext(ctx, "SELECT pg_backend_pid()").Scan(&savePID); err != nil {
		t.Fatalf("read the save's backend: %v", err)
	}
	type result struct {
		saved dbmodels.UpdateEpisodePublishScheduleByIDForTenantRow
		err   error
	}
	done := make(chan result, 1)
	go func() {
		q := dbmodels.New(save)
		if err := q.LockEpisodeListingForScheduleSave(ctx, dbmodels.LockEpisodeListingForScheduleSaveParams{TenantID: tenant.ID, EpisodeID: due.ID}); err != nil {
			done <- result{err: err}
			return
		}
		saved, err := q.UpdateEpisodePublishScheduleByIDForTenant(ctx, dbmodels.UpdateEpisodePublishScheduleByIDForTenantParams{TenantID: tenant.ID, ID: due.ID})
		done <- result{saved: saved, err: err}
	}()

	// The job commits only once the save is waiting on the listing it holds.
	for {
		var waiting bool
		if err := pg.DB.QueryRowContext(ctx, `
			SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock')
		`, savePID).Scan(&waiting); err != nil {
			t.Fatalf("read whether the save waits: %v", err)
		}
		if waiting {
			break
		}
		select {
		case got := <-done:
			t.Fatalf("the save finished before the job committed: %+v", got)
		case <-ctx.Done():
			t.Fatal("the save never waited on the job")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if err := job.Commit(); err != nil {
		t.Fatalf("commit the job: %v", err)
	}
	published := readEpisodeListingSchedule(t, ctx, pg.DB, due.ID).publishedAt

	got := <-done
	if got.err != nil {
		t.Fatalf("clear the schedule: %v", got.err)
	}
	if !got.saved.WithdrawsPublication || !got.saved.WithdrawnPublishedAt.Valid || !got.saved.WithdrawnPublishedAt.Time.Equal(published.Time) {
		t.Fatalf("clearing the schedule = %+v, want the publication at %+v the job committed taken back", got.saved, published)
	}
}
