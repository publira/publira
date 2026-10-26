package publicapi

import (
	"context"
	"testing"
	"time"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedSiteVerification stores a tenant's codes through the superuser
// connection, since the storefront's own role may not write them. An empty
// value is stored as NULL.
func seedSiteVerification(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, google, bing string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_site_verification (tenant_id, google_site_verification, bing_site_verification)
		VALUES ($1, NULLIF($2, ''), NULLIF($3, ''))
	`, tenant.ID, google, bing); err != nil {
		t.Fatalf("insert tenant_site_verification for %s: %v", tenant.PublicID, err)
	}
}

func getDBSiteVerification(t *testing.T, env *publicDBEnv, tenant testutil.Tenant) *publirav1.TenantSiteVerification {
	t.Helper()

	resp, err := env.tenantAPIClient().GetTenantAnalyticsSettings(context.Background(), &publirav1.GetTenantAnalyticsSettingsRequest{
		Tenant: tenantContext(tenant),
	})
	if err != nil {
		t.Fatalf("GetTenantAnalyticsSettings: %v", err)
	}
	return resp.SiteVerification
}

// Each tenant reads back only its own codes, with no credential at all, and
// whether or not it loads a Google tag.
func TestDBGetTenantAnalyticsSettingsAnswersEachTenantItsOwnSiteVerification(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	seedSiteVerification(t, env, first, "TenantAGoogleCode", "TENANTABINGCODE")
	seedSiteVerification(t, env, second, "", "TENANTBBINGCODE")
	seedAnalyticsSettings(t, env, second, "G-TENANTB1", "", "google", "", "")

	for _, tt := range []struct {
		label  string
		tenant testutil.Tenant
		want   *publirav1.TenantSiteVerification
	}{
		{"tenant A", first, &publirav1.TenantSiteVerification{GoogleSiteVerification: "TenantAGoogleCode", BingSiteVerification: "TENANTABINGCODE"}},
		{"tenant B", second, &publirav1.TenantSiteVerification{BingSiteVerification: "TENANTBBINGCODE"}},
	} {
		got := getDBSiteVerification(t, env, tt.tenant)
		if got.GetGoogleSiteVerification() != tt.want.GetGoogleSiteVerification() ||
			got.GetBingSiteVerification() != tt.want.GetBingSiteVerification() {
			t.Fatalf("%s: site verification = %v, want %v", tt.label, got, tt.want)
		}
	}
}

// A tenant that has saved nothing, and one whose codes are both cleared, has no
// site verification in the answer.
func TestDBGetTenantAnalyticsSettingsAnswersNoSiteVerificationWithoutACode(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	seedSiteVerification(t, env, second, "", "")

	if got := getDBSiteVerification(t, env, first); got != nil {
		t.Fatalf("site verification of a tenant that saved nothing = %v, want none", got)
	}
	if got := getDBSiteVerification(t, env, second); got != nil {
		t.Fatalf("site verification of a tenant without a code = %v, want none", got)
	}
}
