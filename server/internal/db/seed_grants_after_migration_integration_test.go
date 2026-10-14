package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// beforeRatingCountsVersion is the migration just before the one that creates
// episode_rating_counts, so migrating up from it creates both rating tallies.
const beforeRatingCountsVersion = 20260910114009

const grantsProbeUp = `
CREATE TABLE platform_grants_probe (id integer PRIMARY KEY);
CREATE TABLE tenant_grants_probe (tenant_id uuid NOT NULL, id integer NOT NULL, PRIMARY KEY (tenant_id, id));
ALTER TABLE tenant_grants_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_grants_probe_tenant_isolation ON tenant_grants_probe
    USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
    WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
`

// A deployment applies migrations to a database the seed ran on long ago, and
// runs the seed again right after them, as every upgrade does with db roles.
// In between, a table a migration created reaches no app role at all, so a new
// platform_ table is never readable from a storefront request. Once the seed
// has run, the table reaches each role the way the tables before it do: the
// grants with their corrections, and every tenant's rows for the roles that
// work across tenants.
func TestSeedReachesTablesALaterMigrationCreatesWhenItRunsAgain(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Cleanup(func() { pg.Reset(t) })

	pg.MigrateTo(t, beforeRatingCountsVersion)
	pg.MigrateUpWith(t, map[string]string{
		"99991231235959_grants_probe.up.sql":   grantsProbeUp,
		"99991231235959_grants_probe.down.sql": "DROP TABLE tenant_grants_probe; DROP TABLE platform_grants_probe;",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenants := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}
	for i, tenant := range tenants {
		if _, err := pg.DB.ExecContext(ctx, "INSERT INTO tenant_grants_probe VALUES ($1, $2)", tenant, i); err != nil {
			t.Fatalf("seed tenant_grants_probe: %v", err)
		}
	}

	platform := pg.OpenPlatformDB(t)
	contentStats := pg.OpenContentStatsDB(t)
	public := pg.OpenPublicDB(t)
	admin := pg.OpenAdminDB(t)
	everyRole := map[string]*sql.DB{
		"publira_platform":      platform,
		"publira_content_stats": contentStats,
		"publira_public":        public,
		"publira_admin":         admin,
	}
	for role, conn := range everyRole {
		assertRefused(t, ctx, conn, role, "SELECT count(*) FROM platform_grants_probe")
		assertRefused(t, ctx, conn, role, "SELECT count(*) FROM tenant_grants_probe")
	}

	pg.ApplyRoles(t)

	// The platform role reads it now, so the refusals below come from the
	// revoke rather than from a table the grants never reached.
	var count int
	if err := platform.QueryRowContext(ctx, "SELECT count(*) FROM platform_grants_probe").Scan(&count); err != nil {
		t.Fatalf("read platform_grants_probe as the platform role: %v", err)
	}
	for role, conn := range map[string]*sql.DB{
		"publira_public": public,
		"publira_admin":  admin,
	} {
		assertRefused(t, ctx, conn, role, "SELECT count(*) FROM platform_grants_probe")
		assertRefused(t, ctx, conn, role, "INSERT INTO platform_grants_probe VALUES (1)")
		for _, table := range []string{"episode_rating_counts", "series_rating_counts"} {
			assertRefused(t, ctx, conn, role, "DELETE FROM "+table)
		}
	}

	for role, conn := range everyRole {
		want := len(tenants)
		if role == "publira_public" || role == "publira_admin" {
			want = 0
		}
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM tenant_grants_probe").Scan(&count); err != nil {
			t.Fatalf("read tenant_grants_probe as %s: %v", role, err)
		}
		if count != want {
			t.Errorf("%s with no tenant set reads %d rows of tenant_grants_probe, want %d", role, count, want)
		}
	}
}

// A policy named publira_rls_bypass that says anything but what the seed puts
// there, here one widened to every role, is replaced the next time the seed
// runs, so a storefront connection does not keep every tenant's rows through
// it.
func TestSeedRepairsABypassPolicyThatSaysSomethingElse(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Cleanup(func() { pg.Reset(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pg.SeedTenant(t, "TENANT001", "first.example.com", "First")
	if _, err := pg.DB.ExecContext(ctx, "ALTER POLICY publira_rls_bypass ON creator_roles TO PUBLIC"); err != nil {
		t.Fatalf("widen the policy: %v", err)
	}
	public := pg.OpenPublicDB(t)
	countCreatorRoles := func() int {
		t.Helper()
		var count int
		if err := public.QueryRowContext(ctx, "SELECT count(*) FROM creator_roles").Scan(&count); err != nil {
			t.Fatalf("read creator_roles as publira_public: %v", err)
		}
		return count
	}
	// The widened policy lets the storefront role read rows with no tenant
	// set, so the zero below is the repair's doing.
	if countCreatorRoles() == 0 {
		t.Fatal("publira_public reads no creator_roles through the widened policy")
	}

	pg.ApplyRoles(t)

	if count := countCreatorRoles(); count != 0 {
		t.Errorf("publira_public with no tenant set reads %d rows of creator_roles after the seed ran again, want 0", count)
	}
}
