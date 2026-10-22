package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The crawlers and paths a tenant's robots.txt excludes are set from the
// tenant console. The storefront reads them to write the file, and RLS
// confines it to its own tenant, which is exactly the tenant whose exclusion a
// write from it would lift.
func TestCrawlerSettingsAreReadOnlyToThePublicRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	public := pg.OpenPublicDB(t)
	var count int
	if err := public.QueryRowContext(ctx, "SELECT count(*) FROM tenant_crawler_settings").Scan(&count); err != nil {
		t.Fatalf("read tenant_crawler_settings as publira_public: %v", err)
	}
	assertRefused(t, ctx, public, "publira_public",
		"INSERT INTO tenant_crawler_settings (tenant_id) VALUES (gen_random_uuid())")
	assertRefused(t, ctx, public, "publira_public",
		"UPDATE tenant_crawler_settings SET excluded_user_agents = '{}'")
	assertRefused(t, ctx, public, "publira_public", "DELETE FROM tenant_crawler_settings")
}
