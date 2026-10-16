package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before series
// and episodes had translations, and the one that took their titles and the
// synopsis off the catalog tables.
const (
	beforeCatalogTranslationsVersion = 20261015170720
	catalogTranslationsVersion       = 20261015232315
)

// Every series and episode stored before translations existed comes out of the
// migrations as exactly one translation in its tenant's default locale,
// carrying the title and the synopsis it had, and the way back puts them on
// the catalog rows again.
func TestCatalogTranslationMigrationKeepsExistingTitles(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Behind the migrations under test, so the rows seeded below are rows they
	// find rather than rows written through them.
	pg.MigrateTo(t, beforeCatalogTranslationsVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := pg.DB

	japanese := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	english := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	mustExec(t, ctx, db, `UPDATE tenants SET default_locale = 'en' WHERE id = $1`, english.ID)

	described := pg.SeedSeries(t, japanese.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Starlit Library", Synopsis: "A library that opens at night.", Published: true})
	undescribed := pg.SeedSeries(t, english.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Harbor Lights"})
	first := pg.SeedEpisode(t, japanese.ID, described.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "The First Night"})
	second := pg.SeedEpisode(t, english.ID, undescribed.ID, testutil.EpisodeSeed{PublicID: "EPISODEB0001", Title: "Low Tide"})

	pg.MigrateTo(t, catalogTranslationsVersion)

	for _, tc := range []struct {
		name          string
		seriesID      any
		locale, title string
		synopsis      string
		episodeID     any
		episodeTitle  string
		episodeLocale string
	}{
		{name: "described", seriesID: described.ID, locale: "ja", title: "Starlit Library", synopsis: "A library that opens at night.", episodeID: first.ID, episodeTitle: "The First Night", episodeLocale: "ja"},
		{name: "undescribed", seriesID: undescribed.ID, locale: "en", title: "Harbor Lights", synopsis: "", episodeID: second.ID, episodeTitle: "Low Tide", episodeLocale: "en"},
	} {
		var count int
		mustQueryRow(t, ctx, db, `SELECT count(*) FROM series_translations WHERE series_id = $1`, &count, tc.seriesID)
		if count != 1 {
			t.Fatalf("%s: series translations = %d, want 1", tc.name, count)
		}
		var locale, title, synopsis string
		if err := db.QueryRowContext(ctx, `
			SELECT locale, title, synopsis FROM series_translations WHERE series_id = $1
		`, tc.seriesID).Scan(&locale, &title, &synopsis); err != nil {
			t.Fatalf("%s: read series translation: %v", tc.name, err)
		}
		if locale != tc.locale || title != tc.title || synopsis != tc.synopsis {
			t.Fatalf("%s: series translation = (%q, %q, %q), want (%q, %q, %q)", tc.name, locale, title, synopsis, tc.locale, tc.title, tc.synopsis)
		}

		mustQueryRow(t, ctx, db, `SELECT count(*) FROM episode_translations WHERE episode_id = $1`, &count, tc.episodeID)
		if count != 1 {
			t.Fatalf("%s: episode translations = %d, want 1", tc.name, count)
		}
		if err := db.QueryRowContext(ctx, `
			SELECT locale, title FROM episode_translations WHERE episode_id = $1
		`, tc.episodeID).Scan(&locale, &title); err != nil {
			t.Fatalf("%s: read episode translation: %v", tc.name, err)
		}
		if locale != tc.episodeLocale || title != tc.episodeTitle {
			t.Fatalf("%s: episode translation = (%q, %q), want (%q, %q)", tc.name, locale, title, tc.episodeLocale, tc.episodeTitle)
		}
	}

	var leftover int
	mustQueryRow(t, ctx, db, `
		SELECT count(*)
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND (table_name, column_name) IN (('series', 'title'), ('series_listings', 'synopsis'), ('episodes', 'title'))
	`, &leftover)
	if leftover != 0 {
		t.Fatalf("the catalog still carries %d of series.title, series_listings.synopsis, and episodes.title", leftover)
	}

	// The way back puts the default locale's title and synopsis on the series
	// and the episode again, and leaves an empty synopsis empty.
	pg.MigrateTo(t, beforeCatalogTranslationsVersion)

	var title string
	var synopsis *string
	if err := db.QueryRowContext(ctx, `
		SELECT s.title, sl.synopsis FROM series s JOIN series_listings sl ON sl.series_id = s.id WHERE s.id = $1
	`, described.ID).Scan(&title, &synopsis); err != nil {
		t.Fatalf("read reverted series: %v", err)
	}
	if title != "Starlit Library" || synopsis == nil || *synopsis != "A library that opens at night." {
		t.Fatalf("reverted series = (%q, %v), want the title and synopsis it had", title, synopsis)
	}
	if err := db.QueryRowContext(ctx, `
		SELECT s.title, sl.synopsis FROM series s JOIN series_listings sl ON sl.series_id = s.id WHERE s.id = $1
	`, undescribed.ID).Scan(&title, &synopsis); err != nil {
		t.Fatalf("read reverted series: %v", err)
	}
	if title != "Harbor Lights" || synopsis != nil {
		t.Fatalf("reverted series = (%q, %v), want its title and no synopsis", title, synopsis)
	}
	mustQueryRow(t, ctx, db, `SELECT title FROM episodes WHERE id = $1`, &title, second.ID)
	if title != "Low Tide" {
		t.Fatalf("reverted episode title = %q, want Low Tide", title)
	}
}
