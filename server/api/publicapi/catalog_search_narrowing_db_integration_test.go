package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A series search narrows and sorts through the same scans as the catalogue
// list, with the keyword as one more condition, so these cases run the filters
// and the orders against a real PostgreSQL and check that the keyword still
// applies beside them.

// seedSearchableCatalog adds to the classified catalogue one series the
// keyword finds but no filter keeps, and one series every fantasy filter keeps
// but the keyword does not find. "Another Series" is the newest and sorts
// first by title, which is what keeps the title and the publication orders
// apart.
func seedSearchableCatalog(t *testing.T, env *publicDBEnv) classifiedCatalog {
	t.Helper()

	catalog := seedClassifiedCatalog(t, env)
	now := time.Now()

	env.PG.SeedSeries(t, catalog.tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESANOTH1",
		Title:       "Another Series",
		Published:   true,
		PublishedAt: now.Add(-time.Hour),
		Status:      "completed",
	})
	unrelated := env.PG.SeedSeries(t, catalog.tenant.ID, testutil.SeriesSeed{
		PublicID:         "SERIESTALE01",
		Title:            "Unrelated Tale",
		Published:        true,
		PublishedAt:      now.Add(-96 * time.Hour),
		Status:           "ongoing",
		ScheduleWeekdays: []int32{1, 4},
	})
	env.PG.SeedSeriesGenre(t, catalog.tenant.ID, unrelated.ID, catalog.fantasy.ID)
	env.PG.SeedSeriesTag(t, catalog.tenant.ID, unrelated.ID, catalog.swords.ID)

	return catalog
}

func searchPublishedSeriesIDs(t *testing.T, env *publicDBEnv, req *publirav1.SearchPublishedSeriesRequest) []string {
	t.Helper()

	resp, err := env.catalogClient().SearchPublishedSeries(context.Background(), req)
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	return seriesPublicIDs(resp.Series)
}

func TestDBSearchPublishedSeriesKeepsOnlyTheHitsEveryFilterKeeps(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedSearchableCatalog(t, env)
	monday := int32(1)

	for _, test := range []struct {
		name string
		req  *publirav1.SearchPublishedSeriesRequest
		want []string
	}{
		{
			name: "no filter",
			req:  &publirav1.SearchPublishedSeriesRequest{},
			want: []string{"SERIESANOTH1", "SERIESFIRST1", "SERIESSECON1", "SERIESTHIRD1"},
		},
		{
			name: "genre",
			req:  &publirav1.SearchPublishedSeriesRequest{GenrePublicId: catalog.fantasy.PublicID},
			want: []string{"SERIESFIRST1", "SERIESSECON1"},
		},
		{
			name: "tag",
			req:  &publirav1.SearchPublishedSeriesRequest{TagSlug: catalog.rivals.Slug},
			want: []string{"SERIESFIRST1"},
		},
		{
			name: "status",
			req:  &publirav1.SearchPublishedSeriesRequest{Status: publirattypesv1.SeriesStatus_SERIES_STATUS_COMPLETED},
			want: []string{"SERIESANOTH1", "SERIESSECON1"},
		},
		{
			name: "weekday",
			req:  &publirav1.SearchPublishedSeriesRequest{Weekday: &monday},
			want: []string{"SERIESFIRST1", "SERIESTHIRD1"},
		},
		{
			name: "every filter at once",
			req: &publirav1.SearchPublishedSeriesRequest{
				GenrePublicId: catalog.fantasy.PublicID,
				TagSlug:       catalog.swords.Slug,
				Status:        publirattypesv1.SeriesStatus_SERIES_STATUS_ONGOING,
				Weekday:       &monday,
			},
			want: []string{"SERIESFIRST1"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.req.Tenant = tenantContext(catalog.tenant)
			test.req.Query = "series"
			assertSeriesIDs(t, test.name, searchPublishedSeriesIDs(t, env, test.req), test.want)
		})
	}
}

