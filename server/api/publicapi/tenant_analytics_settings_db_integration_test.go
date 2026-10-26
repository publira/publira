package publicapi

import (
	"context"
	"testing"
	"time"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// seedAnalyticsSettings stores a tenant's Google tag through the superuser
// connection, since the storefront's own role may not write it. An empty value
// is stored as NULL.
func seedAnalyticsSettings(
	t *testing.T,
	env *publicDBEnv,
	tenant testutil.Tenant,
	measurementID, containerID, servingMode, serverContainerURL, gatewayPath string,
) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_analytics_settings (tenant_id, ga4_measurement_id, gtm_container_id, serving_mode, server_container_url, gateway_path)
		VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, NULLIF($5, ''), NULLIF($6, ''))
	`, tenant.ID, measurementID, containerID, servingMode, serverContainerURL, gatewayPath); err != nil {
		t.Fatalf("insert tenant_analytics_settings for %s: %v", tenant.PublicID, err)
	}
}

func getDBAnalyticsSettings(t *testing.T, env *publicDBEnv, tenant testutil.Tenant) *publirav1.TenantGoogleTag {
	t.Helper()

	resp, err := env.tenantAPIClient().GetTenantAnalyticsSettings(context.Background(), &publirav1.GetTenantAnalyticsSettingsRequest{
		Tenant: tenantContext(tenant),
	})
	if err != nil {
		t.Fatalf("GetTenantAnalyticsSettings: %v", err)
	}
	return resp.GoogleTag
}

func assertGoogleTag(t *testing.T, label string, got, want *publirav1.TenantGoogleTag) {
	t.Helper()

	if got.GetGa4MeasurementId() != want.GetGa4MeasurementId() ||
		got.GetGtmContainerId() != want.GetGtmContainerId() ||
		got.GetServingMode() != want.GetServingMode() ||
		got.GetServerContainerUrl() != want.GetServerContainerUrl() ||
		got.GetGatewayPath() != want.GetGatewayPath() {
		t.Fatalf("%s: google tag = %v, want %v", label, got, want)
	}
}

// Each tenant reads back only its own tag, with no credential at all.
func TestDBGetTenantAnalyticsSettingsAnswersEachTenantItsOwnTag(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	seedAnalyticsSettings(t, env, first, "G-TENANTA1", "GTM-TENANTA", "server_container", "https://sgtm.tenant-a.example.com", "")
	seedAnalyticsSettings(t, env, second, "G-TENANTB1", "", "google", "", "")

	assertGoogleTag(t, "tenant A", getDBAnalyticsSettings(t, env, first), &publirav1.TenantGoogleTag{
		Ga4MeasurementId:   "G-TENANTA1",
		GtmContainerId:     "GTM-TENANTA",
		ServingMode:        publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_SERVER_CONTAINER,
		ServerContainerUrl: "https://sgtm.tenant-a.example.com",
	})
	assertGoogleTag(t, "tenant B", getDBAnalyticsSettings(t, env, second), &publirav1.TenantGoogleTag{
		Ga4MeasurementId: "G-TENANTB1",
		ServingMode:      publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_GOOGLE,
	})
}

// The answer carries only what the serving mode uses: a URL and a path kept
// for another mode stay out of it.
func TestDBGetTenantAnalyticsSettingsAnswersOnlyWhatTheModeUses(t *testing.T) {
	t.Parallel()

	for name, tt := range map[string]struct {
		mode string
		want *publirav1.TenantGoogleTag
	}{
		"google": {mode: "google", want: &publirav1.TenantGoogleTag{
			GtmContainerId: "GTM-ABC123",
			ServingMode:    publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_GOOGLE,
		}},
		"server container": {mode: "server_container", want: &publirav1.TenantGoogleTag{
			GtmContainerId:     "GTM-ABC123",
			ServingMode:        publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_SERVER_CONTAINER,
			ServerContainerUrl: "https://sgtm.example.com",
		}},
		"gateway": {mode: "gateway", want: &publirav1.TenantGoogleTag{
			GtmContainerId:     "GTM-ABC123",
			ServingMode:        publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_GATEWAY,
			ServerContainerUrl: "https://sgtm.example.com",
			GatewayPath:        "_abcdefghijklmn27",
		}},
	} {
		t.Run(name, func(t *testing.T) {
			env := newPublicDBEnv(t)
			tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
			seedAnalyticsSettings(t, env, tenant, "", "GTM-ABC123", tt.mode, "https://sgtm.example.com", "_abcdefghijklmn27")
			assertGoogleTag(t, name, getDBAnalyticsSettings(t, env, tenant), tt.want)
		})
	}
}

// A tenant that has saved nothing, and one that names neither ID, loads no
// tag, whatever its serving mode holds.
func TestDBGetTenantAnalyticsSettingsAnswersNoTagWithoutAnID(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	seedAnalyticsSettings(t, env, second, "", "", "gateway", "https://sgtm.example.com", "_abcdefghijklmn27")

	if got := getDBAnalyticsSettings(t, env, first); got != nil {
		t.Fatalf("google tag of a tenant that saved nothing = %v, want none", got)
	}
	if got := getDBAnalyticsSettings(t, env, second); got != nil {
		t.Fatalf("google tag of a tenant without an ID = %v, want none", got)
	}
}
