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

// publicDataTables are the tables a storefront request reads that hold tenant
// data. Each query is a literal so the count cannot be assembled from a name at
// runtime, and so a table added here without a policy is a failing test rather
// than a silent zero.
var publicDataTables = []struct {
	name  string
	count string
}{
	{name: "series", count: "SELECT count(*) FROM series"},
	{name: "episodes", count: "SELECT count(*) FROM episodes"},
	{name: "episode_listings", count: "SELECT count(*) FROM episode_listings"},
	{name: "episode_reads", count: "SELECT count(*) FROM episode_reads"},
	{name: "users", count: "SELECT count(*) FROM users"},
	{name: "purchases", count: "SELECT count(*) FROM purchases"},
	{name: "pages", count: "SELECT count(*) FROM pages"},
	{name: "page_versions", count: "SELECT count(*) FROM page_versions"},
}

// The fail-closed direction: a connection that never set app.current_tenant_id
// sees nothing, so a public code path that skips the tenant-scoping interceptor
// cannot leak one storefront's catalog into another's. Every table is seeded
// first — a count of zero over an empty table would hold whether or not the
// policy is there.
func TestDBPublicRoleSeesNothingWithoutTenantSetting(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	series := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true})
	env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true})
	episode := env.PG.SeedEpisode(t, first.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEA0001",
		Title:    "Tenant A Episode",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	member := env.PG.SeedEndUser(t, first.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	env.PG.SeedPurchase(t, first.ID, member.ID, episode.ID, episode.Price)
	if _, err := env.PG.DB.ExecContext(context.Background(), "INSERT INTO episode_reads (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)", first.ID, member.ID, episode.ID); err != nil {
		t.Fatalf("seed episode read: %v", err)
	}
	env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := env.PG.OpenPublicDB(t)
	for _, table := range publicDataTables {
		// The seed has to have landed, otherwise the assertion below is vacuous.
		if seeded := env.countRows(t, table.count); seeded == 0 {
			t.Fatalf("seeded %s rows = 0, want the fail-closed check to run against real rows", table.name)
		}

		var visible int
		if err := db.QueryRowContext(ctx, table.count).Scan(&visible); err != nil {
			t.Fatalf("count %s: %v", table.name, err)
		}
		if visible != 0 {
			t.Fatalf("%s rows visible without a tenant setting = %d, want 0", table.name, visible)
		}
	}
}