func TestDBSearchPublishedSeriesKeepsOnlyTheHitsWithAFreeEpisode(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now()

	seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESFREE01", Title: "Free Story", Published: true, PublishedAt: now.Add(-72 * time.Hour)},
		testutil.EpisodeSeed{PublicID: "EPISODEFREE1", Title: "Free", Status: testutil.EpisodeStatusPublished},
	)
	_, windowed := seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESWIND01", Title: "Windowed Story", Published: true, PublishedAt: now.Add(-48 * time.Hour)},
		testutil.EpisodeSeed{PublicID: "EPISODEWIND1", Title: "Priced", Status: testutil.EpisodeStatusPublished, Price: 400},
	)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, windowed[0].ID, now.Add(-time.Hour), now.Add(time.Hour))
	seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESPAID01", Title: "Paid Story", Published: true, PublishedAt: now.Add(-24 * time.Hour)},
		testutil.EpisodeSeed{PublicID: "EPISODEPAID1", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500},
	)
	// Free to start, but the keyword does not find it.
	seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESFREE02", Title: "Free Tale", Published: true, PublishedAt: now.Add(-12 * time.Hour)},
		testutil.EpisodeSeed{PublicID: "EPISODEFREE2", Title: "Free", Status: testutil.EpisodeStatusPublished},
	)

	assertSeriesIDs(t, "story hits", searchPublishedSeriesIDs(t, env, &publirav1.SearchPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Query:  "story",
	}), []string{"SERIESFREE01", "SERIESPAID01", "SERIESWIND01"})
	assertSeriesIDs(t, "story hits free to start", searchPublishedSeriesIDs(t, env, &publirav1.SearchPublishedSeriesRequest{
		Tenant:          tenantContext(tenant),
		Query:           "story",
		HasFreeEpisodes: true,
	}), []string{"SERIESFREE01", "SERIESWIND01"})
}

func TestDBSearchPublishedSeriesSortsByTheRequestedOrder(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedSearchableCatalog(t, env)
	// Second Series gets the newest episode, which moves it to the front of
	// the latest-update order and nowhere else.
	var secondID uuid.UUID
	if err := env.PG.DB.QueryRowContext(context.Background(),
		"SELECT id FROM series WHERE public_id = $1", "SERIESSECON1",
	).Scan(&secondID); err != nil {
		t.Fatalf("read the id of SERIESSECON1: %v", err)
	}
	env.PG.SeedEpisode(t, catalog.tenant.ID, secondID, testutil.EpisodeSeed{
		PublicID:    "EPISODENEW01",
		Title:       "New",
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(-time.Minute),
	})

	for _, test := range []struct {
		name  string
		order publirav1.SeriesOrder
		want  []string
	}{
		{
			// The search's own order on the SQL backend, which is what every
			// search answered before it could be sorted.
			name:  "unspecified",
			order: publirav1.SeriesOrder_SERIES_ORDER_UNSPECIFIED,
			want:  []string{"SERIESANOTH1", "SERIESFIRST1", "SERIESSECON1", "SERIESTHIRD1"},
		},
		{
			name:  "newest published first",
			order: publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_DESC,
			want:  []string{"SERIESANOTH1", "SERIESTHIRD1", "SERIESSECON1", "SERIESFIRST1"},
		},
		{
			name:  "oldest published first",
			order: publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_ASC,
			want:  []string{"SERIESFIRST1", "SERIESSECON1", "SERIESTHIRD1", "SERIESANOTH1"},
		},
		{
			name:  "title ascending",
			order: publirav1.SeriesOrder_SERIES_ORDER_TITLE_ASC,
			want:  []string{"SERIESANOTH1", "SERIESFIRST1", "SERIESSECON1", "SERIESTHIRD1"},
		},
		{
			name:  "title descending",
			order: publirav1.SeriesOrder_SERIES_ORDER_TITLE_DESC,
			want:  []string{"SERIESTHIRD1", "SERIESSECON1", "SERIESFIRST1", "SERIESANOTH1"},
		},
		{
			name:  "newest episode first",
			order: publirav1.SeriesOrder_SERIES_ORDER_LATEST_EPISODE_AT_DESC,
			want:  []string{"SERIESSECON1", "SERIESANOTH1", "SERIESTHIRD1", "SERIESFIRST1"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			assertSeriesIDs(t, test.name, searchPublishedSeriesIDs(t, env, &publirav1.SearchPublishedSeriesRequest{
				Tenant: tenantContext(catalog.tenant),
				Query:  "series",
				Order:  test.order,
			}), test.want)
		})
	}
}

