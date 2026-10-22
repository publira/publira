package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// Whether a tenant accepts new readers is set from the tenant console. The
// storefront reads it to render the sign-up form and to refuse a sign-up, and
// RLS confines it to its own tenant, which is exactly the tenant whose closed
// sign-up a write from it would reopen.
func TestSignUpSettingsAreReadOnlyToThePublicRole(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	public := pg.OpenPublicDB(t)
	var count int
	if err := public.QueryRowContext(ctx, "SELECT count(*) FROM tenant_sign_up_settings").Scan(&count); err != nil {
		t.Fatalf("read tenant_sign_up_settings as publira_public: %v", err)
	}
	assertRefused(t, ctx, public, "publira_public",
		"INSERT INTO tenant_sign_up_settings (tenant_id) VALUES (gen_random_uuid())")
	assertRefused(t, ctx, public, "publira_public",
		"UPDATE tenant_sign_up_settings SET sign_up_open = true")
	assertRefused(t, ctx, public, "publira_public", "DELETE FROM tenant_sign_up_settings")
}
