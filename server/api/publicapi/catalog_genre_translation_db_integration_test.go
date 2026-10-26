package publicapi

import (
	"context"
	"testing"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A genre read in a locale it has no name in answers the name in the tenant's
// default locale, and names that locale, wherever a genre is read: the genre
// list, the series list, and a series' own page. The slug a URL is built from
// is the same in every locale.
func TestDBGenreNamesFallBackToTheDefaultLocale(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Hoshi no Toshokan", Published: true})
	genre := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREA000001", Name: "Kaiki"})
	env.PG.SeedSeriesGenre(t, tenant.ID, series.ID, genre.ID)

	client := env.catalogClient()
	type read struct{ name, locale, slug string }
	readAll := func(locale string) []read {
		t.Helper()
		listed, err := client.ListPublishedGenres(context.Background(), &publirav1.ListPublishedGenresRequest{
			Tenant: tenantContext(tenant),
			Locale: locale,
		})
		if err != nil {
			t.Fatalf("ListPublishedGenres in %q: %v", locale, err)
		}
		if len(listed.Genres) != 1 {
			t.Fatalf("ListPublishedGenres in %q = %v, want the one genre", locale, listed.Genres)
		}
		seriesList, err := client.ListPublishedSeries(context.Background(), &publirav1.ListPublishedSeriesRequest{
			Tenant: tenantContext(tenant),
			Locale: locale,
		})
		if err != nil {
			t.Fatalf("ListPublishedSeries in %q: %v", locale, err)
		}
		if len(seriesList.Series) != 1 || len(seriesList.Series[0].Genres) != 1 {
			t.Fatalf("ListPublishedSeries in %q = %v, want the one series with its genre", locale, seriesList.Series)
		}
		detail, err := client.GetSeriesDetail(context.Background(), &publirav1.GetSeriesDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: series.PublicID,
			Locale:   locale,
		})
		if err != nil {
			t.Fatalf("GetSeriesDetail in %q: %v", locale, err)
		}
		if len(detail.Series.Genres) != 1 {
			t.Fatalf("GetSeriesDetail in %q genres = %v, want the one genre", locale, detail.Series.Genres)
		}
		listedGenre := listed.Genres[0]
		listedSeriesGenre := seriesList.Series[0].Genres[0]
		detailGenre := detail.Series.Genres[0]
		return []read{
			{listedGenre.Name, listedGenre.Locale, listedGenre.Slug},
			{listedSeriesGenre.Name, listedSeriesGenre.Locale, listedSeriesGenre.Slug},
			{detailGenre.Name, detailGenre.Locale, detailGenre.Slug},
		}
	}
	expect := func(locale string, want read) {
		t.Helper()
		for i, got := range readAll(locale) {
			if got != want {
				t.Fatalf("genre read %d in %q = %+v, want %+v", i, locale, got, want)
			}
		}
	}

	expect("en", read{name: "Kaiki", locale: "ja", slug: "kaiki"})

	env.PG.SeedGenreTranslation(t, tenant.ID, genre.ID, "en", "Horror")
	expect("en", read{name: "Horror", locale: "en", slug: "kaiki"})
	expect("ko", read{name: "Kaiki", locale: "ja", slug: "kaiki"})
	// No locale is the tenant's default.
	expect("", read{name: "Kaiki", locale: "ja", slug: "kaiki"})
}
