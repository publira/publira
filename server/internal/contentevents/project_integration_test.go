package contentevents

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

func insertEpisodeRead(t *testing.T, db *sql.DB, tenantID, userID, episodeID uuid.UUID, readAt time.Time) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	id := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO episode_reads (id, tenant_id, user_id, episode_id, read_at)
		VALUES ($1, $2, $3, $4, $5)
	`, id, tenantID, userID, episodeID, readAt); err != nil {
		t.Fatalf("insert episode read: %v", err)
	}
	return id
}

func completeEventCount(t *testing.T, db *sql.DB, sourceID uuid.UUID) int64 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int64
	if err := db.QueryRowContext(ctx, `
		SELECT count(*)
		FROM content_events
		WHERE event_type = 'episode_complete'
			AND source_table = 'episode_reads'
			AND source_id = $1
	`, sourceID).Scan(&count); err != nil {
		t.Fatalf("count projected events: %v", err)
	}
	return count
}

func TestProjectorFilesOneEventPerUnprojectedRead(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	readAt := time.Date(2026, time.August, 30, 12, 0, 0, 0, time.UTC)
	tenant := pg.SeedTenant(t, "PROJTENANT01", "project.example.com", "Project Tenant")
	otherTenant := pg.SeedTenant(t, "PROJTENANT02", "other-project.example.com", "Other Project Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "PROJSERIES01"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PROJEP00001"})
	secondEpisode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PROJEP00002"})
	otherSeries := pg.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "PROJSERIES02"})
	otherEpisode := pg.SeedEpisode(t, otherTenant.ID, otherSeries.ID, testutil.EpisodeSeed{PublicID: "PROJEP00003"})
	member := pg.SeedEndUser(t, tenant.ID, "PROJMEMBER01", "member@project.example.com", "Project Member")
	secondMember := pg.SeedEndUser(t, tenant.ID, "PROJMEMBER02", "member2@project.example.com", "Project Member Two")
	otherMember := pg.SeedEndUser(t, otherTenant.ID, "PROJMEMBER03", "member@other-project.example.com", "Other Project Member")

	first := insertEpisodeRead(t, pg.DB, tenant.ID, member.ID, episode.ID, readAt)
	second := insertEpisodeRead(t, pg.DB, tenant.ID, secondMember.ID, episode.ID, readAt.Add(time.Minute))
	third := insertEpisodeRead(t, pg.DB, tenant.ID, member.ID, secondEpisode.ID, readAt.Add(2*time.Minute))
	foreign := insertEpisodeRead(t, pg.DB, otherTenant.ID, otherMember.ID, otherEpisode.ID, readAt.Add(3*time.Minute))

	projector := NewProjector(pg.OpenPlatformDB(t))

	// A batch size below the backlog forces the loop to iterate.
	result, err := projector.Run(context.Background(), ProjectionOptions{BatchSize: 2})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := (ProjectionResult{RowCount: 4, BatchCount: 3}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	for _, sourceID := range []uuid.UUID{first, second, third, foreign} {
		if got := completeEventCount(t, pg.DB, sourceID); got != 1 {
			t.Fatalf("events for read %s = %d, want 1", sourceID, got)
		}
	}

	var (
		eventTenant uuid.UUID
		eventSeries uuid.UUID
		eventUser   uuid.UUID
		occurredAt  time.Time
	)
	if err := pg.DB.QueryRowContext(context.Background(), `
		SELECT tenant_id, series_id, user_id, occurred_at
		FROM content_events
		WHERE source_table = 'episode_reads' AND source_id = $1
	`, first).Scan(&eventTenant, &eventSeries, &eventUser, &occurredAt); err != nil {
		t.Fatalf("read the projected event: %v", err)
	}
	if eventTenant != tenant.ID || eventUser != member.ID {
		t.Fatalf("event actor = (%s, %s), want (%s, %s)", eventTenant, eventUser, tenant.ID, member.ID)
	}
	if eventSeries != series.ID {
		t.Fatalf("event series_id = %s, want the episode's own series %s", eventSeries, series.ID)
	}
	if !occurredAt.Equal(readAt) {
		t.Fatalf("occurred_at = %s, want the read time %s", occurredAt, readAt)
	}

	// Re-running writes nothing: every read already has its event, and the run
	// still probes once to find that out.
	again, err := projector.Run(context.Background(), ProjectionOptions{BatchSize: 2})
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if want := (ProjectionResult{BatchCount: 1}); again != want {
		t.Fatalf("second result = %+v, want %+v", again, want)
	}
	if got := countEvents(t, pg.DB); got != 4 {
		t.Fatalf("events after re-running = %d, want 4", got)
	}
}

func TestProjectorLeavesAlreadyProjectedReadsAlone(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	readAt := time.Date(2026, time.August, 30, 12, 0, 0, 0, time.UTC)
	tenant := pg.SeedTenant(t, "PROJTENANT03", "projected.example.com", "Projected Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "PROJSERIES03"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PROJEP00004"})
	member := pg.SeedEndUser(t, tenant.ID, "PROJMEMBER04", "member@projected.example.com", "Projected Member")

	read := insertEpisodeRead(t, pg.DB, tenant.ID, member.ID, episode.ID, readAt)
	projector := NewProjector(pg.OpenPlatformDB(t))
	if _, err := projector.Run(context.Background(), ProjectionOptions{}); err != nil {
		t.Fatalf("first Run: %v", err)
	}

	var firstEventID uuid.UUID
	if err := pg.DB.QueryRowContext(context.Background(),
		"SELECT id FROM content_events WHERE source_table = 'episode_reads' AND source_id = $1", read,
	).Scan(&firstEventID); err != nil {
		t.Fatalf("read the projected event id: %v", err)
	}

	// A second read of the same episode by the same member is the same row, so
	// re-running cannot produce a second completion for it.
	if _, err := pg.DB.ExecContext(context.Background(), `
		UPDATE episode_reads SET read_at = $1 WHERE id = $2
	`, readAt.Add(time.Hour), read); err != nil {
		t.Fatalf("touch the read: %v", err)
	}
	if _, err := projector.Run(context.Background(), ProjectionOptions{}); err != nil {
		t.Fatalf("second Run: %v", err)
	}

	if got := completeEventCount(t, pg.DB, read); got != 1 {
		t.Fatalf("events for read %s = %d, want 1", read, got)
	}
	var currentEventID uuid.UUID
	if err := pg.DB.QueryRowContext(context.Background(),
		"SELECT id FROM content_events WHERE source_table = 'episode_reads' AND source_id = $1", read,
	).Scan(&currentEventID); err != nil {
		t.Fatalf("re-read the projected event id: %v", err)
	}
	if currentEventID != firstEventID {
		t.Fatalf("event id = %s, want the first projection %s", currentEventID, firstEventID)
	}
}

func TestProjectorRejectsTenantScopedRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SeedTenant(t, "PROJRLS00001", "rls-project.example.com", "RLS Project")

	_, err := NewProjector(pg.OpenAdminDB(t)).Run(context.Background(), ProjectionOptions{})
	if err == nil || !strings.Contains(err.Error(), "BYPASSRLS") {
		t.Fatalf("Run error = %v, want BYPASSRLS requirement", err)
	}
}
