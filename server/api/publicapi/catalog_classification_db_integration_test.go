package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The classification filters and the latest-update order exist only in SQL:
// which series a genre, a tag, a status, or a weekday keeps, and what the
// newest published episode of each series is. Canned rows answer whatever they
// are handed, so these cases run against a real PostgreSQL.

// classifiedCatalog is the catalogue every case below reads: three published
// series, two genres, two tags, and one series left out of the classification
// entirely.
type classifiedCatalog struct {
	tenant  testutil.Tenant
	fantasy testutil.Genre
	mystery testutil.Genre
	swords  testutil.Tag
	rivals  testutil.Tag
}

func seedClassifiedCatalog(t *testing.T, env *publicDBEnv) classifiedCatalog {
	t.Helper()

	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now()

	fantasy := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREFANTA01", Name: "Fantasy", DisplayOrder: 1})
	mystery := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREMYSTE01", Name: "Mystery", DisplayOrder: 2})
	swords := env.PG.SeedTag(t, tenant.ID, testutil.TagSeed{Name: "Swordplay"})
	rivals := env.PG.SeedTag(t, tenant.ID, testutil.TagSeed{Name: "Rivals"})

	// Fantasy, ongoing, Monday and Thursday, both tags.
	first := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:         "SERIESFIRST1",
		Title:            "First Series",
		Published:        true,
		PublishedAt:      now.Add(-72 * time.Hour),
		Status:           "ongoing",
		ScheduleWeekdays: []int32{1, 4},
	})
	env.PG.SeedSeriesGenre(t, tenant.ID, first.ID, fantasy.ID)
	env.PG.SeedSeriesTag(t, tenant.ID, first.ID, swords.ID)
	env.PG.SeedSeriesTag(t, tenant.ID, first.ID, rivals.ID)

	// Fantasy as well, but completed and on no weekly schedule.
	second := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESSECON1",
		Title:       "Second Series",
		Published:   true,
		PublishedAt: now.Add(-48 * time.Hour),
		Status:      "completed",
	})
	env.PG.SeedSeriesGenre(t, tenant.ID, second.ID, fantasy.ID)
	env.PG.SeedSeriesTag(t, tenant.ID, second.ID, swords.ID)

	// Mystery, on hiatus, Monday only.
	third := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:         "SERIESTHIRD1",
		Title:            "Third Series",
		Published:        true,
		PublishedAt:      now.Add(-24 * time.Hour),
		Status:           "hiatus",
		ScheduleWeekdays: []int32{1},
	})
	env.PG.SeedSeriesGenre(t, tenant.ID, third.ID, mystery.ID)

	return classifiedCatalog{tenant: tenant, fantasy: fantasy, mystery: mystery, swords: swords, rivals: rivals}
}

func listPublishedSeriesIDs(t *testing.T, env *publicDBEnv, req *publirav1.ListPublishedSeriesRequest) []string {
	t.Helper()

	resp, err := env.catalogClient().ListPublishedSeries(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}
	return seriesPublicIDs(resp.Msg.Series)
}

func assertSeriesIDs(t *testing.T, what string, got, want []string) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("%s = %v, want %v", what, got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%s = %v, want %v", what, got, want)
		}
	}
}

func TestDBListPublishedSeriesKeepsOnlyTheSeriesOfOneGenre(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)

	assertSeriesIDs(t, "fantasy series", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant:        tenantContext(catalog.tenant),
		GenrePublicId: catalog.fantasy.PublicID,
	}), []string{"SERIESSECON1", "SERIESFIRST1"})

	assertSeriesIDs(t, "mystery series", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant:        tenantContext(catalog.tenant),
		GenrePublicId: catalog.mystery.PublicID,
	}), []string{"SERIESTHIRD1"})
}

