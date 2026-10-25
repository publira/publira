package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before genres
// had translations, and the one that took the name off genres.
const (
	beforeGenreTranslationsVersion = 20261019104920
	genreTranslationsVersion       = 20261019111943
)

// Every genre stored before translations existed comes out of the migrations
// as exactly one translation in its tenant's default locale, carrying the name
// it had, and the way back puts the name on the genre again.
func TestGenreTranslationMigrationKeepsExistingNames(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Behind the migrations under test, so the rows seeded below are rows they
	// find rather than rows written through them.
	pg.MigrateTo(t, beforeGenreTranslationsVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := pg.DB

	japanese := pg.SeedTenantOnOlderSchema(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	english := pg.SeedTenantOnOlderSchema(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	mustExec(t, ctx, db, `UPDATE tenants SET default_locale = 'en' WHERE id = $1`, english.ID)

	fantasy := pg.SeedGenre(t, japanese.ID, testutil.GenreSeed{PublicID: "GENREA000001", Name: "Fantasy"})
	mystery := pg.SeedGenre(t, english.ID, testutil.GenreSeed{PublicID: "GENREB000001", Name: "Mystery"})

	pg.MigrateTo(t, genreTranslationsVersion)

	for _, tc := range []struct {
		name         string
		genreID      any
		locale, want string
	}{
		{name: "ja tenant", genreID: fantasy.ID, locale: "ja", want: "Fantasy"},
		{name: "en tenant", genreID: mystery.ID, locale: "en", want: "Mystery"},
	} {
		var count int
		mustQueryRow(t, ctx, db, `SELECT count(*) FROM genre_translations WHERE genre_id = $1`, &count, tc.genreID)
		if count != 1 {
			t.Fatalf("%s: genre translations = %d, want 1", tc.name, count)
		}
		var locale, name string
		if err := db.QueryRowContext(ctx, `
			SELECT locale, name FROM genre_translations WHERE genre_id = $1
		`, tc.genreID).Scan(&locale, &name); err != nil {
			t.Fatalf("%s: read genre translation: %v", tc.name, err)
		}
		if locale != tc.locale || name != tc.want {
			t.Fatalf("%s: genre translation = (%q, %q), want (%q, %q)", tc.name, locale, name, tc.locale, tc.want)
		}
	}

	var leftover int
	mustQueryRow(t, ctx, db, `
		SELECT count(*)
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'genres'
			AND column_name = 'name'
	`, &leftover)
	if leftover != 0 {
		t.Fatal("genres still carries name")
	}

	// The way back puts the default locale's name on the genre again, or the
	// oldest one's where the default locale has none.
	pg.SeedGenreTranslation(t, english.ID, mystery.ID, "ja", "Suiri")
	mustExec(t, ctx, db, `UPDATE tenants SET default_locale = 'ko' WHERE id = $1`, english.ID)
	pg.MigrateTo(t, beforeGenreTranslationsVersion)

	for _, tc := range []struct {
		genreID any
		want    string
	}{
		{genreID: fantasy.ID, want: "Fantasy"},
		{genreID: mystery.ID, want: "Mystery"},
	} {
		var name string
		mustQueryRow(t, ctx, db, `SELECT name FROM genres WHERE id = $1`, &name, tc.genreID)
		if name != tc.want {
			t.Fatalf("reverted genre name = %q, want %q", name, tc.want)
		}
	}
}
