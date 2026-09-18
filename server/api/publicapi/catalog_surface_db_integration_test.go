package publicapi

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/contentranking"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// surfaceCatalog is a tenant holding one series on each availability, all three
// credited to the same creator and filed under the same label, genre, and tag,
// so every read that lists series or counts them has all three to choose from.
type surfaceCatalog struct {
	tenant  testutil.Tenant
	both    testutil.Series
	webOnly testutil.Series
	appOnly testutil.Series
	creator testutil.Creator
	label   testutil.Label
}

func (e *publicDBEnv) seedSurfaceCatalog(t *testing.T) surfaceCatalog {
	t.Helper()

	tenant := e.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	label := e.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELSURF001", Name: "Harbor Books"})
	creator := e.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORSURF1", Name: "Aoi Sakura"})
	genre := e.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENRESURF001", Name: "Fantasy"})
	tag := e.PG.SeedTag(t, tenant.ID, testutil.TagSeed{Name: "Harbor"})

	seed := func(publicID, title, availability string) testutil.Series {
		series := e.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:     publicID,
			Title:        title,
			LabelID:      label.ID,
			Published:    true,
			Availability: availability,
		})
		e.PG.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")
		e.PG.SeedSeriesGenre(t, tenant.ID, series.ID, genre.ID)
		e.PG.SeedSeriesTag(t, tenant.ID, series.ID, tag.ID)
		e.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: publicID[:8] + "EP01", Status: testutil.EpisodeStatusPublished})
		return series
	}
	catalog := surfaceCatalog{
		tenant:  tenant,
		both:    seed("SERIESBOTH01", "Harbor Both", "all"),
		webOnly: seed("SERIESWEB001", "Harbor Web", "web"),
		appOnly: seed("SERIESAPP001", "Harbor App", "app"),
		creator: creator,
		label:   label,
	}
	e.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.DailyRankingKey, rankingPeriodDate(0),
		catalog.both.ID, catalog.webOnly.ID, catalog.appOnly.ID)
	return catalog
}

func seriesPublicIDsOf(items []*publirattypesv1.Series) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.GetPublicId())
	}
	slices.Sort(ids)
	return ids
}

func assertConnectCode(t *testing.T, err error, want connect.Code) {
	t.Helper()

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != want {
		t.Fatalf("error = %v, want %s", err, want)
	}
}

