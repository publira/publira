package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// genre_translation_for picks the asked locale's name, then the tenant default
// locale's, then the oldest, as page_translation_for does, so a genre keeps a
// name after its tenant moves to a default locale none of its names is in.
func TestGenreTranslationForFallsBackToTheDefaultThenTheOldest(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	// Seeded in the tenant's default locale, ja, and named in en after.
	genre := pg.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREA000001", Name: "Kaiki"})
	pg.SeedGenreTranslation(t, tenant.ID, genre.ID, "en", "Horror")

	name := func(locale string) (string, string) {
		t.Helper()
		var name, served string
		if err := pg.DB.QueryRowContext(ctx, `
			SELECT gt.name, gt.locale FROM genre_translation_for($1, $2) gt
		`, genre.ID, locale).Scan(&name, &served); err != nil {
			t.Fatalf("genre_translation_for(%q): %v", locale, err)
		}
		return name, served
	}

	for _, tc := range []struct {
		locale     string
		wantName   string
		wantLocale string
	}{
		{locale: "en", wantName: "Horror", wantLocale: "en"},
		{locale: "ko", wantName: "Kaiki", wantLocale: "ja"},
		// Empty asks for the tenant default locale's.
		{locale: "", wantName: "Kaiki", wantLocale: "ja"},
	} {
		if got, served := name(tc.locale); got != tc.wantName || served != tc.wantLocale {
			t.Fatalf("name for %q = (%q, %q), want (%q, %q)", tc.locale, got, served, tc.wantName, tc.wantLocale)
		}
	}

	// A default locale nothing is written in falls back to the oldest.
	mustExec(t, ctx, pg.DB, `UPDATE tenants SET default_locale = 'ko' WHERE id = $1`, tenant.ID)
	mustExec(t, ctx, pg.DB, `UPDATE genre_translations SET created_at = now() - interval '1 day' WHERE genre_id = $1 AND locale = 'en'`, genre.ID)
	if got, _ := name("zh-Hans"); got != "Horror" {
		t.Fatalf("name for zh-Hans with no ko default = %q, want the oldest, Horror", got)
	}
}

// A name belongs to a genre of its own tenant, so a row naming another
// tenant's genre is refused rather than stored where the other tenant's reads
// would pick it up, and a genre's names go with it.
func TestGenreTranslationsStayWithTheirGenre(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	mine := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	theirs := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	genre := pg.SeedGenre(t, theirs.ID, testutil.GenreSeed{PublicID: "GENREB000001", Name: "Theirs"})

	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO genre_translations (id, genre_id, tenant_id, locale, name) VALUES ($1, $2, $3, 'en', 'Planted')
	`, uuid.Must(uuid.NewV7()), genre.ID, mine.ID); err == nil {
		t.Fatal("a genre name stamped with another tenant was stored")
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO genre_translations (id, genre_id, tenant_id, locale, name) VALUES ($1, $2, $3, 'ja', 'Twice')
	`, uuid.Must(uuid.NewV7()), genre.ID, theirs.ID); err == nil {
		t.Fatal("a second name in a locale the genre already has one in was stored")
	}

	mustExec(t, ctx, pg.DB, `DELETE FROM genres WHERE id = $1`, genre.ID)
	var left int
	mustQueryRow(t, ctx, pg.DB, `SELECT count(*) FROM genre_translations WHERE genre_id = $1`, &left, genre.ID)
	if left != 0 {
		t.Fatalf("names left behind by a deleted genre = %d, want 0", left)
	}
}
