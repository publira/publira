package contentranking

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// The cutoffs every purge test runs with. They are far apart so a period can
// be expired under one ranking key and still current under the other.
const (
	dailyCutoffDate  = "2026-06-01"
	weeklyCutoffDate = "2026-01-01"
)

func TestPurgeRunDeletesOnlyExpiredSnapshots(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, "PURGERANK001", "purge-rankings.example.com", "Purge Ranking Tenant")
	other := pg.SeedTenant(t, "PURGERANK002", "other-purge-rankings.example.com", "Other Purge Ranking Tenant")

	expired := []uuid.UUID{
		// Past the daily cutoff, with a newer daily period behind it.
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: tenant.ID, rankingKey: DailyRankingKey, periodEnd: "2026-05-31"}),
		// The row an earlier algorithm_version left in that same period. It is
		// no more current than the row beside it, so retention takes it too.
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: tenant.ID, rankingKey: DailyRankingKey, periodEnd: "2026-05-31", algorithmVersion: AlgorithmVersion + 1}),
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: tenant.ID, rankingKey: WeeklyRankingKey, periodEnd: "2025-12-31"}),
		// A second tenant proves the sweep is not scoped to the first one.
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: other.ID, rankingKey: DailyRankingKey, periodEnd: "2026-05-01"}),
	}
	retained := []uuid.UUID{
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: tenant.ID, rankingKey: DailyRankingKey, periodEnd: "2026-08-28"}),
		// Exactly at the cutoff: the comparison is exclusive.
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: tenant.ID, rankingKey: DailyRankingKey, periodEnd: dailyCutoffDate}),
		// Long past the daily cutoff, but weekly snapshots are kept far longer.
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: tenant.ID, rankingKey: WeeklyRankingKey, periodEnd: "2026-05-31"}),
		// The only episode ranking this tenant has, and expired. The newest
		// period of a group survives whatever the cutoff says, because it is
		// the one the public site reads.
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: tenant.ID, rankingKey: DailyRankingKey, periodEnd: "2026-05-30", entityType: "episode"}),
		// A ranking key with no retention configured is left alone.
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: tenant.ID, rankingKey: "monthly", periodEnd: "2020-01-01"}),
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: other.ID, rankingKey: DailyRankingKey, periodEnd: "2026-08-28"}),
	}

	purger := NewPurger(pg.OpenPlatformDB(t))

	// A dry run reports the candidates and leaves every row in place.
	dry, err := purger.Run(context.Background(), purgeOptions(true))
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if want := (PurgeResult{RowCount: 4, DryRun: true}); dry != want {
		t.Fatalf("dry run result = %+v, want %+v", dry, want)
	}
	if got := countSnapshots(t, pg.DB); got != 10 {
		t.Fatalf("rows after dry run = %d, want 10", got)
	}

	result, err := purger.Run(context.Background(), purgeOptions(false))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if want := (PurgeResult{RowCount: 4, ChunkCount: 1}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	for _, id := range expired {
		if snapshotExists(t, pg.DB, id) {
			t.Fatalf("expired snapshot %s survived the purge", id)
		}
	}
	for _, id := range retained {
		if !snapshotExists(t, pg.DB, id) {
			t.Fatalf("retained snapshot %s was purged", id)
		}
	}

	// Re-running over the same cutoffs finds nothing left to delete.
	repeat, err := purger.Run(context.Background(), purgeOptions(false))
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if want := (PurgeResult{ChunkCount: 1}); repeat != want {
		t.Fatalf("second result = %+v, want %+v", repeat, want)
	}
	if got := countSnapshots(t, pg.DB); got != int64(len(retained)) {
		t.Fatalf("rows after purge = %d, want %d", got, len(retained))
	}
}

func TestPurgeRunDeletesInChunks(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	tenant := pg.SeedTenant(t, "PURGECHUNK01", "chunked-purge-rankings.example.com", "Chunked Purge Ranking Tenant")

	// Four expired periods plus the newest one, which is never a candidate.
	for _, periodEnd := range []string{"2026-05-27", "2026-05-28", "2026-05-29", "2026-05-30", "2026-08-28"} {
		insertRetentionSnapshot(t, pg.DB, snapshotSeed{tenantID: tenant.ID, rankingKey: DailyRankingKey, periodEnd: periodEnd})
	}

	options := purgeOptions(false)
	options.ChunkSize = 2
	result, err := NewPurger(pg.OpenPlatformDB(t)).Run(context.Background(), options)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	// Two full chunks, then a third that comes up short and ends the run.
	if want := (PurgeResult{RowCount: 4, ChunkCount: 3}); result != want {
		t.Fatalf("result = %+v, want %+v", result, want)
	}
	if got := countSnapshots(t, pg.DB); got != 1 {
		t.Fatalf("rows after purge = %d, want 1", got)
	}
}

func TestPurgeRunRejectsTenantScopedRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	pg.SeedTenant(t, "PURGERLS0001", "rls-purge-rankings.example.com", "RLS Purge Ranking Tenant")

	_, err := NewPurger(pg.OpenAdminDB(t)).Run(context.Background(), purgeOptions(false))
	if err == nil || !strings.Contains(err.Error(), "BYPASSRLS") {
		t.Fatalf("Run error = %v, want BYPASSRLS requirement", err)
	}
}

func purgeOptions(dryRun bool) PurgeOptions {
	return PurgeOptions{
		Cutoffs: map[string]time.Time{
			DailyRankingKey:  at(dailyCutoffDate),
			WeeklyRankingKey: at(weeklyCutoffDate),
		},
		DryRun: dryRun,
	}
}

type snapshotSeed struct {
	tenantID         uuid.UUID
	rankingKey       string
	periodEnd        string
	entityType       string
	algorithmVersion int
}

// insertRetentionSnapshot files one snapshot at seed.periodEnd. Only the end
// of the period decides retention, so a daily period covering one day and a
// weekly one covering seven are seeded the same way.
func insertRetentionSnapshot(t *testing.T, db *sql.DB, seed snapshotSeed) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	entityType := seed.entityType
	if entityType == "" {
		entityType = "series"
	}
	algorithmVersion := seed.algorithmVersion
	if algorithmVersion == 0 {
		algorithmVersion = AlgorithmVersion
	}
	periodStart := seed.periodEnd
	if seed.rankingKey == WeeklyRankingKey {
		periodStart = at(seed.periodEnd).AddDate(0, 0, -(weeklyWindowDays - 1)).Format(time.DateOnly)
	}

	id := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO content_ranking_snapshots (
			id, tenant_id, ranking_key, period_start, period_end, entity_type, items, algorithm_version
		) VALUES ($1, $2, $3, $4::date, $5::date, $6, '[]'::jsonb, $7)
	`, id, seed.tenantID, seed.rankingKey, periodStart, seed.periodEnd, entityType, algorithmVersion); err != nil {
		t.Fatalf("insert %s snapshot ending %s: %v", seed.rankingKey, seed.periodEnd, err)
	}
	return id
}

func countSnapshots(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int64
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM content_ranking_snapshots").Scan(&count); err != nil {
		t.Fatalf("count ranking snapshots: %v", err)
	}
	return count
}

func snapshotExists(t *testing.T, db *sql.DB, id uuid.UUID) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var exists bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM content_ranking_snapshots WHERE id = $1)", id).Scan(&exists); err != nil {
		t.Fatalf("look up ranking snapshot: %v", err)
	}
	return exists
}
