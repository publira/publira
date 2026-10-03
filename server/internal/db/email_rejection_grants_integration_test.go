package dbtest

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// What a tenant refuses at reader sign-up is set from the tenant console. The
// storefront reads it on every sign-up and email change, and RLS confines it
// to its own tenant, which is exactly the tenant whose rule a write from it
// would lift, so the grant is what keeps the storefront from switching the
// list off or emptying it.
func TestEmailRejectionSettingsAreReadOnlyToThePublicRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	public := pg.OpenPublicDB(t)
	for _, table := range []string{"tenant_email_rejection_settings", "tenant_email_rejection_entries"} {
		var count int
		if err := public.QueryRowContext(ctx, fmt.Sprintf("SELECT count(*) FROM %s", table)).Scan(&count); err != nil {
			t.Fatalf("read %s as publira_public: %v", table, err)
		}
		assertRefused(t, ctx, public, "publira_public", fmt.Sprintf("DELETE FROM %s", table))
	}
	assertRefused(t, ctx, public, "publira_public",
		"INSERT INTO tenant_email_rejection_settings (tenant_id) VALUES (gen_random_uuid())")
	assertRefused(t, ctx, public, "publira_public",
		"UPDATE tenant_email_rejection_settings SET reject_disposable_domains = false")
	assertRefused(t, ctx, public, "publira_public",
		"INSERT INTO tenant_email_rejection_entries (tenant_id, entry) VALUES (gen_random_uuid(), 'blocked.example')")
}