func TestDBListPublishedSeriesKeepsOnlyTheSeriesCarryingOneTag(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)

	assertSeriesIDs(t, "swordplay series", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant:  tenantContext(catalog.tenant),
		TagSlug: catalog.swords.Slug,
	}), []string{"SERIESSECON1", "SERIESFIRST1"})

	assertSeriesIDs(t, "rivals series", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant:  tenantContext(catalog.tenant),
		TagSlug: catalog.rivals.Slug,
	}), []string{"SERIESFIRST1"})
}

func TestDBListPublishedSeriesKeepsOnlyTheSeriesInOneStatus(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)

	assertSeriesIDs(t, "completed series", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(catalog.tenant),
		Status: publirattypesv1.SeriesStatus_SERIES_STATUS_COMPLETED,
	}), []string{"SERIESSECON1"})

	assertSeriesIDs(t, "series on hiatus", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(catalog.tenant),
		Status: publirattypesv1.SeriesStatus_SERIES_STATUS_HIATUS,
	}), []string{"SERIESTHIRD1"})

	// An unspecified status is the one enum zero that filters nothing, so the
	// list is the whole catalogue rather than the running series alone.
	assertSeriesIDs(t, "series with no status filter", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(catalog.tenant),
		Status: publirattypesv1.SeriesStatus_SERIES_STATUS_UNSPECIFIED,
	}), []string{"SERIESTHIRD1", "SERIESSECON1", "SERIESFIRST1"})
}

func TestDBListPublishedSeriesKeepsOnlyTheSeriesExpectedOnOneWeekday(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)

	monday := int32(1)
	assertSeriesIDs(t, "Monday series", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant:  tenantContext(catalog.tenant),
		Weekday: &monday,
	}), []string{"SERIESTHIRD1", "SERIESFIRST1"})

	thursday := int32(4)
	assertSeriesIDs(t, "Thursday series", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant:  tenantContext(catalog.tenant),
		Weekday: &thursday,
	}), []string{"SERIESFIRST1"})

	// Sunday is weekday 0, and a request that carries it is asking for Sunday
	// rather than asking for nothing.
	sunday := int32(0)
	assertSeriesIDs(t, "Sunday series", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant:  tenantContext(catalog.tenant),
		Weekday: &sunday,
	}), nil)
}

func TestDBListPublishedSeriesCombinesFilters(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)

	monday := int32(1)
	assertSeriesIDs(t, "ongoing Monday fantasy", listPublishedSeriesIDs(t, env, &publirav1.ListPublishedSeriesRequest{
		Tenant:        tenantContext(catalog.tenant),
		GenrePublicId: catalog.fantasy.PublicID,
		TagSlug:       catalog.swords.Slug,
		Status:        publirattypesv1.SeriesStatus_SERIES_STATUS_ONGOING,
		Weekday:       &monday,
	}), []string{"SERIESFIRST1"})
}

func TestDBListPublishedSeriesCarriesTheGenresAndTagsOfEachSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)

	resp, err := env.catalogClient().ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:        tenantContext(catalog.tenant),
		GenrePublicId: catalog.fantasy.PublicID,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}
	var first *publirattypesv1.Series
	for _, series := range resp.Msg.Series {
		if series.PublicId == "SERIESFIRST1" {
			first = series
		}
	}
	if first == nil {
		t.Fatalf("series = %v, want SERIESFIRST1 among them", seriesPublicIDs(resp.Msg.Series))
	}
	if len(first.Genres) != 1 || first.Genres[0].Slug != "fantasy" || first.Genres[0].PublicId != catalog.fantasy.PublicID {
		t.Fatalf("genres = %v, want the fantasy genre alone", first.Genres)
	}
	// Tags come back by name, so the same series shows the same list every time.
	if len(first.Tags) != 2 || first.Tags[0].Name != "Rivals" || first.Tags[1].Name != "Swordplay" {
		t.Fatalf("tags = %v, want Rivals then Swordplay", first.Tags)
	}

	// The detail page states the same classification the card did.
	detail, err := env.catalogClient().GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(catalog.tenant),
		PublicId: "SERIESFIRST1",
	}))
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if len(detail.Msg.Series.Genres) != 1 || detail.Msg.Series.Genres[0].Slug != "fantasy" {
		t.Fatalf("detail genres = %v, want the fantasy genre alone", detail.Msg.Series.Genres)
	}
	if len(detail.Msg.Series.Tags) != 2 {
		t.Fatalf("detail tags = %v, want both tags", detail.Msg.Series.Tags)
	}
}