// A series is present in every read of the surfaces it may be shown on and
// absent from every read of the one it may not, and a caller that names no
// surface is answered as the storefront.
func TestDBCatalogShowsASeriesOnlyOnItsSurfaces(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := env.seedSurfaceCatalog(t)
	ctx := context.Background()
	client := env.catalogClient()
	tenant := tenantContext(catalog.tenant)

	tests := []struct {
		name    string
		surface publirattypesv1.ClientSurface
		shown   testutil.Series
		hidden  testutil.Series
	}{
		{name: "unnamed", surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_UNSPECIFIED, shown: catalog.webOnly, hidden: catalog.appOnly},
		{name: "web", surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB, shown: catalog.webOnly, hidden: catalog.appOnly},
		{name: "app", surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_APP, shown: catalog.appOnly, hidden: catalog.webOnly},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			want := []string{catalog.both.PublicID, tc.shown.PublicID}
			slices.Sort(want)
			assertSeries := func(read string, items []*publirattypesv1.Series) {
				t.Helper()
				if got := seriesPublicIDsOf(items); !slices.Equal(got, want) {
					t.Fatalf("%s = %v, want %v", read, got, want)
				}
			}

			list, err := client.ListPublishedSeries(ctx, connect.NewRequest(&publirav1.ListPublishedSeriesRequest{Tenant: tenant, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("ListPublishedSeries: %v", err)
			}
			assertSeries("ListPublishedSeries", list.Msg.Series)

			search, err := client.SearchPublishedSeries(ctx, connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{Tenant: tenant, Query: "Harbor", Surface: tc.surface}))
			if err != nil {
				t.Fatalf("SearchPublishedSeries: %v", err)
			}
			assertSeries("SearchPublishedSeries", search.Msg.Series)

			recommended, err := client.ListRecommendedSeries(ctx, connect.NewRequest(&publirav1.ListRecommendedSeriesRequest{Tenant: tenant, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("ListRecommendedSeries: %v", err)
			}
			assertSeries("ListRecommendedSeries", recommended.Msg.Series)

			ranked, err := client.ListRankedSeries(ctx, connect.NewRequest(&publirav1.ListRankedSeriesRequest{Tenant: tenant, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("ListRankedSeries: %v", err)
			}
			rankedSeries := make([]*publirattypesv1.Series, 0, len(ranked.Msg.RankedSeries))
			for _, item := range ranked.Msg.RankedSeries {
				rankedSeries = append(rankedSeries, item.GetSeries())
			}
			assertSeries("ListRankedSeries", rankedSeries)

			related, err := client.ListRelatedSeries(ctx, connect.NewRequest(&publirav1.ListRelatedSeriesRequest{Tenant: tenant, SeriesPublicId: catalog.both.PublicID, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("ListRelatedSeries: %v", err)
			}
			if got := seriesPublicIDsOf(related.Msg.Series); !slices.Equal(got, []string{tc.shown.PublicID}) {
				t.Fatalf("ListRelatedSeries = %v, want [%s]", got, tc.shown.PublicID)
			}

			creator, err := client.GetPublishedCreatorDetail(ctx, connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{Tenant: tenant, PublicId: catalog.creator.PublicID, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("GetPublishedCreatorDetail: %v", err)
			}
			assertSeries("GetPublishedCreatorDetail", creator.Msg.Series)
			if got := creator.Msg.Creator.GetPublishedSeriesCount(); got != 2 {
				t.Fatalf("creator published_series_count = %d, want 2", got)
			}

			creators, err := client.ListPublishedCreators(ctx, connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{Tenant: tenant, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("ListPublishedCreators: %v", err)
			}
			if len(creators.Msg.Creators) != 1 || creators.Msg.Creators[0].GetPublishedSeriesCount() != 2 {
				t.Fatalf("ListPublishedCreators = %v, want the one creator with 2 series", creators.Msg.Creators)
			}

			label, err := client.GetPublishedLabelDetail(ctx, connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{Tenant: tenant, PublicId: catalog.label.PublicID, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("GetPublishedLabelDetail: %v", err)
			}
			assertSeries("GetPublishedLabelDetail", label.Msg.Series)
			if got := label.Msg.Label.GetPublishedSeriesCount(); got != 2 {
				t.Fatalf("label published_series_count = %d, want 2", got)
			}

			genres, err := client.ListPublishedGenres(ctx, connect.NewRequest(&publirav1.ListPublishedGenresRequest{Tenant: tenant, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("ListPublishedGenres: %v", err)
			}
			if len(genres.Msg.Genres) != 1 || genres.Msg.Genres[0].GetPublishedSeriesCount() != 2 {
				t.Fatalf("ListPublishedGenres = %v, want the one genre with 2 series", genres.Msg.Genres)
			}

			tags, err := client.ListPublishedTags(ctx, connect.NewRequest(&publirav1.ListPublishedTagsRequest{Tenant: tenant, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("ListPublishedTags: %v", err)
			}
			if len(tags.Msg.Tags) != 1 || tags.Msg.Tags[0].GetPublishedSeriesCount() != 2 {
				t.Fatalf("ListPublishedTags = %v, want the one tag with 2 series", tags.Msg.Tags)
			}

			if _, err := client.GetSeriesDetail(ctx, connect.NewRequest(&publirav1.GetSeriesDetailRequest{Tenant: tenant, PublicId: tc.shown.PublicID, Surface: tc.surface})); err != nil {
				t.Fatalf("GetSeriesDetail of a shown series: %v", err)
			}

			// A direct read of the hidden series answers as a missing one does,
			// so its URL says nothing about whether it exists.
			_, err = client.GetSeriesDetail(ctx, connect.NewRequest(&publirav1.GetSeriesDetailRequest{Tenant: tenant, PublicId: tc.hidden.PublicID, Surface: tc.surface}))
			assertConnectCode(t, err, connect.CodeNotFound)
			_, err = client.GetSeriesEpisodeAccess(ctx, connect.NewRequest(&publirav1.GetSeriesEpisodeAccessRequest{Tenant: tenant, SeriesPublicId: tc.hidden.PublicID, Surface: tc.surface}))
			assertConnectCode(t, err, connect.CodeNotFound)
			_, err = client.ListRelatedSeries(ctx, connect.NewRequest(&publirav1.ListRelatedSeriesRequest{Tenant: tenant, SeriesPublicId: tc.hidden.PublicID, Surface: tc.surface}))
			assertConnectCode(t, err, connect.CodeNotFound)
			_, err = client.GetEpisodeDetail(ctx, connect.NewRequest(&publirav1.GetEpisodeDetailRequest{Tenant: tenant, PublicId: tc.hidden.PublicID[:8] + "EP01", Surface: tc.surface}))
			assertConnectCode(t, err, connect.CodeNotFound)
		})
	}
}

// An episode that narrows its series' availability is left out of every read
// of the surface it is kept off — the series' episode list, its free count, its
// access list, and the links from the episodes either side — and a direct read
// of it is refused the way an unpublished one is.
func TestDBCatalogShowsAnEpisodeOnlyOnItsSurfaces(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESEPS001", Title: "Episodes Apart", Published: true})
	first := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEONE01", Status: testutil.EpisodeStatusPublished, Price: 100})
	appOnly := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEAPP01", Status: testutil.EpisodeStatusPublished, Availability: "app"})
	third := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODETHR01", Status: testutil.EpisodeStatusPublished, Price: 100})

	ctx := context.Background()
	client := env.catalogClient()

	tests := []struct {
		name         string
		surface      publirattypesv1.ClientSurface
		wantEpisodes []string
		wantFree     int32
		wantNext     string
	}{
		{name: "web", surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB, wantEpisodes: []string{first.PublicID, third.PublicID}, wantFree: 0, wantNext: third.PublicID},
		{name: "app", surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_APP, wantEpisodes: []string{first.PublicID, appOnly.PublicID, third.PublicID}, wantFree: 1, wantNext: appOnly.PublicID},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			detail, err := client.GetSeriesDetail(ctx, connect.NewRequest(&publirav1.GetSeriesDetailRequest{Tenant: tenantContext(tenant), PublicId: series.PublicID, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("GetSeriesDetail: %v", err)
			}
			episodes := make([]string, 0, len(detail.Msg.Episodes))
			for _, episode := range detail.Msg.Episodes {
				episodes = append(episodes, episode.GetPublicId())
			}
			if !slices.Equal(episodes, tc.wantEpisodes) {
				t.Fatalf("series episodes = %v, want %v", episodes, tc.wantEpisodes)
			}
			if got := detail.Msg.Series.GetFreeEpisodeCount(); got != tc.wantFree {
				t.Fatalf("free_episode_count = %d, want %d", got, tc.wantFree)
			}

			list, err := client.ListPublishedSeries(ctx, connect.NewRequest(&publirav1.ListPublishedSeriesRequest{Tenant: tenantContext(tenant), Surface: tc.surface}))
			if err != nil {
				t.Fatalf("ListPublishedSeries: %v", err)
			}
			if len(list.Msg.Series) != 1 || list.Msg.Series[0].GetFreeEpisodeCount() != tc.wantFree {
				t.Fatalf("listed series = %v, want one with %d free episodes", list.Msg.Series, tc.wantFree)
			}

			access, err := client.GetSeriesEpisodeAccess(ctx, connect.NewRequest(&publirav1.GetSeriesEpisodeAccessRequest{Tenant: tenantContext(tenant), SeriesPublicId: series.PublicID, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("GetSeriesEpisodeAccess: %v", err)
			}
			accessEpisodes := make([]string, 0, len(access.Msg.Episodes))
			for _, episode := range access.Msg.Episodes {
				accessEpisodes = append(accessEpisodes, episode.GetEpisodePublicId())
			}
			if !slices.Equal(accessEpisodes, tc.wantEpisodes) {
				t.Fatalf("access episodes = %v, want %v", accessEpisodes, tc.wantEpisodes)
			}

			episode, err := client.GetEpisodeDetail(ctx, connect.NewRequest(&publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: first.PublicID, Surface: tc.surface}))
			if err != nil {
				t.Fatalf("GetEpisodeDetail: %v", err)
			}
			if got := episode.Msg.NextEpisode.GetPublicId(); got != tc.wantNext {
				t.Fatalf("next episode = %q, want %q", got, tc.wantNext)
			}
		})
	}

	_, err := client.GetEpisodeDetail(ctx, connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: appOnly.PublicID,
		Surface:  publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB,
	}))
	assertConnectCode(t, err, connect.CodeNotFound)
	previous, err := client.GetEpisodeDetail(ctx, connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: third.PublicID,
		Surface:  publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail of the last episode: %v", err)
	}
	if got := previous.Msg.PreviousEpisode.GetPublicId(); got != first.PublicID {
		t.Fatalf("previous episode on the web = %q, want %q", got, first.PublicID)
	}
}

// The series bounds its episodes: an episode stating both surfaces is still
// kept off a surface its series is kept off, because the episode read would
// otherwise carry that series onto it.
func TestDBCatalogKeepsAnEpisodeWithinItsSeriesSurfaces(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESAPP001", Title: "App Only", Published: true, Availability: "app"})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEALL01", Status: testutil.EpisodeStatusPublished, Availability: "all"})

	ctx := context.Background()
	_, err := env.catalogClient().GetEpisodeDetail(ctx, connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
		Surface:  publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB,
	}))
	assertConnectCode(t, err, connect.CodeNotFound)

	if _, err := env.catalogClient().GetEpisodeDetail(ctx, connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
		Surface:  publirattypesv1.ClientSurface_CLIENT_SURFACE_APP,
	})); err != nil {
		t.Fatalf("GetEpisodeDetail in the app: %v", err)
	}
}

func TestDBCatalogRejectsAnUnknownSurface(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_, err := env.catalogClient().ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:  tenantContext(tenant),
		Surface: publirattypesv1.ClientSurface(99),
	}))
	assertConnectCode(t, err, connect.CodeInvalidArgument)
}
