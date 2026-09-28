package dbtest

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// pageTranslationFixture is one page of one tenant with a translation in each
// of two locales, and a first version of each.
type pageTranslationFixture struct {
	tenantID  uuid.UUID
	pageID    uuid.UUID
	japanese  uuid.UUID
	english   uuid.UUID
	jaVersion uuid.UUID
	enVersion uuid.UUID
}

func insertPageTranslation(t *testing.T, ctx context.Context, db *sql.DB, tenantID, pageID uuid.UUID, locale, title string) uuid.UUID {
	t.Helper()
	id := mustUUID(t)
	mustExec(t, ctx, db, `INSERT INTO page_translations (id, tenant_id, page_id, locale, title) VALUES ($1, $2, $3, $4, $5)`,
		id, tenantID, pageID, locale, title)
	return id
}

func insertPageVersion(t *testing.T, ctx context.Context, db *sql.DB, tenantID, pageID, translationID uuid.UUID, number int) uuid.UUID {
	t.Helper()
	id := mustUUID(t)
	mustExec(t, ctx, db, `
		INSERT INTO page_versions (id, tenant_id, page_id, translation_id, version_number)
		VALUES ($1, $2, $3, $4, $5)
	`, id, tenantID, pageID, translationID, number)
	return id
}

func seedPageTranslationFixture(t *testing.T, ctx context.Context, pg *testutil.PostgresEnv) pageTranslationFixture {
	t.Helper()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	fixture := pageTranslationFixture{tenantID: tenant.ID, pageID: mustUUID(t)}
	mustExec(t, ctx, pg.DB, `INSERT INTO pages (id, tenant_id, slug) VALUES ($1, $2, '/terms')`, fixture.pageID, tenant.ID)
	fixture.japanese = insertPageTranslation(t, ctx, pg.DB, tenant.ID, fixture.pageID, "ja", "Terms (Japanese)")
	fixture.english = insertPageTranslation(t, ctx, pg.DB, tenant.ID, fixture.pageID, "en", "Terms")
	fixture.jaVersion = insertPageVersion(t, ctx, pg.DB, tenant.ID, fixture.pageID, fixture.japanese, 1)
	fixture.enVersion = insertPageVersion(t, ctx, pg.DB, tenant.ID, fixture.pageID, fixture.english, 1)
	return fixture
}

// A page holds at most one translation per locale, and a locale is never
// blank: the public lookup picks a translation by locale, so a second one or
// an empty one would leave it nothing definite to serve.
func TestPageTranslationLocaleIsUniqueAndNotBlank(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fixture := seedPageTranslationFixture(t, ctx, pg)

	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO page_translations (id, tenant_id, page_id, locale, title) VALUES ($1, $2, $3, 'en', 'Terms again')
	`, mustUUID(t), fixture.tenantID, fixture.pageID)
	if !isUniqueViolation(err) || !strings.Contains(err.Error(), "page_translations_page_id_locale_key") {
		t.Fatalf("second en translation: err = %v, want page_translations_page_id_locale_key", err)
	}

	_, err = pg.DB.ExecContext(ctx, `
		INSERT INTO page_translations (id, tenant_id, page_id, locale, title) VALUES ($1, $2, $3, '  ', 'Blank')
	`, mustUUID(t), fixture.tenantID, fixture.pageID)
	if !isCheckViolation(err) || !strings.Contains(err.Error(), "page_translations_locale_not_blank_check") {
		t.Fatalf("blank locale: err = %v, want page_translations_locale_not_blank_check", err)
	}
}

// Each translation numbers its own history from 1, so the same number may
// appear once in every translation of a page but only once within one.
func TestPageVersionNumbersAreCountedPerTranslation(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fixture := seedPageTranslationFixture(t, ctx, pg)

	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO page_versions (id, tenant_id, page_id, translation_id, version_number) VALUES ($1, $2, $3, $4, 1)
	`, mustUUID(t), fixture.tenantID, fixture.pageID, fixture.japanese)
	if !isUniqueViolation(err) || !strings.Contains(err.Error(), "page_versions_translation_id_version_number_key") {
		t.Fatalf("second version 1 of one translation: err = %v, want page_versions_translation_id_version_number_key", err)
	}
}

