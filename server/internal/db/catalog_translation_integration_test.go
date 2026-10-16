package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// series_translation_for and episode_translation_for pick the asked locale's
// translation, then the tenant default locale's, then the oldest, as
// page_translation_for does, so a work keeps a title after its tenant moves to
// a default locale none of its translations is in.
func TestCatalogTranslationForFallsBackToTheDefaultThenTheOldest(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	// Seeded in the tenant's default locale, ja, and translated into en after.
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Hoshi no Toshokan", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEA0001", Title: "Daiichiya"})
	pg.SeedSeriesTranslation(t, tenant.ID, series.ID, "en", "Starlit Library", "A library that opens at night.")
	pg.SeedEpisodeTranslation(t, tenant.ID, episode.ID, "en", "The First Night")

	seriesTitle := func(locale string) string {
		t.Helper()
		var title string
		mustQueryRow(t, ctx, pg.DB, `
			SELECT st.title FROM series_translation_for($1, $2) st
		`, &title, series.ID, locale)
		return title
	}
	episodeTitle := func(locale string) string {
		t.Helper()
		var title string
		mustQueryRow(t, ctx, pg.DB, `
			SELECT et.title FROM episode_translation_for($1, $2) et
		`, &title, episode.ID, locale)
		return title
	}

	for _, tc := range []struct {
		locale      string
		wantSeries  string
		wantEpisode string
	}{
		{locale: "en", wantSeries: "Starlit Library", wantEpisode: "The First Night"},
		{locale: "ko", wantSeries: "Hoshi no Toshokan", wantEpisode: "Daiichiya"},
		// Empty asks for the tenant default locale's.
		{locale: "", wantSeries: "Hoshi no Toshokan", wantEpisode: "Daiichiya"},
	} {
		if got := seriesTitle(tc.locale); got != tc.wantSeries {
			t.Fatalf("series title for %q = %q, want %q", tc.locale, got, tc.wantSeries)
		}
		if got := episodeTitle(tc.locale); got != tc.wantEpisode {
			t.Fatalf("episode title for %q = %q, want %q", tc.locale, got, tc.wantEpisode)
		}
	}

	// A default locale nothing is written in falls back to the oldest.
	mustExec(t, ctx, pg.DB, `UPDATE tenants SET default_locale = 'ko' WHERE id = $1`, tenant.ID)
	mustExec(t, ctx, pg.DB, `UPDATE series_translations SET created_at = now() - interval '1 day' WHERE series_id = $1 AND locale = 'en'`, series.ID)
	mustExec(t, ctx, pg.DB, `UPDATE episode_translations SET created_at = now() - interval '1 day' WHERE episode_id = $1 AND locale = 'en'`, episode.ID)
	if got := seriesTitle("zh-Hans"); got != "Starlit Library" {
		t.Fatalf("series title for zh-Hans with no ko default = %q, want the oldest, Starlit Library", got)
	}
	if got := episodeTitle("zh-Hans"); got != "The First Night" {
		t.Fatalf("episode title for zh-Hans with no ko default = %q, want the oldest, The First Night", got)
	}
}

// A translation belongs to a series or an episode of its own tenant, so a row
// naming another tenant's series is refused rather than stored where the
// other tenant's reads would pick it up.
func TestCatalogTranslationsStayWithinTheirTenant(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	mine := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	theirs := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	series := pg.SeedSeries(t, theirs.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Theirs"})
	episode := pg.SeedEpisode(t, theirs.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEB0001", Title: "Theirs"})

	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO series_translations (id, series_id, tenant_id, locale, title) VALUES ($1, $2, $3, 'en', 'Planted')
	`, uuid.Must(uuid.NewV7()), series.ID, mine.ID); err == nil {
		t.Fatal("a series translation stamped with another tenant was stored")
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title) VALUES ($1, $2, $3, 'en', 'Planted')
	`, uuid.Must(uuid.NewV7()), episode.ID, mine.ID); err == nil {
		t.Fatal("an episode translation stamped with another tenant was stored")
	}
}
