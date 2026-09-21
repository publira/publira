package maintenance

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/royalties"
	"github.com/publira/publira/server/internal/testutil"
)

// Seoul is ahead of UTC, so a tenant's close day begins on the UTC day before
// it and a run placed by UTC alone would close a day late.
var royaltySeoul = mustLoadLocation("Asia/Seoul")

// A tenant on automatic closing with the 5th as its close day is closed on
// the 5th in its own zone and not before, and a second run the same day closes
// nothing twice. The tenants that are not the job's — one closing by hand, one
// that chose automatic closing only after the month ended — are left alone.
func TestRoyaltyStatementCloseRunsOnEachTenantsCloseDay(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()

	automatic := seedRoyaltyTenant(t, pg, "ROYALTYAUTO1")
	setAutomaticClose(t, pg.DB, automatic, 5, time.Date(2026, time.June, 15, 9, 0, 0, 0, royaltySeoul))
	manual := seedRoyaltyTenant(t, pg, "ROYALTYMANU1")
	if _, err := pg.DB.ExecContext(ctx,
		"INSERT INTO tenant_royalty_config (tenant_id, close_mode) VALUES ($1, 'manual')", manual,
	); err != nil {
		t.Fatalf("set manual closing: %v", err)
	}
	late := seedRoyaltyTenant(t, pg, "ROYALTYLATE1")
	setAutomaticClose(t, pg.DB, late, 5, time.Date(2026, time.August, 2, 9, 0, 0, 0, royaltySeoul))

	job := RoyaltyStatementClose{}
	deps := Deps{DB: pg.OpenContentStatsDB(t), Logger: discardLogger()}
	runAt := func(at time.Time) {
		t.Helper()
		if err := job.run(ctx, deps, at); err != nil {
			t.Fatalf("run at %s: %v", at.Format(time.RFC3339), err)
		}
	}

	// The day before: June is owed and closed, July is not due yet.
	runAt(time.Date(2026, time.August, 4, 23, 59, 0, 0, royaltySeoul))
	assertClosedPeriods(t, pg.DB, automatic, "2026-06")

	// The close day, twice.
	runAt(time.Date(2026, time.August, 5, 0, 30, 0, 0, royaltySeoul))
	runAt(time.Date(2026, time.August, 5, 1, 30, 0, 0, royaltySeoul))
	assertClosedPeriods(t, pg.DB, automatic, "2026-06", "2026-07")
	assertClosedPeriods(t, pg.DB, manual)
	assertClosedPeriods(t, pg.DB, late)

	// A month after: August for the automatic tenant, and August is the first
	// month the late tenant owes.
	runAt(time.Date(2026, time.September, 5, 12, 0, 0, 0, royaltySeoul))
	assertClosedPeriods(t, pg.DB, automatic, "2026-06", "2026-07", "2026-08")
	assertClosedPeriods(t, pg.DB, manual)
	assertClosedPeriods(t, pg.DB, late, "2026-08")

	// No user closed any of them, and the audit log says the platform did.
	if got := countRows(t, pg.DB,
		"SELECT count(*) FROM royalty_statements WHERE tenant_id = $1 AND closed_by_user_id IS NULL", automatic,
	); got != 3 {
		t.Fatalf("statements closed by no user = %d, want 3", got)
	}
	if got := countRows(t, pg.DB,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'royalty_statement_closed' AND actor_role = 'system' AND actor_user_id IS NULL",
		automatic,
	); got != 3 {
		t.Fatalf("system audit entries = %d, want 3", got)
	}
}

