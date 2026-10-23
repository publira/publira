package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// A tenant's search engine verification codes are set from the tenant
// console. The storefront reads them to render every page, and a code it could
// write would prove ownership of the tenant's site to whoever the code belongs
// to, so the grant is what keeps it to reading.
func TestSiteVerificationIsReadOnlyToThePublicRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	public := pg.OpenPublicDB(t)
	var count int
	if err := public.QueryRowContext(ctx, "SELECT count(*) FROM tenant_site_verification").Scan(&count); err != nil {
		t.Fatalf("read tenant_site_verification as publira_public: %v", err)
	}
	assertRefused(t, ctx, public, "publira_public",
		"INSERT INTO tenant_site_verification (tenant_id) VALUES (gen_random_uuid())")
	assertRefused(t, ctx, public, "publira_public",
		"UPDATE tenant_site_verification SET google_site_verification = 'OtherCode'")
	assertRefused(t, ctx, public, "publira_public", "DELETE FROM tenant_site_verification")
}
