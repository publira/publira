package adminapi

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func seriesTranslationLocales(translations []*publiraadminv1.SeriesTranslation) []string {
	locales := make([]string, 0, len(translations))
	for _, translation := range translations {
		locales = append(locales, translation.Locale)
	}
	return locales
}

func episodeTranslationLocales(translations []*publiraadminv1.EpisodeTranslation) []string {
	locales := make([]string, 0, len(translations))
	for _, translation := range translations {
		locales = append(locales, translation.Locale)
	}
	return locales
}

// A save that names a locale writes that locale's title and synopsis, and
// leaves the series' other translations, and the title the console lists it
// by, as they were.
func TestDBUpdateSeriesWritesTheTranslationItNames(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	created, err := client.CreateSeries(ctx, &publiraadminv1.CreateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		Title:    "Hoshi no Toshokan",
		Synopsis: "Yoru ni hiraku toshokan.",
	})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if got := seriesTranslationLocales(created.Translations); len(got) != 1 || got[0] != "ja" {
		t.Fatalf("translations after create = %v, want [ja]", got)
	}

	updated, err := client.UpdateSeries(ctx, &publiraadminv1.UpdateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: created.Series.Id,
		Locale:   "en",
		Title:    "Starlit Library",
		Synopsis: new("A library that opens at night."),
	})
	if err != nil {
		t.Fatalf("UpdateSeries in en: %v", err)
	}
	if updated.Series.Title != "Hoshi no Toshokan" || updated.Series.Synopsis != "Yoru ni hiraku toshokan." {
		t.Fatalf("series after the en save = (%q, %q), want the ja translation the console lists it by", updated.Series.Title, updated.Series.Synopsis)
	}
	if got := seriesTranslationLocales(updated.Translations); len(got) != 2 || got[0] != "ja" || got[1] != "en" {
		t.Fatalf("translations after the en save = %v, want [ja en], oldest first", got)
	}
	if en := updated.Translations[1]; en.Title != "Starlit Library" || en.Synopsis != "A library that opens at night." {
		t.Fatalf("en translation = (%q, %q), want what the save wrote", en.Title, en.Synopsis)
	}

	// A save that leaves the synopsis unset keeps the one stored.
	updated, err = client.UpdateSeries(ctx, &publiraadminv1.UpdateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: created.Series.Id,
		Locale:   "en",
		Title:    "The Starlit Library",
	})
	if err != nil {
		t.Fatalf("UpdateSeries in en without a synopsis: %v", err)
	}
	if en := updated.Translations[1]; en.Title != "The Starlit Library" || en.Synopsis != "A library that opens at night." {
		t.Fatalf("en translation = (%q, %q), want the new title and the kept synopsis", en.Title, en.Synopsis)
	}

	got, err := client.GetSeries(ctx, &publiraadminv1.GetSeriesRequest{Tenant: tenant.tenantContext(), PublicId: created.Series.PublicId})
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if locales := seriesTranslationLocales(got.Translations); len(locales) != 2 {
		t.Fatalf("GetSeries translations = %v, want both", locales)
	}
}

// A title is written only in a language the site offers: one switched off, or
// one the registry does not know, is refused rather than stored out of sight.
func TestDBSeriesTitleIsRefusedInALocaleTheTenantDoesNotOffer(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	if _, err := env.PG.DB.ExecContext(context.Background(), `UPDATE tenants SET supported_locales = '{ja,en}' WHERE id = $1`, tenant.Tenant.ID); err != nil {
		t.Fatalf("narrow the offered locales: %v", err)
	}
	client := env.seriesClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	for _, locale := range []string{"ko", "fr"} {
		_, err := client.CreateSeries(ctx, &publiraadminv1.CreateSeriesRequest{
			Tenant: tenant.tenantContext(),
			Locale: locale,
			Title:  "Byeorui Doseogwan",
		})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("CreateSeries in %s: code = %v, want invalid_argument (err=%v)", locale, connect.CodeOf(err), err)
		}
	}
	if count := env.countRows(t, "SELECT count(*) FROM series WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("series stored = %d, want none", count)
	}
}

