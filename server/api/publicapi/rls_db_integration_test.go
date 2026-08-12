package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// These tests bypass the handlers and talk to PostgreSQL as publira_public
// directly. The RPC-level cases prove the handlers filter by tenant; these prove
// the database refuses to hand over another tenant's rows even when a query
// forgets to, which is the guarantee the public API leans on when a storefront
// request is answered on a shared connection pool.

func TestDBPublicRoleSeesOnlyTheScopedTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	mine := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true})
	theirs := env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true})

	env.withTenantConn(t, first.ID, func(ctx context.Context, conn *sql.Conn) {
		var visible int
		if err := conn.QueryRowContext(ctx, "SELECT count(*) FROM series").Scan(&visible); err != nil {
			t.Fatalf("count series: %v", err)
		}
		if visible != 1 {
			t.Fatalf("visible series = %d, want only the one owned by tenant A", visible)
		}

		var title string
		err := conn.QueryRowContext(ctx, "SELECT title FROM series WHERE id = $1", theirs.ID).Scan(&title)
		if !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("read tenant B series as tenant A: err = %v (title %q), want sql.ErrNoRows", err, title)
		}

		if err := conn.QueryRowContext(ctx, "SELECT title FROM series WHERE id = $1", mine.ID).Scan(&title); err != nil {
			t.Fatalf("read own series: %v", err)
		}
		if title != "Tenant A Series" {
			t.Fatalf("own series title = %q, want Tenant A Series", title)
		}
	})
}

// The fail-closed direction: a connection that never set app.current_tenant_id
// sees nothing, so a public code path that skips the tenant-scoping interceptor
// cannot leak one storefront's catalog into another's.
func TestDBPublicRoleSeesNothingWithoutTenantSetting(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true})
	env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := env.PG.OpenPublicDB(t)
	for _, table := range []string{"series", "episodes", "users", "purchases", "pages"} {
		var visible int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&visible); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if visible != 0 {
			t.Fatalf("%s rows visible without a tenant setting = %d, want 0", table, visible)
		}
	}

	// The seeded rows are still there; they are only invisible to this session.
	if count := env.countRows(t, "SELECT count(*) FROM series"); count != 2 {
		t.Fatalf("seeded series = %d, want 2", count)
	}
}