func TestDBListPublishedSeriesRefusesAFilterNamingNothing(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	foreign := env.PG.SeedGenre(t, second.ID, testutil.GenreSeed{PublicID: "GENREOTHER01", Name: "Foreign"})
	env.PG.SeedTag(t, second.ID, testutil.TagSeed{Name: "Foreign"})

	client := env.catalogClient()
	// A genre of another tenant is the same answer as one that never existed.
	if _, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:        tenantContext(first),
		GenrePublicId: foreign.PublicID,
	})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another tenant's genre code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:  tenantContext(first),
		TagSlug: "foreign",
	})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another tenant's tag code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

// The filtered list pages by the same keyset as the unfiltered one, so its
// tokens have to walk it in both directions, and a token built for one filter
// set has to be refused by another.
func TestDBListPublishedSeriesPagesTheGenreFilteredListAndBindsItsToken(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)

	client := env.catalogClient()
	firstPage, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:        tenantContext(catalog.tenant),
		GenrePublicId: catalog.fantasy.PublicID,
		Limit:         1,
	}))
	if err != nil {
		t.Fatalf("genre page 1: %v", err)
	}
	if got := seriesPublicIDs(firstPage.Msg.Series); len(got) != 1 || got[0] != "SERIESSECON1" {
		t.Fatalf("genre page 1 = %v, want the newer fantasy series", got)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("genre page 1 next_token is empty, want a token for the remaining series")
	}

	secondPage, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:        tenantContext(catalog.tenant),
		GenrePublicId: catalog.fantasy.PublicID,
		Limit:         1,
		Token:         firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("genre page 2: %v", err)
	}
	if got := seriesPublicIDs(secondPage.Msg.Series); len(got) != 1 || got[0] != "SERIESFIRST1" {
		t.Fatalf("genre page 2 = %v, want the older fantasy series", got)
	}
	if secondPage.Msg.NextToken != "" {
		t.Fatalf("genre page 2 next_token = %q, want empty at the end of the list", secondPage.Msg.NextToken)
	}
	if secondPage.Msg.PreviousToken == "" {
		t.Fatal("genre page 2 previous_token is empty, want a token back to the first page")
	}

	backAgain, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:        tenantContext(catalog.tenant),
		GenrePublicId: catalog.fantasy.PublicID,
		Limit:         1,
		Token:         secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("genre page 1 revisited: %v", err)
	}
	if got := seriesPublicIDs(backAgain.Msg.Series); len(got) != 1 || got[0] != "SERIESSECON1" {
		t.Fatalf("genre page 1 revisited = %v, want the newer fantasy series again", got)
	}

	// Every one of these names a different list, so the boundary the token
	// carries sits somewhere else in each of them.
	monday := int32(1)
	for name, other := range map[string]*publirav1.ListPublishedSeriesRequest{
		"no filter": {
			Tenant: tenantContext(catalog.tenant),
			Limit:  1,
			Token:  firstPage.Msg.NextToken,
		},
		"another genre": {
			Tenant:        tenantContext(catalog.tenant),
			GenrePublicId: catalog.mystery.PublicID,
			Limit:         1,
			Token:         firstPage.Msg.NextToken,
		},
		"the same genre and a tag": {
			Tenant:        tenantContext(catalog.tenant),
			GenrePublicId: catalog.fantasy.PublicID,
			TagSlug:       catalog.swords.Slug,
			Limit:         1,
			Token:         firstPage.Msg.NextToken,
		},
		"the same genre and a status": {
			Tenant:        tenantContext(catalog.tenant),
			GenrePublicId: catalog.fantasy.PublicID,
			Status:        publirattypesv1.SeriesStatus_SERIES_STATUS_ONGOING,
			Limit:         1,
			Token:         firstPage.Msg.NextToken,
		},
		"the same genre and a weekday": {
			Tenant:        tenantContext(catalog.tenant),
			GenrePublicId: catalog.fantasy.PublicID,
			Weekday:       &monday,
			Limit:         1,
			Token:         firstPage.Msg.NextToken,
		},
	} {
		if _, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(other)); connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("genre token in %s: code = %v, want invalid_argument (err=%v)", name, connect.CodeOf(err), err)
		}
	}
}

