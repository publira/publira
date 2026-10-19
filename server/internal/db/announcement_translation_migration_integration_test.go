package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before an
// announcement had translations, and the one that took its copy off
// announcements.
const (
	beforeAnnouncementTranslationsVersion = 20261019104920
	announcementTranslationsVersion       = 20261019120621
)

// Every announcement stored before translations existed comes out of the
// migrations as exactly one translation in its tenant's default locale, and the
// way back puts the copy on announcements again.
func TestAnnouncementTranslationMigrationKeepsExistingCopy(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Behind the migrations under test, so the rows seeded below are rows they
	// find rather than rows written through them.
	pg.MigrateTo(t, beforeAnnouncementTranslationsVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := pg.DB

	japanese := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	english := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	mustExec(t, ctx, db, `UPDATE tenants SET default_locale = 'en' WHERE id = $1`, english.ID)
	mustExec(t, ctx, db, `
		INSERT INTO announcements (id, tenant_id, announcement_type, title, body)
		VALUES ('018f0f10-0000-7000-8000-000000000001', $1, 'announcement', 'Maintenance tonight (ja)', 'The site closes at 2:00 (ja).'),
			('018f0f10-0000-7000-8000-000000000002', $1, 'system', 'Terms updated (ja)', 'Read the new terms (ja).'),
			('018f0f10-0000-7000-8000-000000000003', $2, 'announcement', 'Maintenance tonight', 'The site closes at 2:00.')
	`, japanese.ID, english.ID)

	pg.MigrateTo(t, announcementTranslationsVersion)

	for _, tc := range []struct {
		id                  string
		locale, title, body string
	}{
		{id: "018f0f10-0000-7000-8000-000000000001", locale: "ja", title: "Maintenance tonight (ja)", body: "The site closes at 2:00 (ja)."},
		{id: "018f0f10-0000-7000-8000-000000000002", locale: "ja", title: "Terms updated (ja)", body: "Read the new terms (ja)."},
		{id: "018f0f10-0000-7000-8000-000000000003", locale: "en", title: "Maintenance tonight", body: "The site closes at 2:00."},
	} {
		var count int
		mustQueryRow(t, ctx, db, `SELECT count(*) FROM announcement_translations WHERE announcement_id = $1`, &count, tc.id)
		if count != 1 {
			t.Fatalf("%s: translations = %d, want 1", tc.id, count)
		}
		var locale, title, body string
		if err := db.QueryRowContext(ctx, `
			SELECT locale, title, body FROM announcement_translations WHERE announcement_id = $1
		`, tc.id).Scan(&locale, &title, &body); err != nil {
			t.Fatalf("%s: read translation: %v", tc.id, err)
		}
		if locale != tc.locale || title != tc.title || body != tc.body {
			t.Fatalf("%s: translation = (%q, %q, %q), want (%q, %q, %q)", tc.id, locale, title, body, tc.locale, tc.title, tc.body)
		}
	}

	var leftover int
	mustQueryRow(t, ctx, db, `
		SELECT count(*)
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'announcements'
			AND column_name IN ('title', 'body')
	`, &leftover)
	if leftover != 0 {
		t.Fatalf("announcements still carries %d of title and body", leftover)
	}

	// An announcement written after the upgrade in two locales goes back with
	// its default locale's copy.
	mustExec(t, ctx, db, `
		INSERT INTO announcements (id, tenant_id, announcement_type)
		VALUES ('018f0f10-0000-7000-8000-000000000004', $1, 'announcement')
	`, japanese.ID)
	mustExec(t, ctx, db, `
		INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body, created_at)
		VALUES (uuidv7(), '018f0f10-0000-7000-8000-000000000004', $1, 'en', 'Sale this week', 'Every volume is half price.', now() - interval '1 minute'),
			(uuidv7(), '018f0f10-0000-7000-8000-000000000004', $1, 'ja', 'Sale this week (ja)', 'Every volume is half price (ja).', now())
	`, japanese.ID)

	pg.MigrateTo(t, beforeAnnouncementTranslationsVersion)

	for _, tc := range []struct {
		id          string
		title, body string
	}{
		{id: "018f0f10-0000-7000-8000-000000000001", title: "Maintenance tonight (ja)", body: "The site closes at 2:00 (ja)."},
		{id: "018f0f10-0000-7000-8000-000000000003", title: "Maintenance tonight", body: "The site closes at 2:00."},
		{id: "018f0f10-0000-7000-8000-000000000004", title: "Sale this week (ja)", body: "Every volume is half price (ja)."},
	} {
		var title, body string
		if err := db.QueryRowContext(ctx, `SELECT title, body FROM announcements WHERE id = $1`, tc.id).Scan(&title, &body); err != nil {
			t.Fatalf("%s: read reverted announcement: %v", tc.id, err)
		}
		if title != tc.title || body != tc.body {
			t.Fatalf("%s: reverted announcement = (%q, %q), want (%q, %q)", tc.id, title, body, tc.title, tc.body)
		}
	}
}
