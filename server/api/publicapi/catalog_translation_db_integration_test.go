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
	if detail.Series.Locale != "ja" {
		t.Fatalf("series locale in en = %q, want ja, the translation it falls back to", detail.Series.Locale)
	}
	if !slices.Equal(detail.PublishedLocales, []string{"ja"}) {
		t.Fatalf("published_locales = %v, want [ja]", detail.PublishedLocales)
	}
	if len(detail.Episodes) != 1 || detail.Episodes[0].Title != "Daiichiya" || detail.Episodes[0].Locale != "ja" {
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
	if detail.Series.Locale != "en" {
		t.Fatalf("series locale in en = %q, want en", detail.Series.Locale)
	}
	if !slices.Equal(detail.PublishedLocales, []string{"en", "ja"}) {
		t.Fatalf("published_locales = %v, want [en ja]", detail.PublishedLocales)
	}
	if detail.Episodes[0].Title != "The First Night" || detail.Episodes[0].Locale != "en" {
		t.Fatalf("episode in en = (%q, %q), want The First Night in en", detail.Episodes[0].Title, detail.Episodes[0].Locale)
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
	if episodeDetail.Episode.Locale != "en" || episodeDetail.Series.Locale != "en" {
		t.Fatalf("episode locales in en = (%q, %q), want en for both", episodeDetail.Episode.Locale, episodeDetail.Series.Locale)
	}
	if !slices.Equal(episodeDetail.PublishedLocales, []string{"en", "ja"}) {
		t.Fatalf("episode published_locales = %v, want [en ja]", episodeDetail.PublishedLocales)
	}
}

// A series with no translation in the reader's locale or in the tenant's
// default answers its oldest translation, which only the locale it names says,
// since that locale may be one the tenant no longer offers and so is in no
// list of alternates. It is how a series reads after its tenant changes its
// default language.
func TestDBCatalogReadsNameTheLocaleOfTheOldestTranslation(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Hoshi no Toshokan", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Daiichiya", Status: testutil.EpisodeStatusPublished})
	env.PG.SeedSeriesTranslation(t, tenant.ID, series.ID, "ko", "Byeorui Doseogwan", "")
	env.PG.SeedEpisodeTranslation(t, tenant.ID, episode.ID, "ko", "Cheot Bam")
	for _, statement := range []string{
		`UPDATE series_translations SET created_at = created_at - interval '1 day' WHERE tenant_id = $1 AND locale = 'ko'`,
		`UPDATE episode_translations SET created_at = created_at - interval '1 day' WHERE tenant_id = $1 AND locale = 'ko'`,
		`UPDATE tenants SET default_locale = 'en', supported_locales = '{en,ja,ko,zh-Hans}' WHERE id = $1`,
	} {
		if _, err := env.PG.DB.ExecContext(context.Background(), statement, tenant.ID); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}

	client := env.catalogClient()
	detail, err := client.GetSeriesDetail(context.Background(), &publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
		Locale:   "zh-Hans",
	})
	if err != nil {
		t.Fatalf("GetSeriesDetail in zh-Hans: %v", err)
	}
	if detail.Series.Title != "Byeorui Doseogwan" || detail.Series.Locale != "ko" {
		t.Fatalf("series in zh-Hans = (%q, %q), want the older ko translation", detail.Series.Title, detail.Series.Locale)
	}
	if len(detail.Episodes) != 1 || detail.Episodes[0].Title != "Cheot Bam" || detail.Episodes[0].Locale != "ko" {
		t.Fatalf("episodes in zh-Hans = %+v, want the older ko translation", detail.Episodes)
	}

	episodeDetail, err := client.GetEpisodeDetail(context.Background(), &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
		Locale:   "zh-Hans",
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail in zh-Hans: %v", err)
	}
	if episodeDetail.Episode.Locale != "ko" || episodeDetail.Series.Locale != "ko" {
		t.Fatalf("episode locales in zh-Hans = (%q, %q), want ko for both", episodeDetail.Episode.Locale, episodeDetail.Series.Locale)
	}

	list, err := client.ListPublishedSeries(context.Background(), &publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Locale: "zh-Hans",
	})
	if err != nil {
		t.Fatalf("ListPublishedSeries in zh-Hans: %v", err)
	}
	if len(list.Series) != 1 || list.Series[0].Locale != "ko" {
		t.Fatalf("series list in zh-Hans = %+v, want the series in ko", list.Series)
	}

	// Switched off, ko is no alternate, and the locale is still named.
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE tenants SET supported_locales = '{en,zh-Hans}' WHERE id = $1`, tenant.ID); err != nil {
		t.Fatalf("narrow the offered locales: %v", err)
	}
	detail, err = client.GetSeriesDetail(context.Background(), &publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
		Locale:   "zh-Hans",
	})
	if err != nil {
		t.Fatalf("GetSeriesDetail in zh-Hans: %v", err)
	}
	if detail.Series.Locale != "ko" || len(detail.PublishedLocales) != 0 {
		t.Fatalf("series in zh-Hans = (%q, %v), want ko with no alternates", detail.Series.Locale, detail.PublishedLocales)
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
	if got := seriesPublicIDs(english.Series); !slices.Equal(got, []string{second.PublicID}) || english.Series[0].Title != "Yankee" || english.Series[0].Locale != "en" {
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
