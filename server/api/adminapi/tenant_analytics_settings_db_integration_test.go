package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

const (
	googleServing          = publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_GOOGLE
	serverContainerServing = publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_SERVER_CONTAINER
	gatewayServing         = publirattypesv1.GoogleTagServingMode_GOOGLE_TAG_SERVING_MODE_GATEWAY
)

func getDBTenantAnalyticsSettings(t *testing.T, env *adminDBEnv, tenant adminDBTenant) *publiraadminv1.TenantAnalyticsSettings {
	t.Helper()

	resp, err := env.tenantSettingsClient().GetTenantAnalyticsSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetTenantAnalyticsSettingsRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("GetTenantAnalyticsSettings: %v", err)
	}
	return resp.Settings
}

func updateDBTenantAnalyticsSettings(
	env *adminDBEnv,
	tenant adminDBTenant,
	settings *publiraadminv1.TenantAnalyticsSettings,
	regenerateGatewayPath bool,
) (*publiraadminv1.TenantAnalyticsSettings, error) {
	resp, err := env.tenantSettingsClient().UpdateTenantAnalyticsSettings(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateTenantAnalyticsSettingsRequest{
		Tenant:                tenant.tenantContext(),
		Settings:              settings,
		RegenerateGatewayPath: regenerateGatewayPath,
	})
	if err != nil {
		return nil, err
	}
	return resp.Settings, nil
}

func assertAnalyticsSettings(t *testing.T, label string, got *publiraadminv1.TenantAnalyticsSettings, want *publiraadminv1.TenantAnalyticsSettings) {
	t.Helper()

	if got.GetGa4MeasurementId() != want.GetGa4MeasurementId() ||
		got.GetGtmContainerId() != want.GetGtmContainerId() ||
		got.GetServingMode() != want.GetServingMode() ||
		got.GetServerContainerUrl() != want.GetServerContainerUrl() {
		t.Fatalf("%s: settings = %v, want %v", label, got, want)
	}
}

// A tenant that has saved nothing reads as loading no tag from Google, and
// each field is stored normalized, read back, and cleared.
func TestDBTenantAnalyticsSettingsAreStoredReadBackAndCleared(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	assertAnalyticsSettings(t, "initial", getDBTenantAnalyticsSettings(t, env, tenant), &publiraadminv1.TenantAnalyticsSettings{
		ServingMode: googleServing,
	})

	saved, err := updateDBTenantAnalyticsSettings(env, tenant, &publiraadminv1.TenantAnalyticsSettings{
		Ga4MeasurementId:   " g-abc123xyz9 ",
		GtmContainerId:     "gtm-abc1234",
		ServingMode:        serverContainerServing,
		ServerContainerUrl: "HTTPS://Sgtm.Example.com/",
	}, false)
	if err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings: %v", err)
	}
	want := &publiraadminv1.TenantAnalyticsSettings{
		Ga4MeasurementId:   "G-ABC123XYZ9",
		GtmContainerId:     "GTM-ABC1234",
		ServingMode:        serverContainerServing,
		ServerContainerUrl: "https://sgtm.example.com",
	}
	assertAnalyticsSettings(t, "saved", saved, want)
	assertAnalyticsSettings(t, "read", getDBTenantAnalyticsSettings(t, env, tenant), want)
	if saved.GatewayPath != "" {
		t.Fatalf("gateway path outside gateway mode = %q, want none generated", saved.GatewayPath)
	}

	// Clearing both IDs keeps the serving mode and the URL, which load
	// nothing until an ID is named again.
	cleared, err := updateDBTenantAnalyticsSettings(env, tenant, &publiraadminv1.TenantAnalyticsSettings{
		ServingMode:        serverContainerServing,
		ServerContainerUrl: "https://sgtm.example.com",
	}, false)
	if err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings clearing both IDs: %v", err)
	}
	want = &publiraadminv1.TenantAnalyticsSettings{ServingMode: serverContainerServing, ServerContainerUrl: "https://sgtm.example.com"}
	assertAnalyticsSettings(t, "cleared", cleared, want)
	assertAnalyticsSettings(t, "read after clearing", getDBTenantAnalyticsSettings(t, env, tenant), want)

	if _, err := updateDBTenantAnalyticsSettings(env, tenant, &publiraadminv1.TenantAnalyticsSettings{ServingMode: googleServing}, false); err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings clearing the URL: %v", err)
	}
	assertAnalyticsSettings(t, "read after clearing the URL", getDBTenantAnalyticsSettings(t, env, tenant), &publiraadminv1.TenantAnalyticsSettings{
		ServingMode: googleServing,
	})
}

