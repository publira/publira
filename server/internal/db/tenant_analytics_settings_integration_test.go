package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// A tenant's row loads the tag from Google without asking until it says
// otherwise, and the checks keep out every value the storefront could not
// build a tag from.
func TestTenantAnalyticsSettingsDefaultsAndChecks(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "ANALYTICS001", "analytics.example.com", "admin-analytics.example.com", "Analytics Tenant")
	if _, err := pg.DB.ExecContext(ctx, `INSERT INTO tenant_analytics_settings (tenant_id) VALUES ($1)`, tenantID); err != nil {
		t.Fatalf("insert tenant_analytics_settings: %v", err)
	}
	var servingMode, consentMode string
	if err := pg.DB.QueryRowContext(ctx, `SELECT serving_mode, consent_mode FROM tenant_analytics_settings WHERE tenant_id = $1`, tenantID).Scan(&servingMode, &consentMode); err != nil {
		t.Fatalf("read tenant_analytics_settings: %v", err)
	}
	if servingMode != "google" {
		t.Fatalf("serving_mode = %q, want google", servingMode)
	}
	if consentMode != "not_required" {
		t.Fatalf("consent_mode = %q, want not_required", consentMode)
	}

	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE tenant_analytics_settings
		SET ga4_measurement_id = 'G-ABC123', gtm_container_id = 'GTM-ABC123', serving_mode = 'gateway',
			server_container_url = 'https://sgtm.example.com:8443', gateway_path = '_abcdefghijklmn27',
			consent_mode = 'external'
		WHERE tenant_id = $1
	`, tenantID); err != nil {
		t.Fatalf("store every value: %v", err)
	}
	for name, tt := range map[string]struct{ assignment, check string }{
		"a Universal Analytics ID":            {"ga4_measurement_id = 'UA-1234-1'", "tenant_analytics_settings_ga4_measurement_id_check"},
		"a lowercase measurement ID":          {"ga4_measurement_id = 'G-abc123'", "tenant_analytics_settings_ga4_measurement_id_check"},
		"a container ID without its prefix":   {"gtm_container_id = 'ABC123'", "tenant_analytics_settings_gtm_container_id_check"},
		"an unknown serving mode":             {"serving_mode = 'proxy'", "tenant_analytics_settings_serving_mode_check"},
		"an unknown consent mode":             {"consent_mode = 'banner'", "tenant_analytics_settings_consent_mode_check"},
		"an http server container URL":        {"server_container_url = 'http://sgtm.example.com'", "tenant_analytics_settings_server_container_url_check"},
		"a server container URL with a path":  {"server_container_url = 'https://sgtm.example.com/gtm'", "tenant_analytics_settings_server_container_url_check"},
		"a gateway path a page slug could be": {"gateway_path = 'abcdefghijklmnop'", "tenant_analytics_settings_gateway_path_check"},
		"gateway mode without a path":         {"gateway_path = NULL", "tenant_analytics_settings_gateway_path_required_check"},
		"server container mode without a URL": {"serving_mode = 'server_container', server_container_url = NULL", "tenant_analytics_settings_server_container_required_check"},
		"external consent with no container":  {"gtm_container_id = NULL", "tenant_analytics_settings_external_container_required_check"},
	} {
		_, err := pg.DB.ExecContext(ctx, "UPDATE tenant_analytics_settings SET "+tt.assignment+" WHERE tenant_id = $1", tenantID)
		if !isCheckViolation(err) || checkName(err) != tt.check {
			t.Fatalf("%s: error = %v (%s), want %s", name, err, checkName(err), tt.check)
		}
	}
}
