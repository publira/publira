package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The Google tag a tenant's storefront loads is set from the tenant console.
// The storefront reads it to render every page, and RLS confines it to its own
// tenant, which is exactly the tenant whose readers a tag written from it
// would be sent to, so the grant is what keeps the storefront from pointing
// the tag somewhere else.
func TestAnalyticsSettingsAreReadOnlyToThePublicRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	public := pg.OpenPublicDB(t)
	var count int
	if err := public.QueryRowContext(ctx, "SELECT count(*) FROM tenant_analytics_settings").Scan(&count); err != nil {
		t.Fatalf("read tenant_analytics_settings as publira_public: %v", err)
	}
	assertRefused(t, ctx, public, "publira_public",
		"INSERT INTO tenant_analytics_settings (tenant_id) VALUES (gen_random_uuid())")
	assertRefused(t, ctx, public, "publira_public",
		"UPDATE tenant_analytics_settings SET gtm_container_id = 'GTM-OTHER'")
	assertRefused(t, ctx, public, "publira_public", "DELETE FROM tenant_analytics_settings")
}