// A refused save leaves what was stored alone.
func TestDBTenantAnalyticsSettingsRefuseAMalformedValue(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	valid := func() *publiraadminv1.TenantAnalyticsSettings {
		return &publiraadminv1.TenantAnalyticsSettings{
			Ga4MeasurementId:   "G-ABC123XYZ9",
			GtmContainerId:     "GTM-ABC1234",
			ServingMode:        serverContainerServing,
			ServerContainerUrl: "https://sgtm.example.com",
		}
	}
	if _, err := updateDBTenantAnalyticsSettings(env, tenant, valid(), false); err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings: %v", err)
	}

	for name, mutate := range map[string]func(*publiraadminv1.TenantAnalyticsSettings){
		"a malformed measurement ID":            func(s *publiraadminv1.TenantAnalyticsSettings) { s.Ga4MeasurementId = "G-ABC 123" },
		"a Universal Analytics ID":              func(s *publiraadminv1.TenantAnalyticsSettings) { s.Ga4MeasurementId = "UA-12345678-1" },
		"a malformed container ID":              func(s *publiraadminv1.TenantAnalyticsSettings) { s.GtmContainerId = "GTM_ABC1234" },
		"no serving mode":                       func(s *publiraadminv1.TenantAnalyticsSettings) { s.ServingMode = 0 },
		"an http server container URL":          func(s *publiraadminv1.TenantAnalyticsSettings) { s.ServerContainerUrl = "http://sgtm.example.com" },
		"a server container URL with a path":    func(s *publiraadminv1.TenantAnalyticsSettings) { s.ServerContainerUrl = "https://sgtm.example.com/gtm" },
		"a server container URL with a query":   func(s *publiraadminv1.TenantAnalyticsSettings) { s.ServerContainerUrl = "https://sgtm.example.com?x=1" },
		"a server container on an IP address":   func(s *publiraadminv1.TenantAnalyticsSettings) { s.ServerContainerUrl = "https://10.0.0.5" },
		"a server container mode without a URL": func(s *publiraadminv1.TenantAnalyticsSettings) { s.ServerContainerUrl = "" },
	} {
		settings := valid()
		mutate(settings)
		if _, err := updateDBTenantAnalyticsSettings(env, tenant, settings, false); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("saving %s: code = %v, want invalid_argument (err=%v)", name, connect.CodeOf(err), err)
		}
	}
	if _, err := updateDBTenantAnalyticsSettings(env, tenant, nil, false); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("saving no settings: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	assertAnalyticsSettings(t, "after refused saves", getDBTenantAnalyticsSettings(t, env, tenant), valid())
}

