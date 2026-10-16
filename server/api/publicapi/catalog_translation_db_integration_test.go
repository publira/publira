package publicapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// A series read in a locale it has no translation in answers the one in the
// tenant's default locale, and says which locales it does have, so a reader
// sees a title rather than nothing and a page can name its alternates.
func TestDBGetSeriesDetailFallsBackToTheDefaultLocale(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Hoshi no Toshokan", Synopsis: "Yoru ni hiraku toshokan.", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Daiichiya", Status: testutil.EpisodeStatusPublished})

	client := env.catalogClient()
	detail, err := client.GetSeriesDetail(context.Background(), &publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
		Locale:   "en",
	})
	if err != nil {
		t.Fatalf("GetSeriesDetail in en: %v", err)
	}
	if detail.Series.Title != "Hoshi no Toshokan" || detail.Series.Synopsis != "Yoru ni hiraku toshokan." {
		t.Fatalf("series in en = (%q, %q), want the ja translation it falls back to", detail.Series.Title, detail.Series.Synopsis)
	}
	if !slices.Equal(detail.PublishedLocales, []string{"ja"}) {
		t.Fatalf("published_locales = %v, want [ja]", detail.PublishedLocales)
	}
	if len(detail.Episodes) != 1 || detail.Episodes[0].Title != "Daiichiya" {
		t.Fatalf("episodes in en = %+v, want the ja title", detail.Episodes)
	}

	env.PG.SeedSeriesTranslation(t, tenant.ID, series.ID, "en", "Starlit Library", "A library that opens at night.")
	env.PG.SeedEpisodeTranslation(t, tenant.ID, episode.ID, "en", "The First Night")

	detail, err = client.GetSeriesDetail(context.Background(), &publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
		Locale:   "en",
	})
	if err != nil {
		t.Fatalf("GetSeriesDetail in en: %v", err)
	}
	if detail.Series.Title != "Starlit Library" || detail.Series.Synopsis != "A library that opens at night." {
		t.Fatalf("series in en = (%q, %q), want the en translation", detail.Series.Title, detail.Series.Synopsis)
	}
	if !slices.Equal(detail.PublishedLocales, []string{"en", "ja"}) {
		t.Fatalf("published_locales = %v, want [en ja]", detail.PublishedLocales)
	}
	if detail.Episodes[0].Title != "The First Night" {
		t.Fatalf("episode in en = %q, want The First Night", detail.Episodes[0].Title)
	}

	// No locale is the tenant's default.
	detail, err = client.GetSeriesDetail(context.Background(), &publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
	})
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if detail.Series.Title != "Hoshi no Toshokan" {
		t.Fatalf("series with no locale = %q, want the ja translation", detail.Series.Title)
	}

	episodeDetail, err := client.GetEpisodeDetail(context.Background(), &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
		Locale:   "en",
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail in en: %v", err)
	}
	if episodeDetail.Episode.Title != "The First Night" || episodeDetail.Series.Title != "Starlit Library" {
		t.Fatalf("episode in en = (%q, %q), want the en translations", episodeDetail.Episode.Title, episodeDetail.Series.Title)
	}
	if !slices.Equal(episodeDetail.PublishedLocales, []string{"en", "ja"}) {
		t.Fatalf("episode published_locales = %v, want [en ja]", episodeDetail.PublishedLocales)
	}
}

// A locale the tenant has switched off is not one of a series' alternates,
// though the translation in it is kept.
func TestDBGetSeriesDetailNamesOnlyTheOfferedLocales(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Hoshi no Toshokan", Published: true})
	env.PG.SeedSeriesTranslation(t, tenant.ID, series.ID, "ko", "Byeorui Doseogwan", "")
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE tenants SET supported_locales = '{ja,en}' WHERE id = $1`, tenant.ID); err != nil {
		t.Fatalf("narrow the offered locales: %v", err)
	}

	detail, err := env.catalogClient().GetSeriesDetail(context.Background(), &publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
	})
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if !slices.Equal(detail.PublishedLocales, []string{"ja"}) {
		t.Fatalf("published_locales = %v, want [ja] with ko switched off", detail.PublishedLocales)
	}
}

// The title orders sort by the titles of the reader's locale, so the same two
// series come in another order in another locale, and a token of one locale's
// list does not page through another's.
func TestDBListPublishedSeriesSortsTitlesInTheReadersLocale(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	first := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Alpha", Published: true})
	second := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00002", Title: "Beta", Published: true})
	env.PG.SeedSeriesTranslation(t, tenant.ID, first.ID, "en", "Zulu", "")
	env.PG.SeedSeriesTranslation(t, tenant.ID, second.ID, "en", "Yankee", "")

	client := env.catalogClient()
	list := func(locale, token string) (*publirav1.ListPublishedSeriesResponse, error) {
		return client.ListPublishedSeries(context.Background(), &publirav1.ListPublishedSeriesRequest{
			Tenant: tenantContext(tenant),
			Order:  publirav1.SeriesOrder_SERIES_ORDER_TITLE_ASC,
			Locale: locale,
			Limit:  1,
			Token:  token,
		})
	}

	japanese, err := list("ja", "")
	if err != nil {
		t.Fatalf("ListPublishedSeries in ja: %v", err)
	}
	if got := seriesPublicIDs(japanese.Series); !slices.Equal(got, []string{first.PublicID}) || japanese.Series[0].Title != "Alpha" {
		t.Fatalf("first ja page = %v, want Alpha first", got)
	}
	english, err := list("en", "")
	if err != nil {
		t.Fatalf("ListPublishedSeries in en: %v", err)
	}
	if got := seriesPublicIDs(english.Series); !slices.Equal(got, []string{second.PublicID}) || english.Series[0].Title != "Yankee" {
		t.Fatalf("first en page = %v, want Yankee first", got)
	}

	if _, err := list("en", japanese.NextToken); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ja token read in en: code = %v, want invalid_argument", connect.CodeOf(err))
	}
	next, err := list("en", english.NextToken)
	if err != nil {
		t.Fatalf("second en page: %v", err)
	}
	if got := seriesPublicIDs(next.Series); !slices.Equal(got, []string{first.PublicID}) {
		t.Fatalf("second en page = %v, want Zulu", got)
	}
}
