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

func TestRunDeletesOnlyExpiredEvents(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	cutoff := time.Date(2026, time.August, 30, 0, 0, 0, 0, time.UTC)
	tenant := pg.SeedTenant(t, "PURGETENANT1", "purge.example.com", "Purge Tenant")
	otherTenant := pg.SeedTenant(t, "PURGETENANT2", "other-purge.example.com", "Other Purge Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "PURGESERIES1"})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "PURGEEP0001"})
	otherSeries := pg.SeedSeries(t, otherTenant.ID, testutil.SeriesSeed{PublicID: "PURGESERIES2"})
	viewer := pg.SeedEndUser(t, tenant.ID, "PURGEVIEWER1", "viewer@purge.example.com", "Purge Viewer")
	otherViewer := pg.SeedEndUser(t, otherTenant.ID, "PURGEVIEWER2", "viewer@other-purge.example.com", "Other Purge Viewer")

	// Three expired rows across two tenants, plus two rows that must survive:
	// one exactly at the cutoff (the window is exclusive) and one after it.
	expired := []uuid.UUID{
		insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, userID: viewer.ID, seriesID: series.ID, episodeID: episode.ID, debounceBucket: 1, occurredAt: cutoff.Add(-72 * time.Hour)}),
		insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, userID: viewer.ID, seriesID: series.ID, episodeID: episode.ID, debounceBucket: 2, occurredAt: cutoff.Add(-time.Second)}),
		insertEvent(t, pg.DB, eventSeed{tenantID: otherTenant.ID, userID: otherViewer.ID, seriesID: otherSeries.ID, debounceBucket: 3, eventType: "series_view", occurredAt: cutoff.Add(-24 * time.Hour)}),
	}
	retained := []uuid.UUID{
		insertEvent(t, pg.DB, eventSeed{tenantID: tenant.ID, userID: viewer.ID, seriesID: series.ID, episodeID: episode.ID, debounceBucket: 4, occurredAt: cutoff}),
		insertEvent(t, pg.DB, eventSeed{tenantID: otherTenant.ID, userID: otherViewer.ID, seriesID: otherSeries.ID, debounceBucket: 5, eventType: "series_view", occurredAt: cutoff.Add(time.Hour)}),
	}

	purger := New(pg.OpenPlatformDB(t))

	// A dry run reports the candidates and leaves every row in place.
	dry, err := purger.Run(context.Background(), Options{Cutoff: cutoff, DryRun: true})
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if want := (Result{RowCount: 3, DryRun: true}); dry != want {
		t.Fatalf("dry run result = %+v, want %+v", dry, want)
	}
	if got := countEvents(t, pg.DB); got != 5 {
		t.Fatalf("rows after dry run = %d, want 5", got)
	}

	// ChunkSize below the candidate count forces the loop to iterate.
	result, err := purger.Run(context.Background(), Options{Cutoff: cutoff, ChunkSize: 2})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := (Result{RowCount: 3, ChunkCount: 2}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	for _, id := range expired {
		if eventExists(t, pg.DB, id) {
			t.Fatalf("expired event %s survived the purge", id)
		}
	}
	for _, id := range retained {
		if !eventExists(t, pg.DB, id) {
			t.Fatalf("retained event %s was purged", id)
		}
	}

	// Re-running finds nothing left to delete but still probes once.
	again, err := purger.Run(context.Background(), Options{Cutoff: cutoff, ChunkSize: 2})
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if want := (Result{ChunkCount: 1}); again != want {
		t.Fatalf("second result = %+v, want %+v", again, want)
	}
}

func TestRunRejectsTenantScopedRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SeedTenant(t, "PURGERLS0001", "rls-purge.example.com", "RLS Purge")

	_, err := New(pg.OpenAdminDB(t)).Run(context.Background(), Options{Cutoff: time.Now().UTC()})
	if err == nil || !strings.Contains(err.Error(), "BYPASSRLS") {
		t.Fatalf("Run error = %v, want BYPASSRLS requirement", err)
	}
}

func TestChunkQueryHasEligibleIndex(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin explain transaction: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	// Small tables tempt the planner into a sequential scan; the purge only
	// stays chunk-sized on large ones, where the index scan is what matters.
	if _, err := tx.ExecContext(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatalf("disable sequential scans: %v", err)
	}
	rows, err := tx.QueryContext(ctx, "EXPLAIN (COSTS OFF) "+deleteChunkSQL, time.Now().UTC(), 10)
	if err != nil {
		t.Fatalf("explain chunk query: %v", err)
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
	if !strings.Contains(plan.String(), "idx_content_events_occurred_at") {
		t.Fatalf("plan does not use idx_content_events_occurred_at:\n%s", plan.String())
	}
}

type eventSeed struct {
	tenantID       uuid.UUID
	eventType      string
	userID         uuid.UUID
	seriesID       uuid.UUID
	episodeID      uuid.UUID
	debounceBucket int64
	occurredAt     time.Time
}

func insertEvent(t *testing.T, db *sql.DB, seed eventSeed) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	eventType := seed.eventType
	if eventType == "" {
		eventType = "episode_view"
	}
	var episodeID any
	if seed.episodeID != uuid.Nil {
		episodeID = seed.episodeID
	}
	id := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_events (
			id, tenant_id, event_type, user_id, series_id, episode_id,
			debounce_bucket, occurred_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, id, seed.tenantID, eventType, seed.userID, seed.seriesID, episodeID, seed.debounceBucket, seed.occurredAt); err != nil {
		t.Fatalf("insert %s event: %v", eventType, err)
	}
	return id
}

func countEvents(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int64
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM content_events").Scan(&count); err != nil {
		t.Fatalf("count content events: %v", err)
	}
	return count
}

func eventExists(t *testing.T, db *sql.DB, id uuid.UUID) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var exists bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM content_events WHERE id = $1)", id).Scan(&exists); err != nil {
		t.Fatalf("look up content event: %v", err)
	}
	return exists
}
