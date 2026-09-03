package mfachallenges

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

func TestRunDeletesOnlyExpiredChallenges(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	cutoff := time.Date(2026, time.September, 3, 12, 0, 0, 0, time.UTC)
	tenant := pg.SeedTenant(t, "MFAPURGETEN1", "mfa-purge.example.com", "MFA Purge Tenant")
	otherTenant := pg.SeedTenant(t, "MFAPURGETEN2", "other-mfa-purge.example.com", "Other MFA Purge Tenant")
	admin := pg.SeedTenantAdmin(t, tenant.ID, "MFAPURGEADM1", "admin@mfa-purge.example.com", "MFA Purge Admin")
	otherAdmin := pg.SeedTenantAdmin(t, otherTenant.ID, "MFAPURGEADM2", "admin@other-mfa-purge.example.com", "Other MFA Purge Admin")

	// Three expired rows across two tenants, plus two that must survive: one
	// expiring exactly at the cutoff (the window is exclusive) and one after.
	expired := []uuid.UUID{
		insertUsedChallenge(t, pg.DB, tenant.ID, admin.ID, cutoff.Add(-time.Hour)),
		insertUsedChallenge(t, pg.DB, tenant.ID, admin.ID, cutoff.Add(-time.Second)),
		insertUsedChallenge(t, pg.DB, otherTenant.ID, otherAdmin.ID, cutoff.Add(-5*time.Minute)),
	}
	retained := []uuid.UUID{
		insertUsedChallenge(t, pg.DB, tenant.ID, admin.ID, cutoff),
		insertUsedChallenge(t, pg.DB, otherTenant.ID, otherAdmin.ID, cutoff.Add(time.Minute)),
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
	if got := countUsedChallenges(t, pg.DB); got != 5 {
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
	for _, jti := range expired {
		if usedChallengeExists(t, pg.DB, jti) {
			t.Fatalf("expired challenge %s survived the purge", jti)
		}
	}
	for _, jti := range retained {
		if !usedChallengeExists(t, pg.DB, jti) {
			t.Fatalf("retained challenge %s was purged", jti)
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
	pg.SeedTenant(t, "MFAPURGERLS1", "rls-mfa-purge.example.com", "RLS MFA Purge")

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
	if !strings.Contains(plan.String(), "idx_user_mfa_used_challenges_expires_at") {
		t.Fatalf("plan does not use idx_user_mfa_used_challenges_expires_at:\n%s", plan.String())
	}
}

func insertUsedChallenge(t *testing.T, db *sql.DB, tenantID, userID uuid.UUID, expiresAt time.Time) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	jti := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO user_mfa_used_challenges (jti, tenant_id, user_id, expires_at)
		VALUES ($1, $2, $3, $4)
	`, jti, tenantID, userID, expiresAt); err != nil {
		t.Fatalf("insert used challenge: %v", err)
	}
	return jti
}

func countUsedChallenges(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int64
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM user_mfa_used_challenges").Scan(&count); err != nil {
		t.Fatalf("count used challenges: %v", err)
	}
	return count
}

func usedChallengeExists(t *testing.T, db *sql.DB, jti uuid.UUID) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var exists bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM user_mfa_used_challenges WHERE jti = $1)", jti).Scan(&exists); err != nil {
		t.Fatalf("look up used challenge: %v", err)
	}
	return exists
}