// The last translation of a series or an episode cannot be deleted, since a
// work with no title in any language would vanish from every list.
func TestDBDeleteCatalogTranslationKeepsTheLastOne(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())

	created, err := client.CreateSeries(ctx, &publiraadminv1.CreateSeriesRequest{Tenant: tenant.tenantContext(), Title: "Hoshi no Toshokan"})
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if _, err := client.UpdateSeries(ctx, &publiraadminv1.UpdateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: created.Series.Id,
		Locale:   "en",
		Title:    "Starlit Library",
	}); err != nil {
		t.Fatalf("UpdateSeries in en: %v", err)
	}
	episode, err := client.CreateEpisode(ctx, &publiraadminv1.CreateEpisodeRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: created.Series.Id,
		Title:    "Daiichiya",
	})
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	renamed, err := client.UpdateEpisodeTitle(ctx, &publiraadminv1.UpdateEpisodeTitleRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: episode.Episode.Id,
		Locale:    "en",
		Title:     "The First Night",
	})
	if err != nil {
		t.Fatalf("UpdateEpisodeTitle in en: %v", err)
	}
	if got := episodeTranslationLocales(renamed.Translations); len(got) != 2 || got[0] != "ja" || got[1] != "en" {
		t.Fatalf("episode translations = %v, want [ja en]", got)
	}
	if renamed.Episode.Title != "Daiichiya" {
		t.Fatalf("episode title = %q, want the ja one the console lists it by", renamed.Episode.Title)
	}

	// The default locale's translation may go: the work falls back to the
	// oldest remaining one.
	left, err := client.DeleteSeriesTranslation(ctx, &publiraadminv1.DeleteSeriesTranslationRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: created.Series.Id,
		Locale:   "ja",
	})
	if err != nil {
		t.Fatalf("DeleteSeriesTranslation ja: %v", err)
	}
	if got := seriesTranslationLocales(left.Translations); len(got) != 1 || got[0] != "en" {
		t.Fatalf("series translations left = %v, want [en]", got)
	}
	_, err = client.DeleteSeriesTranslation(ctx, &publiraadminv1.DeleteSeriesTranslationRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: created.Series.Id,
		Locale:   "en",
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeleteSeriesTranslation of the last one: code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.DeleteSeriesTranslation(ctx, &publiraadminv1.DeleteSeriesTranslationRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: created.Series.Id,
		Locale:   "ko",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteSeriesTranslation of a missing locale: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	episodeLeft, err := client.DeleteEpisodeTranslation(ctx, &publiraadminv1.DeleteEpisodeTranslationRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: episode.Episode.Id,
		Locale:    "ja",
	})
	if err != nil {
		t.Fatalf("DeleteEpisodeTranslation ja: %v", err)
	}
	if got := episodeTranslationLocales(episodeLeft.Translations); len(got) != 1 || got[0] != "en" {
		t.Fatalf("episode translations left = %v, want [en]", got)
	}
	_, err = client.DeleteEpisodeTranslation(ctx, &publiraadminv1.DeleteEpisodeTranslationRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: episode.Episode.Id,
		Locale:    "en",
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeleteEpisodeTranslation of the last one: code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
}

// Another tenant's series and episodes are not found, whichever translation
// a request names.
func TestDBCatalogTranslationsOfAnotherTenantAreNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	theirs, err := client.CreateSeries(testutil.WithBearer(context.Background(), second.token()), &publiraadminv1.CreateSeriesRequest{
		Tenant: second.tenantContext(),
		Title:  "Theirs",
	})
	if err != nil {
		t.Fatalf("CreateSeries for tenant B: %v", err)
	}
	_, err = client.DeleteSeriesTranslation(testutil.WithBearer(context.Background(), first.token()), &publiraadminv1.DeleteSeriesTranslationRequest{
		Tenant:   first.tenantContext(),
		SeriesId: theirs.Series.Id,
		Locale:   "ja",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteSeriesTranslation across tenants: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series_translations WHERE title = $1", "Theirs"); count != 1 {
		t.Fatalf("tenant B's translation rows = %d, want 1", count)
	}
}
