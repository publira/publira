package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/testutil"
)

const testWebServiceToken = "test-web-service-token"

func newServiceRequest[T any](bearer string, msg *T) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+bearer)
	return req
}

func TestDBServiceTokenReadsTheGenresOfTheTenantItNames(t *testing.T) {
	env := newAdminDBEnvWithServiceToken(t, auth.NewServiceToken(testWebServiceToken))
	tenantA := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	tenantB := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	env.PG.SeedGenre(t, tenantA.Tenant.ID, testutil.GenreSeed{Name: "Fantasy", Slug: "fantasy"})
	env.PG.SeedGenre(t, tenantB.Tenant.ID, testutil.GenreSeed{Name: "Mystery", Slug: "mystery"})
	client := env.genreClient()

	listed, err := client.ListGenres(context.Background(), newServiceRequest(testWebServiceToken, &publiraadminv1.ListGenresRequest{
		Tenant: tenantA.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListGenres: %v", err)
	}
	if got := genreNames(listed.Msg.Genres); !slices.Equal(got, []string{"Fantasy"}) {
		t.Fatalf("genres = %v, want only tenant A's", got)
	}

	// An operator's session keeps working beside the token.
	if got := genreNames(listGenres(t, client, tenantA)); !slices.Equal(got, []string{"Fantasy"}) {
		t.Fatalf("genres read by the operator = %v, want [Fantasy]", got)
	}
}

// Every read on the allowlist has to answer without a user behind the call,
// so a handler that starts reading the session fails here rather than in the
// console.
func TestDBServiceTokenAnswersEveryAllowlistedRead(t *testing.T) {
	env := newAdminDBEnvWithServiceToken(t, auth.NewServiceToken(testWebServiceToken))
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	label := env.PG.SeedLabel(t, tenant.Tenant.ID, testutil.LabelSeed{Name: "Label"})
	env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{Name: "Creator"})
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{Title: "Series", LabelID: label.ID})
	episode := env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{Title: "Episode"})
	tenantCtx := tenant.tenantContext()

	httpClient, url := env.Server.Client(), env.Server.URL
	seriesClient := publiraadminv1connect.NewAdminSeriesServiceClient(httpClient, url)
	creatorClient := publiraadminv1connect.NewAdminCreatorServiceClient(httpClient, url)
	labelClient := publiraadminv1connect.NewAdminLabelServiceClient(httpClient, url)
	dashboardClient := publiraadminv1connect.NewAdminDashboardServiceClient(httpClient, url)

	reads := map[string]func(context.Context) error{
		publiraadminv1connect.AdminGenreServiceListGenresProcedure: func(ctx context.Context) error {
			_, err := env.genreClient().ListGenres(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.ListGenresRequest{Tenant: tenantCtx}))
			return err
		},
		publiraadminv1connect.AdminCreatorRoleServiceListCreatorRolesProcedure: func(ctx context.Context) error {
			_, err := env.creatorRoleClient().ListCreatorRoles(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.ListCreatorRolesRequest{Tenant: tenantCtx}))
			return err
		},
		publiraadminv1connect.AdminCreatorServiceListCreatorsProcedure: func(ctx context.Context) error {
			_, err := creatorClient.ListCreators(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.ListCreatorsRequest{Tenant: tenantCtx}))
			return err
		},
		publiraadminv1connect.AdminLabelServiceListLabelsProcedure: func(ctx context.Context) error {
			_, err := labelClient.ListLabels(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.ListLabelsRequest{Tenant: tenantCtx}))
			return err
		},
		publiraadminv1connect.AdminLabelServiceGetLabelProcedure: func(ctx context.Context) error {
			_, err := labelClient.GetLabel(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.GetLabelRequest{Tenant: tenantCtx, PublicId: label.PublicID}))
			return err
		},
		publiraadminv1connect.AdminSeriesServiceListSeriesProcedure: func(ctx context.Context) error {
			_, err := seriesClient.ListSeries(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.ListSeriesRequest{Tenant: tenantCtx}))
			return err
		},
		publiraadminv1connect.AdminSeriesServiceGetSeriesProcedure: func(ctx context.Context) error {
			_, err := seriesClient.GetSeries(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.GetSeriesRequest{Tenant: tenantCtx, PublicId: series.PublicID}))
			return err
		},
		publiraadminv1connect.AdminSeriesServiceListEpisodesProcedure: func(ctx context.Context) error {
			_, err := seriesClient.ListEpisodes(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.ListEpisodesRequest{Tenant: tenantCtx, SeriesId: series.ID.String()}))
			return err
		},
		publiraadminv1connect.AdminSeriesServiceGetEpisodeProcedure: func(ctx context.Context) error {
			_, err := seriesClient.GetEpisode(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.GetEpisodeRequest{Tenant: tenantCtx, SeriesPublicId: series.PublicID, PublicId: episode.PublicID}))
			return err
		},
		publiraadminv1connect.AdminSeriesServiceListEpisodeCreditsProcedure: func(ctx context.Context) error {
			_, err := seriesClient.ListEpisodeCredits(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.ListEpisodeCreditsRequest{Tenant: tenantCtx, EpisodeId: episode.ID.String()}))
			return err
		},
		publiraadminv1connect.AdminSeriesServiceListEpisodeFreeWindowsProcedure: func(ctx context.Context) error {
			_, err := seriesClient.ListEpisodeFreeWindows(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.ListEpisodeFreeWindowsRequest{
				Tenant: tenantCtx,
				Scope:  &publiraadminv1.ListEpisodeFreeWindowsRequest_SeriesId{SeriesId: series.ID.String()},
			}))
			return err
		},
		publiraadminv1connect.AdminSeriesServiceGetSeriesWaitFreeSettingsProcedure: func(ctx context.Context) error {
			_, err := seriesClient.GetSeriesWaitFreeSettings(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.GetSeriesWaitFreeSettingsRequest{Tenant: tenantCtx, SeriesId: series.ID.String()}))
			return err
		},
		publiraadminv1connect.AdminDashboardServiceGetDashboardProcedure: func(ctx context.Context) error {
			_, err := dashboardClient.GetDashboard(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.GetDashboardRequest{Tenant: tenantCtx}))
			return err
		},
	}
	for procedure := range serviceProcedures {
		if _, ok := reads[procedure]; !ok {
			t.Errorf("%s is on the allowlist but not exercised here", procedure)
		}
	}
	for procedure, read := range reads {
		t.Run(procedure, func(t *testing.T) {
			if err := read(t.Context()); err != nil {
				t.Fatalf("%s: %v", procedure, err)
			}
		})
	}
}