// The gateway path is generated by the first save in gateway mode, kept by
// every later save whatever it sends, kept across a switch to another mode,
// and replaced only when a save asks for it.
func TestDBTenantAnalyticsGatewayPathIsGeneratedKeptAndRegenerated(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	gateway := func(path string) *publiraadminv1.TenantAnalyticsSettings {
		return &publiraadminv1.TenantAnalyticsSettings{GtmContainerId: "GTM-ABC1234", ServingMode: gatewayServing, GatewayPath: path}
	}

	first, err := updateDBTenantAnalyticsSettings(env, tenant, gateway("_typedbythecaller"), false)
	if err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings in gateway mode: %v", err)
	}
	path := first.GatewayPath
	if path == "" || path == "_typedbythecaller" {
		t.Fatalf("gateway path = %q, want one the server generated", path)
	}

	again, err := updateDBTenantAnalyticsSettings(env, tenant, gateway(""), false)
	if err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings saving again: %v", err)
	}
	if again.GatewayPath != path {
		t.Fatalf("gateway path after saving again = %q, want %q kept", again.GatewayPath, path)
	}

	if _, err := updateDBTenantAnalyticsSettings(env, tenant, &publiraadminv1.TenantAnalyticsSettings{
		GtmContainerId: "GTM-ABC1234", ServingMode: googleServing,
	}, false); err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings switching to Google: %v", err)
	}
	back, err := updateDBTenantAnalyticsSettings(env, tenant, gateway(""), false)
	if err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings switching back: %v", err)
	}
	if back.GatewayPath != path {
		t.Fatalf("gateway path after switching back = %q, want %q kept", back.GatewayPath, path)
	}

	regenerated, err := updateDBTenantAnalyticsSettings(env, tenant, gateway(""), true)
	if err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings regenerating the path: %v", err)
	}
	if regenerated.GatewayPath == "" || regenerated.GatewayPath == path {
		t.Fatalf("gateway path after regenerating = %q, want a new one in place of %q", regenerated.GatewayPath, path)
	}
	if got := getDBTenantAnalyticsSettings(t, env, tenant).GatewayPath; got != regenerated.GatewayPath {
		t.Fatalf("gateway path read back = %q, want %q", got, regenerated.GatewayPath)
	}
}

// Both RPCs belong to a tenant admin: an auditor or an editor can neither read
// nor write the settings.
func TestDBTenantAnalyticsSettingsRequireTenantAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor)
	auditor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER03", "auditor@tenant-a.example.com", "Tenant A Auditor", auth.RoleTenantAuditor)

	for _, seat := range []adminDBTenant{tenant.as(editor), tenant.as(auditor)} {
		_, err := env.tenantSettingsClient().GetTenantAnalyticsSettings(testutil.WithBearer(context.Background(), seat.token()), &publiraadminv1.GetTenantAnalyticsSettingsRequest{
			Tenant: seat.tenantContext(),
		})
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("GetTenantAnalyticsSettings as %s: code = %v, want permission_denied (err=%v)", seat.User.Role, connect.CodeOf(err), err)
		}
		_, err = updateDBTenantAnalyticsSettings(env, seat, &publiraadminv1.TenantAnalyticsSettings{
			Ga4MeasurementId: "G-ABC123XYZ9", ServingMode: googleServing,
		}, false)
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("UpdateTenantAnalyticsSettings as %s: code = %v, want permission_denied (err=%v)", seat.User.Role, connect.CodeOf(err), err)
		}
	}
	if got := getDBTenantAnalyticsSettings(t, env, tenant); got.Ga4MeasurementId != "" {
		t.Fatalf("measurement ID after refused saves = %q, want none", got.Ga4MeasurementId)
	}
}

// Every change drops the storefront's cache of the tag, and saving what the
// tenant already has changes nothing and drops nothing.
func TestDBTenantAnalyticsSettingsRevalidateTheStorefrontTag(t *testing.T) {
	env := newReaderIconDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TASTENANT01", "analytics-revalidate.example.com", "Revalidate", "TASADMIN001", "admin@analytics-revalidate.example.com")
	tag := "tenant:" + tenant.Tenant.ID.String() + ":analytics-settings"
	settings := &publiraadminv1.TenantAnalyticsSettings{Ga4MeasurementId: "G-ABC123XYZ9", ServingMode: googleServing}

	if _, err := updateDBTenantAnalyticsSettings(env, tenant, settings, false); err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings: %v", err)
	}
	if got := env.takeRevalidatedTags(t, tenant.Tenant); !slices.Equal(got, []string{tag}) {
		t.Fatalf("invalidations recorded by a change = %v, want %v", got, []string{tag})
	}
	if _, err := updateDBTenantAnalyticsSettings(env, tenant, settings, false); err != nil {
		t.Fatalf("UpdateTenantAnalyticsSettings saving again: %v", err)
	}
	if got := env.takeRevalidatedTags(t, tenant.Tenant); len(got) != 0 {
		t.Fatalf("invalidations recorded by an unchanged save = %v, want none", got)
	}
}