// A version belongs to a translation of its own page, and a translation's live
// version is one of its own. Either the other way round would let publishing
// one language change what another serves.
func TestPageTranslationVersionsStayWithTheirTranslation(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fixture := seedPageTranslationFixture(t, ctx, pg)

	otherPage := mustUUID(t)
	mustExec(t, ctx, pg.DB, `INSERT INTO pages (id, tenant_id, slug) VALUES ($1, $2, '/privacy')`, otherPage, fixture.tenantID)
	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO page_versions (id, tenant_id, page_id, translation_id, version_number) VALUES ($1, $2, $3, $4, 2)
	`, mustUUID(t), fixture.tenantID, otherPage, fixture.english)
	if !isForeignKeyViolation(err) || !strings.Contains(err.Error(), "page_versions_tenant_page_translation_id_fkey") {
		t.Fatalf("version naming another page's translation: err = %v, want page_versions_tenant_page_translation_id_fkey", err)
	}

	_, err = pg.DB.ExecContext(ctx, `UPDATE page_translations SET published_version_id = $2 WHERE id = $1`,
		fixture.english, fixture.jaVersion)
	if !isForeignKeyViolation(err) || !strings.Contains(err.Error(), "page_translations_tenant_published_version_id_fkey") {
		t.Fatalf("publishing another translation's version: err = %v, want page_translations_tenant_published_version_id_fkey", err)
	}

	mustExec(t, ctx, pg.DB, `UPDATE page_translations SET published_version_id = $2 WHERE id = $1`, fixture.english, fixture.enVersion)
	var japanesePublished uuid.NullUUID
	mustQueryRow(t, ctx, pg.DB, `SELECT published_version_id FROM page_translations WHERE id = $1`, &japanesePublished, fixture.japanese)
	if japanesePublished.Valid {
		t.Fatalf("ja published_version_id = %v after publishing en, want NULL", japanesePublished.UUID)
	}
}

// page_translation_for picks the asked locale's translation, then the tenant
// default locale's, then the page's oldest, so a page is still found after its
// tenant moves to a default locale none of its translations is in.
func TestPageTranslationForFallsBackToTheDefaultThenTheOldest(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fixture := seedPageTranslationFixture(t, ctx, pg)

	pick := func(locale string) uuid.UUID {
		t.Helper()
		var id uuid.UUID
		mustQueryRow(t, ctx, pg.DB, `SELECT page_translation_for($1, $2)`, &id, fixture.pageID, locale)
		return id
	}

	if got := pick("en"); got != fixture.english {
		t.Fatalf("translation for en = %v, want the en one %v", got, fixture.english)
	}
	// The tenant's default locale is ja.
	if got := pick("fr"); got != fixture.japanese {
		t.Fatalf("translation for fr = %v, want the default-locale ja one %v", got, fixture.japanese)
	}

	mustExec(t, ctx, pg.DB, `UPDATE tenants SET default_locale = 'fr' WHERE id = $1`, fixture.tenantID)
	mustExec(t, ctx, pg.DB, `UPDATE page_translations SET created_at = now() - interval '1 day' WHERE id = $1`, fixture.english)
	if got := pick("fr"); got != fixture.english {
		t.Fatalf("translation for fr with no fr default = %v, want the oldest en one %v", got, fixture.english)
	}
}

// published_page_translation_for chooses in page_translation_for's order, but
// only among translations whose live version is published and due, so a draft
// or an embargoed translation never displaces one a reader can read.
func TestPublishedPageTranslationForSkipsTranslationsThatAreNotLive(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	fixture := seedPageTranslationFixture(t, ctx, pg)

	pick := func(locale string) uuid.NullUUID {
		t.Helper()
		var id uuid.NullUUID
		mustQueryRow(t, ctx, pg.DB, `SELECT published_page_translation_for($1, $2)`, &id, fixture.pageID, locale)
		return id
	}
	publish := func(translation, version uuid.UUID, at string) {
		t.Helper()
		mustExec(t, ctx, pg.DB, `UPDATE page_versions SET status = 'published', published_at = now() + $2::interval WHERE id = $1`, version, at)
		mustExec(t, ctx, pg.DB, `UPDATE page_translations SET published_version_id = $2 WHERE id = $1`, translation, version)
	}

	if got := pick("en"); got.Valid {
		t.Fatalf("translation with nothing published = %v, want NULL", got.UUID)
	}

	publish(fixture.english, fixture.enVersion, "1 day")
	if got := pick("en"); got.Valid {
		t.Fatalf("translation with only an embargoed en = %v, want NULL", got.UUID)
	}

	// The default locale is ja, but only en is live, so every locale is served en.
	publish(fixture.english, fixture.enVersion, "-1 day")
	for _, locale := range []string{"en", "ja", "fr"} {
		if got := pick(locale); got.UUID != fixture.english {
			t.Fatalf("translation for %s with only en live = %v, want the en one %v", locale, got.UUID, fixture.english)
		}
	}

	publish(fixture.japanese, fixture.jaVersion, "-1 day")
	if got := pick("en"); got.UUID != fixture.english {
		t.Fatalf("translation for en = %v, want the en one %v", got.UUID, fixture.english)
	}
	if got := pick("fr"); got.UUID != fixture.japanese {
		t.Fatalf("translation for fr = %v, want the default-locale ja one %v", got.UUID, fixture.japanese)
	}
}
