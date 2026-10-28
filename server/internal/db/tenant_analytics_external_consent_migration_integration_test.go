package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the one that added
// consent_mode, and the one that requires a container for external.
const (
	tenantAnalyticsConsentModeVersion              = 20261027101159
	tenantAnalyticsExternalConsentContainerVersion = 20261028091853
)

// A tenant left with external consent and no container, which the release
// before the consent mode could leave behind by clearing the container,
// comes out of the migration asking the reader itself, and a tenant whose
// container is still there keeps leaving the asking to it.
func TestTenantAnalyticsExternalConsentMigrationAsksReadersWithoutAContainer(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	// Behind the migration under test, so the rows seeded below are rows it
	// finds rather than rows written through it.
	pg.MigrateTo(t, tenantAnalyticsConsentModeVersion)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := pg.DB

	withoutContainer := pg.SeedTenantOnOlderSchema(t, "TENANTEXT01", "tenant-ext-1.example.com", "Tenant Without Container")
	withContainer := pg.SeedTenantOnOlderSchema(t, "TENANTEXT02", "tenant-ext-2.example.com", "Tenant With Container")
	mustExec(t, ctx, db, `
		INSERT INTO tenant_analytics_settings (tenant_id, gtm_container_id, consent_mode)
		VALUES ($1, NULL, 'external'), ($2, 'GTM-ABC123', 'external')
	`, withoutContainer.ID, withContainer.ID)

	pg.MigrateTo(t, tenantAnalyticsExternalConsentContainerVersion)

	for _, tc := range []struct {
		name     string
		tenantID any
		want     string
	}{
		{name: "without a container", tenantID: withoutContainer.ID, want: "opt_in"},
		{name: "with a container", tenantID: withContainer.ID, want: "external"},
	} {
		var consentMode string
		if err := db.QueryRowContext(ctx, `SELECT consent_mode FROM tenant_analytics_settings WHERE tenant_id = $1`, tc.tenantID).Scan(&consentMode); err != nil {
			t.Fatalf("%s: read consent_mode: %v", tc.name, err)
		}
		if consentMode != tc.want {
			t.Fatalf("%s: consent_mode = %q, want %q", tc.name, consentMode, tc.want)
		}
	}
}