func TestDBServiceTokenIsRefusedOutsideTheAllowlist(t *testing.T) {
	env := newAdminDBEnvWithServiceToken(t, auth.NewServiceToken(testWebServiceToken))
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	creator := env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{Name: "Creator"})
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{Title: "Series"})
	episode := env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{Title: "Episode"})
	tenantCtx := tenant.tenantContext()

	calls := map[string]func(context.Context) error{
		"a write": func(ctx context.Context) error {
			_, err := env.genreClient().CreateGenre(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.CreateGenreRequest{Tenant: tenantCtx, Name: "Fantasy"}))
			return err
		},
		"a read that requires the tenant admin role": func(ctx context.Context) error {
			_, err := env.tenantSettingsClient().GetTenantTimezone(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.GetTenantTimezoneRequest{Tenant: tenantCtx}))
			return err
		},
		"a read whose answer depends on the caller's role": func(ctx context.Context) error {
			_, err := publiraadminv1connect.NewAdminCreatorServiceClient(env.Server.Client(), env.Server.URL).GetCreator(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.GetCreatorRequest{Tenant: tenantCtx, PublicId: creator.PublicID}))
			return err
		},
		"a read that signs per-user media tokens": func(ctx context.Context) error {
			_, err := env.seriesClient().ListEpisodeImages(ctx, newServiceRequest(testWebServiceToken, &publiraadminv1.ListEpisodeImagesRequest{Tenant: tenantCtx, EpisodeId: episode.ID.String()}))
			return err
		},
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			if code := connect.CodeOf(call(t.Context())); code != connect.CodePermissionDenied {
				t.Fatalf("code = %v, want %v", code, connect.CodePermissionDenied)
			}
		})
	}
	if count := env.countRows(t, "SELECT count(*) FROM genres WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("genres = %d, want the refused write to have stored none", count)
	}
}

func TestDBServiceTokenIsUnauthenticatedUnlessItIsTheConfiguredOne(t *testing.T) {
	tests := map[string]struct {
		configured *auth.ServiceToken
		bearer     string
	}{
		"a different token":          {configured: auth.NewServiceToken(testWebServiceToken), bearer: "not-" + testWebServiceToken},
		"a server with no token set": {configured: nil, bearer: testWebServiceToken},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			env := newAdminDBEnvWithServiceToken(t, tt.configured)
			tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
			client := env.genreClient()

			_, err := client.ListGenres(t.Context(), newServiceRequest(tt.bearer, &publiraadminv1.ListGenresRequest{Tenant: tenant.tenantContext()}))
			if code := connect.CodeOf(err); code != connect.CodeUnauthenticated {
				t.Fatalf("ListGenres code = %v, want %v", code, connect.CodeUnauthenticated)
			}
			_, err = client.CreateGenre(t.Context(), newServiceRequest(tt.bearer, &publiraadminv1.CreateGenreRequest{Tenant: tenant.tenantContext(), Name: "Fantasy"}))
			if code := connect.CodeOf(err); code != connect.CodeUnauthenticated {
				t.Fatalf("CreateGenre code = %v, want %v", code, connect.CodeUnauthenticated)
			}
		})
	}
}
