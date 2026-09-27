package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before pages
// had translations, and the one that took the title and the published version
// off pages.
const (
	beforePageTranslationsVersion = 20260927220815
	pageTranslationsVersion       = 20260927230339
)

// legacyPage is a page written the way pages were stored before translations:
// the title and the live version on the page itself.
type legacyPage struct {
	id               uuid.UUID
	tenantID         uuid.UUID
	title            string
	versionIDs       []uuid.UUID
	publishedVersion uuid.NullUUID
}

func insertLegacyPage(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID, slug, title string, versions int, publish bool) legacyPage {
	t.Helper()

	page := legacyPage{id: mustUUID(t), tenantID: tenantID, title: title}
	mustExec(t, ctx, db, `INSERT INTO pages (id, tenant_id, slug, title) VALUES ($1, $2, $3, $4)`,
		page.id, tenantID, slug, title)
	for number := 1; number <= versions; number++ {
		versionID := mustUUID(t)
		mustExec(t, ctx, db, `
			INSERT INTO page_versions (id, tenant_id, page_id, version_number, content_markdown, status, published_at)
			VALUES ($1, $2, $3, $4, $5, 'published', now())
		`, versionID, tenantID, page.id, number, title+" body")
		page.versionIDs = append(page.versionIDs, versionID)
	}
	if publish {
		page.publishedVersion = uuid.NullUUID{UUID: page.versionIDs[len(page.versionIDs)-1], Valid: true}
		mustExec(t, ctx, db, `UPDATE pages SET published_version_id = $2 WHERE id = $1`, page.id, page.publishedVersion)
	}
	return page
}

// Every page stored before translations existed comes out of the migrations as
// one translation in its tenant's default locale, carrying the title, the live
// version, and the whole version history it had. Losing any of it would take a
// published terms page off the storefront or orphan the versions readers
// agreed to.
func TestPageTranslationMigrationKeepsExistingPages(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Behind the migrations under test, so the rows seeded below are rows they
	// find rather than rows written through them.
	pg.MigrateTo(t, beforePageTranslationsVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := pg.DB

	japanese := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	english := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	mustExec(t, ctx, db, `UPDATE tenants SET default_locale = 'en' WHERE id = $1`, english.ID)

	terms := insertLegacyPage(t, ctx, db, japanese.ID, "/terms", "Terms of Service", 2, true)
	draft := insertLegacyPage(t, ctx, db, japanese.ID, "/draft", "Draft", 1, false)
	privacy := insertLegacyPage(t, ctx, db, english.ID, "/privacy", "Privacy Policy", 1, true)

	pg.MigrateTo(t, pageTranslationsVersion)

	for _, tc := range []struct {
		page   legacyPage
		locale string
	}{
		{page: terms, locale: "ja"},
		{page: draft, locale: "ja"},
		{page: privacy, locale: "en"},
	} {
		var count int
		mustQueryRow(t, ctx, db, `SELECT count(*) FROM page_translations WHERE page_id = $1`, &count, tc.page.id)
		if count != 1 {
			t.Fatalf("translations of %s = %d, want 1", tc.page.title, count)
		}

		var translationID, tenantID uuid.UUID
		var locale, title string
		var published uuid.NullUUID
		if err := db.QueryRowContext(ctx, `
			SELECT id, tenant_id, locale, title, published_version_id
			FROM page_translations
			WHERE page_id = $1
		`, tc.page.id).Scan(&translationID, &tenantID, &locale, &title, &published); err != nil {
			t.Fatalf("read translation of %s: %v", tc.page.title, err)
		}
		if tenantID != tc.page.tenantID || locale != tc.locale || title != tc.page.title || published != tc.page.publishedVersion {
			t.Fatalf("translation of %s = (%v, %q, %q, %v), want (%v, %q, %q, %v)",
				tc.page.title, tenantID, locale, title, published,
				tc.page.tenantID, tc.locale, tc.page.title, tc.page.publishedVersion)
		}

		for number, versionID := range tc.page.versionIDs {
			var versionTranslationID uuid.UUID
			var versionNumber int
			mustQueryRow(t, ctx, db, `SELECT translation_id FROM page_versions WHERE id = $1`, &versionTranslationID, versionID)
			mustQueryRow(t, ctx, db, `SELECT version_number FROM page_versions WHERE id = $1`, &versionNumber, versionID)
			if versionTranslationID != translationID || versionNumber != number+1 {
				t.Fatalf("version %d of %s = (%v, %d), want (%v, %d)",
					number+1, tc.page.title, versionTranslationID, versionNumber, translationID, number+1)
			}
		}
	}

	var leftover int
	mustQueryRow(t, ctx, db, `
		SELECT count(*)
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'pages'
			AND column_name IN ('title', 'published_version_id')
	`, &leftover)
	if leftover != 0 {
		t.Fatalf("pages still carries %d of title and published_version_id", leftover)
	}

	// And the way back puts the title and the live version on the page again.
	pg.MigrateTo(t, beforePageTranslationsVersion)

	for _, page := range []legacyPage{terms, draft, privacy} {
		var title string
		var published uuid.NullUUID
		if err := db.QueryRowContext(ctx, `
			SELECT title, published_version_id FROM pages WHERE id = $1
		`, page.id).Scan(&title, &published); err != nil {
			t.Fatalf("read reverted %s: %v", page.title, err)
		}
		if title != page.title || published != page.publishedVersion {
			t.Fatalf("reverted %s = (%q, %v), want (%q, %v)", page.title, title, published, page.title, page.publishedVersion)
		}
	}
}
