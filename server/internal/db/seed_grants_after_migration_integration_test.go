package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// beforeRatingCountsVersion is the migration just before the one that creates
// episode_rating_counts, so migrating up from it creates both rating tallies.
const beforeRatingCountsVersion = 20260910114009

// A deployment applies migrations to a database the seed ran on long ago, and
// every table they create arrives under the seed's ALTER DEFAULT PRIVILEGES.
// The seed's corrections have to reach those tables without the seed running
// again, or a new platform_ table would be readable from a storefront request.
func TestSeedRevokesReachTablesALaterMigrationCreates(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Cleanup(func() { pg.Reset(t) })

	pg.MigrateTo(t, beforeRatingCountsVersion)
	pg.MigrateUpWith(t, map[string]string{
		"99991231235959_platform_grants_probe.up.sql":   "CREATE TABLE platform_grants_probe (id integer PRIMARY KEY);",
		"99991231235959_platform_grants_probe.down.sql": "DROP TABLE platform_grants_probe;",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// The platform role still reads it, so the refusals below come from the
	// revoke rather than from a table the default privileges never reached.
	var count int
	if err := pg.OpenPlatformDB(t).QueryRowContext(ctx, "SELECT count(*) FROM platform_grants_probe").Scan(&count); err != nil {
		t.Fatalf("read platform_grants_probe as the platform role: %v", err)
	}

	for role, conn := range map[string]*sql.DB{
		"publira_public": pg.OpenPublicDB(t),
		"publira_admin":  pg.OpenAdminDB(t),
	} {
		assertRefused(t, ctx, conn, role, "SELECT count(*) FROM platform_grants_probe")
		assertRefused(t, ctx, conn, role, "INSERT INTO platform_grants_probe VALUES (1)")
		for _, table := range []string{"episode_rating_counts", "series_rating_counts"} {
			assertRefused(t, ctx, conn, role, "DELETE FROM "+table)
		}
	}
}
