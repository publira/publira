package dbtest

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The checks keep out every value that is not a bare code, and with it every
// character that could close the attribute the storefront writes it into.
func TestTenantSiteVerificationChecks(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "SITEVERIFY01", "site-verify.example.com", "admin-site-verify.example.com", "Site Verification Tenant")
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_site_verification (tenant_id, google_site_verification, bing_site_verification)
		VALUES ($1, 'AbC-123_xyz', $2)
	`, tenantID, strings.Repeat("A", 128)); err != nil {
		t.Fatalf("store both codes: %v", err)
	}
	for name, tt := range map[string]struct{ assignment, check string }{
		"a Google code with a quote":    {`google_site_verification = 'abc"def'`, "tenant_site_verification_google_check"},
		"a Google code with a space":    {"google_site_verification = 'abc def'", "tenant_site_verification_google_check"},
		"an empty Google code":          {"google_site_verification = ''", "tenant_site_verification_google_check"},
		"a whole meta element for Bing": {`bing_site_verification = '<meta name="msvalidate.01" content="ABC" />'`, "tenant_site_verification_bing_check"},
		"a Bing code longer than 128":   {"bing_site_verification = '" + strings.Repeat("A", 129) + "'", "tenant_site_verification_bing_check"},
	} {
		_, err := pg.DB.ExecContext(ctx, "UPDATE tenant_site_verification SET "+tt.assignment+" WHERE tenant_id = $1", tenantID)
		if !isCheckViolation(err) || checkName(err) != tt.check {
			t.Fatalf("%s: error = %v (%s), want %s", name, err, checkName(err), tt.check)
		}
	}
}
