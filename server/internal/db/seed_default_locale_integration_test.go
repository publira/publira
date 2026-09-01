package dbmodels_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

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
		statements, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		if _, err := pg.DB.ExecContext(ctx, string(statements)); err != nil {
			t.Fatalf("apply %s: %v", path, err)
		}
	}

	assertStoredLocalesResolve(ctx, t, pg.DB, "tenants", `SELECT public_id, default_locale FROM tenants`)
	assertStoredLocalesResolve(ctx, t, pg.DB, "platform_config", `SELECT 'singleton', default_locale FROM platform_config`)
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