func TestDBSearchPublishedSeriesPagesTheNarrowedHitsAndBindsItsToken(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedSearchableCatalog(t, env)

	client := env.catalogClient()
	narrowed := func(token string) *publirav1.SearchPublishedSeriesRequest {
		return &publirav1.SearchPublishedSeriesRequest{
			Tenant:        tenantContext(catalog.tenant),
			Query:         "series",
			GenrePublicId: catalog.fantasy.PublicID,
			Order:         publirav1.SeriesOrder_SERIES_ORDER_PUBLISHED_AT_DESC,
			Limit:         1,
			Token:         token,
		}
	}

	firstPage, err := client.SearchPublishedSeries(context.Background(), narrowed(""))
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	assertSeriesIDs(t, "page 1", seriesPublicIDs(firstPage.Series), []string{"SERIESSECON1"})
	if firstPage.NextToken == "" {
		t.Fatal("page 1 next_token is empty, want a token for the remaining hit")
	}

	secondPage, err := client.SearchPublishedSeries(context.Background(), narrowed(firstPage.NextToken))
	if err != nil {
		t.Fatalf("page 2: %v", err)
	}
	assertSeriesIDs(t, "page 2", seriesPublicIDs(secondPage.Series), []string{"SERIESFIRST1"})
	if secondPage.NextToken != "" {
		t.Fatalf("page 2 next_token = %q, want empty at the end of the hits", secondPage.NextToken)
	}

	backAgain, err := client.SearchPublishedSeries(context.Background(), narrowed(secondPage.PreviousToken))
	if err != nil {
		t.Fatalf("page 1 revisited: %v", err)
	}
	assertSeriesIDs(t, "page 1 revisited", seriesPublicIDs(backAgain.Series), []string{"SERIESSECON1"})

	// Every one of these names a different list of hits, so the boundary the
	// token carries sits somewhere else in each of them.
	monday := int32(1)
	for name, change := range map[string]func(*publirav1.SearchPublishedSeriesRequest){
		"no filter":     func(req *publirav1.SearchPublishedSeriesRequest) { req.GenrePublicId = "" },
		"another genre": func(req *publirav1.SearchPublishedSeriesRequest) { req.GenrePublicId = catalog.mystery.PublicID },
		"another order": func(req *publirav1.SearchPublishedSeriesRequest) {
			req.Order = publirav1.SeriesOrder_SERIES_ORDER_TITLE_ASC
		},
		"the search's own order": func(req *publirav1.SearchPublishedSeriesRequest) {
			req.Order = publirav1.SeriesOrder_SERIES_ORDER_UNSPECIFIED
		},
		"a free filter on top": func(req *publirav1.SearchPublishedSeriesRequest) { req.HasFreeEpisodes = true },
		"a tag on top":         func(req *publirav1.SearchPublishedSeriesRequest) { req.TagSlug = catalog.swords.Slug },
		"a status on top": func(req *publirav1.SearchPublishedSeriesRequest) {
			req.Status = publirattypesv1.SeriesStatus_SERIES_STATUS_ONGOING
		},
		"a weekday on top": func(req *publirav1.SearchPublishedSeriesRequest) { req.Weekday = &monday },
	} {
		req := narrowed(firstPage.NextToken)
		change(req)
		_, err := client.SearchPublishedSeries(context.Background(), req)
		if connect.CodeOf(err) != connect.CodeInvalidArgument || err.Error() != "invalid_argument: token was issued for another order or filter" {
			t.Fatalf("token with %s: error = %v, want the order-or-filter mismatch", name, err)
		}
	}

	// A token is still bound to its query first.
	req := narrowed(firstPage.NextToken)
	req.Query = "story"
	if _, err := client.SearchPublishedSeries(context.Background(), req); err == nil || err.Error() != "invalid_argument: token was issued for another query" {
		t.Fatalf("token with another query: error = %v, want the query mismatch", err)
	}
}

func TestDBSearchPublishedSeriesRefusesAFilterNamingNothing(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedSearchableCatalog(t, env)
	other := env.seedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	foreign := env.PG.SeedGenre(t, other.ID, testutil.GenreSeed{PublicID: "GENREFOREIG1", Name: "Foreign", DisplayOrder: 1})
	foreignTag := env.PG.SeedTag(t, other.ID, testutil.TagSeed{Name: "Elsewhere"})
	tooLate := int32(7)

	for _, test := range []struct {
		name string
		req  *publirav1.SearchPublishedSeriesRequest
		want connect.Code
	}{
		{name: "missing genre", req: &publirav1.SearchPublishedSeriesRequest{GenrePublicId: "GENREMISSING"}, want: connect.CodeNotFound},
		// Another tenant's genre answers exactly as one that was never there.
		{name: "another tenant's genre", req: &publirav1.SearchPublishedSeriesRequest{GenrePublicId: foreign.PublicID}, want: connect.CodeNotFound},
		{name: "another tenant's tag", req: &publirav1.SearchPublishedSeriesRequest{TagSlug: foreignTag.Slug}, want: connect.CodeNotFound},
		{name: "weekday past Saturday", req: &publirav1.SearchPublishedSeriesRequest{Weekday: &tooLate}, want: connect.CodeInvalidArgument},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.req.Tenant = tenantContext(catalog.tenant)
			test.req.Query = "series"
			_, err := env.catalogClient().SearchPublishedSeries(context.Background(), test.req)
			if connect.CodeOf(err) != test.want {
				t.Fatalf("code = %v, want %v (err=%v)", connect.CodeOf(err), test.want, err)
			}
		})
	}
}
