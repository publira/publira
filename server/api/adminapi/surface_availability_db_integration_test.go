package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A series nobody has set is on both surfaces; the value a create or update
// states is what every console read of the series reports afterwards, and the
// console lists the series whatever it is.
func TestDBSeriesAvailabilityIsStoredAndReadBack(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := context.Background()

	defaulted := createDBSeries(t, client, tenant, "Default Availability")
	got, err := client.GetSeries(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.GetSeriesRequest{Tenant: tenant.tenantContext(), PublicId: defaulted})
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if got.Series.Availability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_ALL {
		t.Fatalf("default availability = %s, want ALL", got.Series.Availability)
	}

	created, err := client.CreateSeries(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant:       tenant.tenantContext(),
		Title:        "App Only",
		Availability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if created.Series.Availability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP {
		t.Fatalf("created availability = %s, want APP", created.Series.Availability)
	}

	updated, err := client.UpdateSeries(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:       tenant.tenantContext(),
		SeriesId:     env.seriesID(t, defaulted),
		Title:        "Default Availability",
		Availability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB.Enum(),
	})
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if updated.Series.Availability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB {
		t.Fatalf("updated availability = %s, want WEB", updated.Series.Availability)
	}

	list, err := client.ListSeries(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.ListSeriesRequest{Tenant: tenant.tenantContext()})
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	// An update that leaves the field out keeps what is stored, so a caller that
	// predates it cannot put the series back on both surfaces.
	kept, err := client.UpdateSeries(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: created.Series.Id,
		Title:    "App Only, Retitled",
	})
	if err != nil {
		t.Fatalf("UpdateSeries without availability: %v", err)
	}
	if kept.Series.Availability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP {
		t.Fatalf("availability after an update that omits it = %s, want APP", kept.Series.Availability)
	}

	want := map[string]publirattypesv1.SurfaceAvailability{
		defaulted:               publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB,
		created.Series.PublicId: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
	}
	if len(list.Series) != len(want) {
		t.Fatalf("listed %d series, want %d", len(list.Series), len(want))
	}
	for _, series := range list.Series {
		if series.Availability != want[series.PublicId] {
			t.Fatalf("listed availability of %s = %s, want %s", series.PublicId, series.Availability, want[series.PublicId])
		}
	}

	_, err = client.UpdateSeries(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:       tenant.tenantContext(),
		SeriesId:     env.seriesID(t, defaulted),
		Title:        "Default Availability",
		Availability: publirattypesv1.SurfaceAvailability(99).Enum(),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateSeries with an unknown availability code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	// An explicit unspecified value is a statement rather than an omission, and
	// stores the column's default.
	reset, err := client.UpdateSeries(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateSeriesRequest{
		Tenant:       tenant.tenantContext(),
		SeriesId:     env.seriesID(t, defaulted),
		Title:        "Default Availability",
		Availability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED.Enum(),
	})
	if err != nil {
		t.Fatalf("UpdateSeries with an explicit unspecified availability: %v", err)
	}
	if reset.Series.Availability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_ALL {
		t.Fatalf("availability after an explicit unspecified value = %s, want ALL", reset.Series.Availability)
	}
}

// An episode states nothing until it is given an override, keeps the override
// it is given, and returns to following its series when the override is
// cleared.
func TestDBEpisodeAvailabilityOverridesItsSeries(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := context.Background()
	seriesPublicID := createDBSeries(t, client, tenant, "Episodes Apart")
	episodePublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 1)

	if got := getDBEpisode(t, env, tenant, seriesPublicID, episodePublicID).Episode.Availability; got != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED {
		t.Fatalf("new episode availability = %s, want UNSPECIFIED", got)
	}

	overridden, err := client.UpdateEpisodeAvailability(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateEpisodeAvailabilityRequest{
		Tenant:       tenant.tenantContext(),
		EpisodeId:    env.episodeID(t, episodePublicID),
		Availability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
	})
	if err != nil {
		t.Fatalf("UpdateEpisodeAvailability: %v", err)
	}
	if overridden.Episode.Availability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP {
		t.Fatalf("overridden availability = %s, want APP", overridden.Episode.Availability)
	}

	list, err := client.ListEpisodes(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.ListEpisodesRequest{Tenant: tenant.tenantContext(), SeriesId: env.seriesID(t, seriesPublicID)})
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	if len(list.Episodes) != 1 || list.Episodes[0].Availability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP {
		t.Fatalf("listed episodes = %v, want the one with APP", list.Episodes)
	}

	cleared, err := client.UpdateEpisodeAvailability(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateEpisodeAvailabilityRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, episodePublicID),
	})
	if err != nil {
		t.Fatalf("UpdateEpisodeAvailability clearing: %v", err)
	}
	if cleared.Episode.Availability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED {
		t.Fatalf("cleared availability = %s, want UNSPECIFIED", cleared.Episode.Availability)
	}

	created, err := client.CreateEpisode(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.CreateEpisodeRequest{
		Tenant:       tenant.tenantContext(),
		SeriesId:     env.seriesID(t, seriesPublicID),
		Title:        "Chapter Two",
		Availability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB,
	})
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	if created.Episode.Availability != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_WEB {
		t.Fatalf("created episode availability = %s, want WEB", created.Episode.Availability)
	}

	_, err = client.UpdateEpisodeAvailability(testutil.WithBearer(ctx, tenant.token()), &publiraadminv1.UpdateEpisodeAvailabilityRequest{
		Tenant:       tenant.tenantContext(),
		EpisodeId:    env.episodeID(t, episodePublicID),
		Availability: publirattypesv1.SurfaceAvailability(99),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateEpisodeAvailability with an unknown value code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBUpdateEpisodeAvailabilityOfAnotherTenantReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	owner, other := seedTwoTenants(t, env)
	seriesPublicID := createDBSeries(t, env.seriesClient(), owner, "Owned")
	episodePublicID := createDBEpisodeWithPages(t, env, owner, seriesPublicID, 1)

	_, err := env.seriesClient().UpdateEpisodeAvailability(testutil.WithBearer(context.Background(), other.token()), &publiraadminv1.UpdateEpisodeAvailabilityRequest{
		Tenant:       other.tenantContext(),
		EpisodeId:    env.episodeID(t, episodePublicID),
		Availability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_APP,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateEpisodeAvailability code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if got := getDBEpisode(t, env, owner, seriesPublicID, episodePublicID).Episode.Availability; got != publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_UNSPECIFIED {
		t.Fatalf("availability after a foreign write = %s, want UNSPECIFIED", got)
	}
}