// The latest-update order sorts on the newest published episode of each series,
// which is a value no column of series holds.
func TestDBListPublishedSeriesOrdersByTheNewestPublishedEpisode(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now()

	// Published first, but its latest episode is the newest of the three.
	seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESOLDEST", Title: "Oldest Series", Published: true, PublishedAt: now.Add(-96 * time.Hour)},
		testutil.EpisodeSeed{PublicID: "EPISODEOLD01", Title: "Old", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-90 * time.Hour)},
		testutil.EpisodeSeed{PublicID: "EPISODENEW01", Title: "New", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-time.Hour)},
	)
	seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESMIDDLE", Title: "Middle Series", Published: true, PublishedAt: now.Add(-72 * time.Hour)},
		testutil.EpisodeSeed{PublicID: "EPISODEMID01", Title: "Middle", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-24 * time.Hour)},
		// A scheduled episode is not published yet, so it cannot move the series
		// to the front before its instant arrives.
		testutil.EpisodeSeed{PublicID: "EPISODESOON1", Title: "Soon", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(24 * time.Hour)},
	)
	// No episode at all: it sorts by its own publication instant, which is the
	// last thing that happened to it.
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESEMPTY1",
		Title:       "Empty Series",
		Published:   true,
		PublishedAt: now.Add(-48 * time.Hour),
	})

	client := env.catalogClient()
	firstPage, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Order:  publirav1.SeriesOrder_SERIES_ORDER_LATEST_EPISODE_AT_DESC,
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("latest-update page 1: %v", err)
	}
	assertSeriesIDs(t, "latest-update page 1", seriesPublicIDs(firstPage.Msg.Series), []string{"SERIESOLDEST", "SERIESMIDDLE"})
	if firstPage.Msg.NextToken == "" {
		t.Fatal("latest-update page 1 next_token is empty, want a token for the remaining series")
	}

	secondPage, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Order:  publirav1.SeriesOrder_SERIES_ORDER_LATEST_EPISODE_AT_DESC,
		Limit:  2,
		Token:  firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("latest-update page 2: %v", err)
	}
	assertSeriesIDs(t, "latest-update page 2", seriesPublicIDs(secondPage.Msg.Series), []string{"SERIESEMPTY1"})
	if secondPage.Msg.PreviousToken == "" {
		t.Fatal("latest-update page 2 previous_token is empty, want a token back to the first page")
	}

	backAgain, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Order:  publirav1.SeriesOrder_SERIES_ORDER_LATEST_EPISODE_AT_DESC,
		Limit:  2,
		Token:  secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("latest-update page 1 revisited: %v", err)
	}
	assertSeriesIDs(t, "latest-update page 1 revisited", seriesPublicIDs(backAgain.Msg.Series), []string{"SERIESOLDEST", "SERIESMIDDLE"})

	// The same token in another order points at a page that order does not have.
	if _, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
		Token:  firstPage.Msg.NextToken,
	})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("latest-update token in the default order code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBListPublishedGenresCountsThePublishedSeriesOfEachGenre(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)
	// A genre nothing carries stays in the list, so the URL of its page keeps
	// working after its last series is taken down.
	env.PG.SeedGenre(t, catalog.tenant.ID, testutil.GenreSeed{PublicID: "GENREEMPTY01", Name: "Empty", DisplayOrder: 3})

	resp, err := env.catalogClient().ListPublishedGenres(context.Background(), connect.NewRequest(&publirav1.ListPublishedGenresRequest{
		Tenant: tenantContext(catalog.tenant),
	}))
	if err != nil {
		t.Fatalf("ListPublishedGenres: %v", err)
	}
	if len(resp.Msg.Genres) != 3 {
		t.Fatalf("genres = %v, want three", resp.Msg.Genres)
	}
	// The tenant's own order, not the alphabet and not the order they were
	// assigned in.
	if resp.Msg.Genres[0].Name != "Fantasy" || resp.Msg.Genres[1].Name != "Mystery" || resp.Msg.Genres[2].Name != "Empty" {
		t.Fatalf("genres = %v, want Fantasy, Mystery, Empty", resp.Msg.Genres)
	}
	if resp.Msg.Genres[0].PublishedSeriesCount != 2 {
		t.Fatalf("Fantasy published_series_count = %d, want 2", resp.Msg.Genres[0].PublishedSeriesCount)
	}
	if resp.Msg.Genres[2].PublishedSeriesCount != 0 {
		t.Fatalf("Empty published_series_count = %d, want 0", resp.Msg.Genres[2].PublishedSeriesCount)
	}
}

func TestDBListPublishedGenresPagesForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)

	client := env.catalogClient()
	firstPage, err := client.ListPublishedGenres(context.Background(), connect.NewRequest(&publirav1.ListPublishedGenresRequest{
		Tenant: tenantContext(catalog.tenant),
		Limit:  1,
	}))
	if err != nil {
		t.Fatalf("genre list page 1: %v", err)
	}
	if len(firstPage.Msg.Genres) != 1 || firstPage.Msg.Genres[0].Name != "Fantasy" {
		t.Fatalf("genre list page 1 = %v, want Fantasy alone", firstPage.Msg.Genres)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("genre list page 1 next_token is empty, want a token for the remaining genres")
	}

	secondPage, err := client.ListPublishedGenres(context.Background(), connect.NewRequest(&publirav1.ListPublishedGenresRequest{
		Tenant: tenantContext(catalog.tenant),
		Limit:  1,
		Token:  firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("genre list page 2: %v", err)
	}
	if len(secondPage.Msg.Genres) != 1 || secondPage.Msg.Genres[0].Name != "Mystery" {
		t.Fatalf("genre list page 2 = %v, want Mystery alone", secondPage.Msg.Genres)
	}
	if secondPage.Msg.PreviousToken == "" {
		t.Fatal("genre list page 2 previous_token is empty, want a token back to the first page")
	}

	backAgain, err := client.ListPublishedGenres(context.Background(), connect.NewRequest(&publirav1.ListPublishedGenresRequest{
		Tenant: tenantContext(catalog.tenant),
		Limit:  1,
		Token:  secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("genre list page 1 revisited: %v", err)
	}
	if len(backAgain.Msg.Genres) != 1 || backAgain.Msg.Genres[0].Name != "Fantasy" {
		t.Fatalf("genre list page 1 revisited = %v, want Fantasy again", backAgain.Msg.Genres)
	}
}

func TestDBListPublishedTagsRanksTheTagsByHowManySeriesCarryThem(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)
	// A tag no published series carries has no page to keep working, so it is
	// not in the list at all.
	env.PG.SeedTag(t, catalog.tenant.ID, testutil.TagSeed{Name: "Unused"})

	resp, err := env.catalogClient().ListPublishedTags(context.Background(), connect.NewRequest(&publirav1.ListPublishedTagsRequest{
		Tenant: tenantContext(catalog.tenant),
	}))
	if err != nil {
		t.Fatalf("ListPublishedTags: %v", err)
	}
	if len(resp.Msg.Tags) != 2 {
		t.Fatalf("tags = %v, want the two carried tags", resp.Msg.Tags)
	}
	if resp.Msg.Tags[0].Name != "Swordplay" || resp.Msg.Tags[0].PublishedSeriesCount != 2 {
		t.Fatalf("first tag = %v, want Swordplay on two series", resp.Msg.Tags[0])
	}
	if resp.Msg.Tags[1].Name != "Rivals" || resp.Msg.Tags[1].PublishedSeriesCount != 1 {
		t.Fatalf("second tag = %v, want Rivals on one series", resp.Msg.Tags[1])
	}
}

func TestDBListPublishedTagsPagesForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	catalog := seedClassifiedCatalog(t, env)

	client := env.catalogClient()
	firstPage, err := client.ListPublishedTags(context.Background(), connect.NewRequest(&publirav1.ListPublishedTagsRequest{
		Tenant: tenantContext(catalog.tenant),
		Limit:  1,
	}))
	if err != nil {
		t.Fatalf("tag list page 1: %v", err)
	}
	if len(firstPage.Msg.Tags) != 1 || firstPage.Msg.Tags[0].Name != "Swordplay" {
		t.Fatalf("tag list page 1 = %v, want Swordplay alone", firstPage.Msg.Tags)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("tag list page 1 next_token is empty, want a token for the remaining tags")
	}

	secondPage, err := client.ListPublishedTags(context.Background(), connect.NewRequest(&publirav1.ListPublishedTagsRequest{
		Tenant: tenantContext(catalog.tenant),
		Limit:  1,
		Token:  firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("tag list page 2: %v", err)
	}
	if len(secondPage.Msg.Tags) != 1 || secondPage.Msg.Tags[0].Name != "Rivals" {
		t.Fatalf("tag list page 2 = %v, want Rivals alone", secondPage.Msg.Tags)
	}
	if secondPage.Msg.PreviousToken == "" {
		t.Fatal("tag list page 2 previous_token is empty, want a token back to the first page")
	}

	backAgain, err := client.ListPublishedTags(context.Background(), connect.NewRequest(&publirav1.ListPublishedTagsRequest{
		Tenant: tenantContext(catalog.tenant),
		Limit:  1,
		Token:  secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("tag list page 1 revisited: %v", err)
	}
	if len(backAgain.Msg.Tags) != 1 || backAgain.Msg.Tags[0].Name != "Swordplay" {
		t.Fatalf("tag list page 1 revisited = %v, want Swordplay again", backAgain.Msg.Tags)
	}
}

func TestDBPublishedGenresAndTagsExcludeAnotherTenants(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	genre := env.PG.SeedGenre(t, second.ID, testutil.GenreSeed{PublicID: "GENREOTHER01", Name: "Foreign"})
	tag := env.PG.SeedTag(t, second.ID, testutil.TagSeed{Name: "Foreign"})
	series := env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true})
	env.PG.SeedSeriesGenre(t, second.ID, series.ID, genre.ID)
	env.PG.SeedSeriesTag(t, second.ID, series.ID, tag.ID)

	client := env.catalogClient()
	genres, err := client.ListPublishedGenres(context.Background(), connect.NewRequest(&publirav1.ListPublishedGenresRequest{
		Tenant: tenantContext(first),
	}))
	if err != nil {
		t.Fatalf("ListPublishedGenres for tenant A: %v", err)
	}
	if len(genres.Msg.Genres) != 0 {
		t.Fatalf("tenant A genres = %v, want none", genres.Msg.Genres)
	}

	tags, err := client.ListPublishedTags(context.Background(), connect.NewRequest(&publirav1.ListPublishedTagsRequest{
		Tenant: tenantContext(first),
	}))
	if err != nil {
		t.Fatalf("ListPublishedTags for tenant A: %v", err)
	}
	if len(tags.Msg.Tags) != 0 {
		t.Fatalf("tenant A tags = %v, want none", tags.Msg.Tags)
	}
}