// A worker that was down over two close days comes back to two months owed,
// and a month the tenant closed by hand in the meantime stays as it was closed.
func TestRoyaltyStatementCloseCatchesUpMissedMonths(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	ctx := context.Background()

	tenant := seedRoyaltyTenant(t, pg, "ROYALTYMISS1")
	setAutomaticClose(t, pg.DB, tenant, 5, time.Date(2026, time.June, 15, 9, 0, 0, 0, royaltySeoul))
	series := pg.SeedSeries(t, tenant, testutil.SeriesSeed{PublicID: "ROYALTYMSER1"})
	episode := pg.SeedEpisode(t, tenant, series.ID, testutil.EpisodeSeed{
		PublicID: "ROYALTYMEP01",
		Price:    500,
		Status:   testutil.EpisodeStatusPublished,
	})
	creator := pg.SeedCreator(t, tenant, testutil.CreatorSeed{PublicID: "ROYALTYMCR01", Name: "Paid Creator"})
	pg.SeedEpisodeCreator(t, tenant, episode.ID, creator.ID, "")
	if _, err := pg.DB.ExecContext(ctx,
		"UPDATE episode_creators SET share_bps = 1000 WHERE episode_id = $1 AND creator_id = $2", episode.ID, creator.ID,
	); err != nil {
		t.Fatalf("set share: %v", err)
	}
	reader := pg.SeedEndUser(t, tenant, "ROYALTYMRD01", "reader@royaltymiss1.example.com", "Reader")
	seedRoyaltySale(t, pg.DB, tenant, reader.ID, episode.ID, 500, time.Date(2026, time.July, 20, 12, 0, 0, 0, royaltySeoul))

	// July was closed by hand before its close day.
	admin := pg.SeedTenantAdmin(t, tenant, "ROYALTYMAD01", "admin@royaltymiss1.example.com", "Admin")
	manualClose := time.Date(2026, time.August, 1, 10, 0, 0, 0, royaltySeoul)
	july := royalties.Month{TenantID: tenant, Period: time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC), TimeZone: royaltySeoul.String()}
	if _, err := royalties.CloseStatement(ctx, pg.DB, july, uuid.NullUUID{UUID: admin.ID, Valid: true}, manualClose, nil); err != nil {
		t.Fatalf("close July by hand: %v", err)
	}

	deps := Deps{DB: pg.OpenContentStatsDB(t), Logger: discardLogger()}
	if err := (RoyaltyStatementClose{}).run(ctx, deps, time.Date(2026, time.October, 20, 12, 0, 0, 0, royaltySeoul)); err != nil {
		t.Fatalf("run: %v", err)
	}
	assertClosedPeriods(t, pg.DB, tenant, "2026-06", "2026-07", "2026-08", "2026-09")

	var closedBy uuid.NullUUID
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT closed_by_user_id FROM royalty_statements WHERE tenant_id = $1 AND period = '2026-07-01'", tenant,
	).Scan(&closedBy); err != nil {
		t.Fatalf("read July: %v", err)
	}
	if closedBy.UUID != admin.ID {
		t.Fatalf("July closed by %v, want the admin who closed it by hand", closedBy)
	}
	var payout int64
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT total_payout FROM royalty_statements WHERE tenant_id = $1 AND period = '2026-07-01'", tenant,
	).Scan(&payout); err != nil {
		t.Fatalf("read July payout: %v", err)
	}
	if payout != 50 {
		t.Fatalf("July payout = %d, want 50 from the hand close", payout)
	}
}

// Row-level security would hide every tenant's config from a role without
// BYPASSRLS, and a pass that saw none would succeed having closed nothing.
func TestRoyaltyStatementCloseRefusesARoleUnderRowLevelSecurity(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	deps := Deps{DB: pg.OpenAdminDB(t), Logger: discardLogger()}
	if err := (RoyaltyStatementClose{}).Run(context.Background(), deps); err == nil {
		t.Fatal("Run under row-level security returned no error, want one")
	}
}

func seedRoyaltyTenant(t *testing.T, pg *testutil.PostgresEnv, publicID string) uuid.UUID {
	t.Helper()
	tenant := pg.SeedTenant(t, publicID, publicID+".example.com", "Royalty "+publicID)
	setTenantTimeZone(t, pg.DB, tenant.ID, royaltySeoul.String())
	return tenant.ID
}

func setAutomaticClose(t *testing.T, db *sql.DB, tenantID uuid.UUID, closeDay int, since time.Time) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), `
		INSERT INTO tenant_royalty_config (tenant_id, close_mode, auto_close_day, automatic_since)
		VALUES ($1, 'automatic', $2, $3)
	`, tenantID, closeDay, since); err != nil {
		t.Fatalf("set automatic closing: %v", err)
	}
}

func seedRoyaltySale(t *testing.T, db *sql.DB, tenantID, userID, episodeID uuid.UUID, price int32, purchasedAt time.Time) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), `
		INSERT INTO purchases (id, tenant_id, user_id, episode_id, price_at_purchase, purchased_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, uuid.Must(uuid.NewV7()), tenantID, userID, episodeID, price, purchasedAt); err != nil {
		t.Fatalf("insert sale: %v", err)
	}
}

func assertClosedPeriods(t *testing.T, db *sql.DB, tenantID uuid.UUID, want ...string) {
	t.Helper()
	rows, err := db.QueryContext(context.Background(),
		"SELECT period FROM royalty_statements WHERE tenant_id = $1 ORDER BY period", tenantID,
	)
	if err != nil {
		t.Fatalf("list statements: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	got := []string{}
	for rows.Next() {
		var period time.Time
		if err := rows.Scan(&period); err != nil {
			t.Fatalf("scan statement: %v", err)
		}
		got = append(got, royalties.FormatPeriod(period))
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list statements: %v", err)
	}
	if want == nil {
		want = []string{}
	}
	if !slices.Equal(got, want) {
		t.Fatalf("closed months of tenant %s = %v, want %v", tenantID, got, want)
	}
}

func mustLoadLocation(name string) *time.Location {
	location, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return location
}
