package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

const (
	purchaseAll = publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_ALL
	purchaseWeb = publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB
	purchaseApp = publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP
	purchaseNil = publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED
)

func updateDBTenantPurchaseSettings(t *testing.T, env *adminDBEnv, tenant adminDBTenant, settings *publiraadminv1.TenantPurchaseSettings) *publiraadminv1.TenantPurchaseSettings {
	t.Helper()

	updated, err := env.tenantSettingsClient().UpdateTenantPurchaseSettings(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantPurchaseSettingsRequest{
		Tenant:   tenant.tenantContext(),
		Settings: settings,
	}))
	if err != nil {
		t.Fatalf("UpdateTenantPurchaseSettings: %v", err)
	}
	return updated.Msg.Settings
}

// A tenant that has saved nothing sells on both surfaces and lists no app; what
// it saves is what the next read answers, and a store listing that is not an
// https URL is refused without touching what is stored.
func TestDBTenantPurchaseSettingsAreStoredAndReadBack(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.tenantSettingsClient()
	ctx := context.Background()

	initial, err := client.GetTenantPurchaseSettings(ctx, newAdminDBRequest(tenant, &publiraadminv1.GetTenantPurchaseSettingsRequest{Tenant: tenant.tenantContext()}))
	if err != nil {
		t.Fatalf("GetTenantPurchaseSettings: %v", err)
	}
	if got := initial.Msg.Settings; got.PurchaseAvailability != purchaseAll || got.AppStoreUrl != "" || got.GooglePlayUrl != "" {
		t.Fatalf("initial settings = %v, want ALL and no listings", got)
	}

	saved := updateDBTenantPurchaseSettings(t, env, tenant, &publiraadminv1.TenantPurchaseSettings{
		PurchaseAvailability: purchaseApp,
		AppStoreUrl:          " https://apps.apple.com/app/id123456789 ",
		GooglePlayUrl:        "https://play.google.com/store/apps/details?id=com.example.reader",
	})
	if saved.PurchaseAvailability != purchaseApp ||
		saved.AppStoreUrl != "https://apps.apple.com/app/id123456789" ||
		saved.GooglePlayUrl != "https://play.google.com/store/apps/details?id=com.example.reader" {
		t.Fatalf("saved settings = %v, want APP with both listings trimmed", saved)
	}
	read, err := client.GetTenantPurchaseSettings(ctx, newAdminDBRequest(tenant, &publiraadminv1.GetTenantPurchaseSettingsRequest{Tenant: tenant.tenantContext()}))
	if err != nil {
		t.Fatalf("GetTenantPurchaseSettings after save: %v", err)
	}
	if read.Msg.Settings.PurchaseAvailability != purchaseApp || read.Msg.Settings.AppStoreUrl != saved.AppStoreUrl || read.Msg.Settings.GooglePlayUrl != saved.GooglePlayUrl {
		t.Fatalf("read settings = %v, want %v", read.Msg.Settings, saved)
	}

	for _, invalid := range []*publiraadminv1.TenantPurchaseSettings{
		{PurchaseAvailability: purchaseWeb, AppStoreUrl: "http://apps.apple.com/app/id123456789"},
		{PurchaseAvailability: purchaseWeb, GooglePlayUrl: "play.google.com/store/apps/details?id=com.example.reader"},
		{PurchaseAvailability: purchaseWeb, AppStoreUrl: "https://apps.apple.com/app/my app"},
		{PurchaseAvailability: publirattypesv1.SurfaceAvailability(99)},
	} {
		_, err := client.UpdateTenantPurchaseSettings(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantPurchaseSettingsRequest{
			Tenant:   tenant.tenantContext(),
			Settings: invalid,
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("UpdateTenantPurchaseSettings(%v) code = %v, want invalid_argument (err=%v)", invalid, connect.CodeOf(err), err)
		}
	}

	// Clearing a listing and leaving the default unspecified stores what a
	// tenant that never chose has.
	cleared := updateDBTenantPurchaseSettings(t, env, tenant, &publiraadminv1.TenantPurchaseSettings{})
	if cleared.PurchaseAvailability != purchaseAll || cleared.AppStoreUrl != "" || cleared.GooglePlayUrl != "" {
		t.Fatalf("cleared settings = %v, want ALL and no listings", cleared)
	}
}

// The console reads carry an episode's own override beside the value resolved
// through its series and the tenant, and a series' own override beside the
// series; each level replaces the one above it, and an update that leaves the
// series value out keeps it.
func TestDBEpisodePurchaseAvailabilityResolvesThroughTheSeriesAndTheTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := context.Background()
	seriesPublicID := createDBSeries(t, client, tenant, "Sold Apart")
	episodePublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 1)

	assertEpisode := func(step string, wantOverride, wantResolved publirattypesv1.SurfaceAvailability) {
		t.Helper()
		got := getDBEpisode(t, env, tenant, seriesPublicID, episodePublicID)
		if got.PurchaseAvailability != wantOverride || got.Episode.PurchaseAvailability != wantResolved {
			t.Fatalf("%s: episode override, resolved = %s, %s, want %s, %s", step, got.PurchaseAvailability, got.Episode.PurchaseAvailability, wantOverride, wantResolved)
		}
	}
	assertEpisode("nothing set", purchaseNil, purchaseAll)

	updateDBTenantPurchaseSettings(t, env, tenant, &publiraadminv1.TenantPurchaseSettings{PurchaseAvailability: purchaseApp})
	assertEpisode("an app-only tenant", purchaseNil, purchaseApp)

	series, err := client.UpdateSeries(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:               tenant.tenantContext(),
		PublicId:             seriesPublicID,
		Title:                "Sold Apart",
		PurchaseAvailability: purchaseAll.Enum(),
	}))
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if series.Msg.PurchaseAvailability != purchaseAll {
		t.Fatalf("series override = %s, want ALL", series.Msg.PurchaseAvailability)
	}
	assertEpisode("a series selling on both surfaces", purchaseNil, purchaseAll)

	kept, err := client.UpdateSeries(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: seriesPublicID,
		Title:    "Sold Apart, Retitled",
	}))
	if err != nil {
		t.Fatalf("UpdateSeries without purchase availability: %v", err)
	}
	if kept.Msg.PurchaseAvailability != purchaseAll {
		t.Fatalf("series override after an update that omits it = %s, want ALL", kept.Msg.PurchaseAvailability)
	}

	overridden, err := client.UpdateEpisodePurchaseAvailability(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateEpisodePurchaseAvailabilityRequest{
		Tenant:               tenant.tenantContext(),
		EpisodePublicId:      episodePublicID,
		PurchaseAvailability: purchaseWeb,
	}))
	if err != nil {
		t.Fatalf("UpdateEpisodePurchaseAvailability: %v", err)
	}
	if overridden.Msg.PurchaseAvailability != purchaseWeb || overridden.Msg.Episode.PurchaseAvailability != purchaseWeb {
		t.Fatalf("overridden episode = %s, %s, want WEB, WEB", overridden.Msg.PurchaseAvailability, overridden.Msg.Episode.PurchaseAvailability)
	}
	assertEpisode("an episode replacing its series", purchaseWeb, purchaseWeb)

	cleared, err := client.UpdateEpisodePurchaseAvailability(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateEpisodePurchaseAvailabilityRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: episodePublicID,
	}))
	if err != nil {
		t.Fatalf("UpdateEpisodePurchaseAvailability clearing: %v", err)
	}
	if cleared.Msg.PurchaseAvailability != purchaseNil || cleared.Msg.Episode.PurchaseAvailability != purchaseAll {
		t.Fatalf("cleared episode = %s, %s, want UNSPECIFIED, ALL", cleared.Msg.PurchaseAvailability, cleared.Msg.Episode.PurchaseAvailability)
	}

	// Returning the series to following the tenant takes its episodes with it.
	followed, err := client.UpdateSeries(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:               tenant.tenantContext(),
		PublicId:             seriesPublicID,
		Title:                "Sold Apart",
		PurchaseAvailability: purchaseNil.Enum(),
	}))
	if err != nil {
		t.Fatalf("UpdateSeries clearing purchase availability: %v", err)
	}
	if followed.Msg.PurchaseAvailability != purchaseNil {
		t.Fatalf("series override after clearing = %s, want UNSPECIFIED", followed.Msg.PurchaseAvailability)
	}
	got, err := client.GetSeries(ctx, newAdminDBRequest(tenant, &publiraadminv1.GetSeriesRequest{Tenant: tenant.tenantContext(), PublicId: seriesPublicID}))
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if got.Msg.PurchaseAvailability != purchaseNil {
		t.Fatalf("GetSeries override = %s, want UNSPECIFIED", got.Msg.PurchaseAvailability)
	}
	assertEpisode("a series following the tenant again", purchaseNil, purchaseApp)

	created, err := client.CreateEpisode(ctx, newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:               tenant.tenantContext(),
		SeriesPublicId:       seriesPublicID,
		Title:                "Chapter Two",
		PurchaseAvailability: purchaseWeb,
	}))
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	if created.Msg.PurchaseAvailability != purchaseWeb {
		t.Fatalf("created episode override = %s, want WEB", created.Msg.PurchaseAvailability)
	}
	createdSeries, err := client.CreateSeries(ctx, newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:               tenant.tenantContext(),
		Title:                "Web Sales",
		PurchaseAvailability: purchaseWeb,
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if createdSeries.Msg.PurchaseAvailability != purchaseWeb {
		t.Fatalf("created series override = %s, want WEB", createdSeries.Msg.PurchaseAvailability)
	}

	_, err = client.UpdateEpisodePurchaseAvailability(ctx, newAdminDBRequest(tenant, &publiraadminv1.UpdateEpisodePurchaseAvailabilityRequest{
		Tenant:               tenant.tenantContext(),
		EpisodePublicId:      episodePublicID,
		PurchaseAvailability: publirattypesv1.SurfaceAvailability(99),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateEpisodePurchaseAvailability with an unknown value code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBPurchaseAvailabilityOfAnotherTenantIsUntouched(t *testing.T) {
	env := newAdminDBEnv(t)
	owner, other := seedTwoTenants(t, env)
	seriesPublicID := createDBSeries(t, env.seriesClient(), owner, "Owned")
	episodePublicID := createDBEpisodeWithPages(t, env, owner, seriesPublicID, 1)

	_, err := env.seriesClient().UpdateEpisodePurchaseAvailability(context.Background(), newAdminDBRequest(other, &publiraadminv1.UpdateEpisodePurchaseAvailabilityRequest{
		Tenant:               other.tenantContext(),
		EpisodePublicId:      episodePublicID,
		PurchaseAvailability: purchaseApp,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateEpisodePurchaseAvailability code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	// Another tenant's default is not this tenant's.
	updateDBTenantPurchaseSettings(t, env, other, &publiraadminv1.TenantPurchaseSettings{PurchaseAvailability: purchaseApp})
	got := getDBEpisode(t, env, owner, seriesPublicID, episodePublicID)
	if got.PurchaseAvailability != purchaseNil || got.Episode.PurchaseAvailability != purchaseAll {
		t.Fatalf("owner's episode = %s, %s, want UNSPECIFIED, ALL", got.PurchaseAvailability, got.Episode.PurchaseAvailability)
	}
}
