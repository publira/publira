package dbtest

import (
	"context"
	"database/sql"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/lib/pq"

	"github.com/publira/publira/server/internal/locale"
	"github.com/publira/publira/server/internal/testutil"
)

// The checked-in seeds are the database local development and E2E run against,
// and they write default_locale straight into the tables, where the only
// constraint is that some value is named. A seed saying "jp" or "ja-JP" would
// apply cleanly and then fail every read that has to resolve a locale, now that
// no read answers an unusable value with a language of its own. So the seeds are
// applied here and their stored codes checked against the supported set.
func TestSeedsNameSupportedDefaultLocales(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	for _, path := range seedSQLFiles(t) {
		// `task db:seed` passes the edge port the seeded tenant hosts carry.
		vars := map[string]string{"tenant_port": "3080"}
		if _, err := pg.DB.ExecContext(ctx, readSeedSQL(t, path, vars)); err != nil {
			t.Fatalf("apply %s: %v", path, err)
		}
	}

	assertStoredLocalesResolve(ctx, t, pg.DB, "tenants", `SELECT public_id, default_locale FROM tenants`)
	assertStoredLocalesResolve(ctx, t, pg.DB, "platform_config", `SELECT 'singleton', default_locale FROM platform_config`)
	assertStoredSupportedLocalesResolve(ctx, t, pg.DB)
}

// The same holds for the locales a seeded tenant offers: a set naming a code
// the registry does not know fails every read of the tenant.
func assertStoredSupportedLocalesResolve(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `SELECT public_id, supported_locales FROM tenants`)
	if err != nil {
		t.Fatalf("read tenants supported_locales: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	for rows.Next() {
		var row string
		var stored []string
		if err := rows.Scan(&row, pq.Array(&stored)); err != nil {
			t.Fatalf("scan tenants supported_locales: %v", err)
		}
		if _, err := locale.ResolveSupported(stored); err != nil {
			t.Errorf("tenants row %s seeds supported_locales %q, which names an unsupported locale: %v", row, stored, err)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate tenants supported_locales: %v", err)
	}
}

// seedSQLFiles lists the seeds that carry application data, in the order
// db/seeds/dev.sql applies them: the numeric prefixes are the order, and the
// scenarios go on top of the development set.
func seedSQLFiles(t *testing.T) []string {
	t.Helper()

	paths := make([]string, 0, 16)
	for _, dir := range []string{"dev", "scenarios"} {
		matches, err := filepath.Glob(filepath.Join("..", "..", "..", "db", "seeds", dir, "*.sql"))
		if err != nil {
			t.Fatalf("glob %s seeds: %v", dir, err)
		}
		if len(matches) == 0 {
			t.Fatalf("no seed files found under db/seeds/%s", dir)
		}
		slices.Sort(matches)
		paths = append(paths, matches...)
	}
	return paths
}

// readSeedSQL reads one seed file the way psql would, as testutil.SeedSQL
// does. The driver these statements are sent through knows neither directive,
// so without this a shared block fails to parse.
func readSeedSQL(t *testing.T, path string, vars map[string]string) string {
	t.Helper()
	return testutil.SeedSQL(t, path, vars)
}

func assertStoredLocalesResolve(ctx context.Context, t *testing.T, db *sql.DB, table, query string) {
	t.Helper()

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		t.Fatalf("read %s locales: %v", table, err)
	}
	defer rows.Close() //nolint:errcheck

	seeded := 0
	for rows.Next() {
		var row, stored string
		if err := rows.Scan(&row, &stored); err != nil {
			t.Fatalf("scan %s locale: %v", table, err)
		}
		seeded++
		if _, err := locale.Resolve(stored); err != nil {
			t.Errorf("%s row %s seeds default_locale %q, which resolves to no supported locale: %v", table, row, stored, err)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate %s locales: %v", table, err)
	}
	if seeded == 0 {
		t.Fatalf("the seeds wrote no %s row to check", table)
	}
}
