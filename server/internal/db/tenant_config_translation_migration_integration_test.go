package dbtest

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before the
// site copy had translations, and the one that took it off tenant_config.
const (
	beforeTenantConfigTranslationsVersion = 20261017135523
	tenantConfigTranslationsVersion       = 20261018064035
)

// Every tenant's site copy stored before translations existed comes out of the
// migrations as exactly one translation in its default locale, a tenant that
// wrote none comes out with none, and the way back puts the copy on
// tenant_config again.
func TestTenantConfigTranslationMigrationKeepsExistingCopy(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Behind the migrations under test, so the rows seeded below are rows they
	// find rather than rows written through them.
	pg.MigrateTo(t, beforeTenantConfigTranslationsVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := pg.DB

	japanese := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	english := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	blank := pg.SeedTenant(t, "TENANTC", "tenant-c.example.com", "Tenant C")
	unconfigured := pg.SeedTenant(t, "TENANTD", "tenant-d.example.com", "Tenant D")
	mustExec(t, ctx, db, `UPDATE tenants SET default_locale = 'en' WHERE id = $1`, english.ID)
	mustExec(t, ctx, db, `
		INSERT INTO tenant_config (tenant_id, copyright_text, site_description, site_tagline)
		VALUES ($1, '© Hoshi Shobo', 'Comics from Hoshi Shobo', 'Read tonight'),
			($2, '© Star Books', NULL, NULL),
			($3, NULL, '', '  ')
	`, japanese.ID, english.ID, blank.ID)

	pg.MigrateTo(t, tenantConfigTranslationsVersion)

	for _, tc := range []struct {
		name                            string
		tenantID                        any
		locale                          string
		copyright, description, tagline string
	}{
		{name: "all three", tenantID: japanese.ID, locale: "ja", copyright: "© Hoshi Shobo", description: "Comics from Hoshi Shobo", tagline: "Read tonight"},
		{name: "copyright only", tenantID: english.ID, locale: "en", copyright: "© Star Books"},
	} {
		var count int
		mustQueryRow(t, ctx, db, `SELECT count(*) FROM tenant_config_translations WHERE tenant_id = $1`, &count, tc.tenantID)
		if count != 1 {
			t.Fatalf("%s: translations = %d, want 1", tc.name, count)
		}
		var locale, copyright, description, tagline string
		if err := db.QueryRowContext(ctx, `
			SELECT locale, copyright_text, site_description, site_tagline FROM tenant_config_translations WHERE tenant_id = $1
		`, tc.tenantID).Scan(&locale, &copyright, &description, &tagline); err != nil {
			t.Fatalf("%s: read translation: %v", tc.name, err)
		}
		if locale != tc.locale || copyright != tc.copyright || description != tc.description || tagline != tc.tagline {
			t.Fatalf("%s: translation = (%q, %q, %q, %q), want (%q, %q, %q, %q)", tc.name, locale, copyright, description, tagline, tc.locale, tc.copyright, tc.description, tc.tagline)
		}
	}
	for name, tenantID := range map[string]any{"blank copy": blank.ID, "no config row": unconfigured.ID} {
		var count int
		mustQueryRow(t, ctx, db, `SELECT count(*) FROM tenant_config_translations WHERE tenant_id = $1`, &count, tenantID)
		if count != 0 {
			t.Fatalf("%s: translations = %d, want none", name, count)
		}
	}

	var leftover int
	mustQueryRow(t, ctx, db, `
		SELECT count(*)
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'tenant_config'
			AND column_name IN ('copyright_text', 'site_description', 'site_tagline')
	`, &leftover)
	if leftover != 0 {
		t.Fatalf("tenant_config still carries %d of copyright_text, site_description, and site_tagline", leftover)
	}

	// A tenant that writes its first copy after the upgrade has no config row
	// to carry it back to, so the way back gives it one.
	mustExec(t, ctx, db, `
		INSERT INTO tenant_config_translations (id, tenant_id, locale, site_tagline)
		VALUES (uuidv7(), $1, 'ja', 'New tagline')
	`, unconfigured.ID)

	// The way back puts the default locale's copy on tenant_config again, and
	// leaves a field that copy left empty NULL.
	pg.MigrateTo(t, beforeTenantConfigTranslationsVersion)

	for _, tc := range []struct {
		name                            string
		tenantID                        any
		copyright, description, tagline sql.NullString
	}{
		{name: "all three", tenantID: japanese.ID, copyright: nullText("© Hoshi Shobo"), description: nullText("Comics from Hoshi Shobo"), tagline: nullText("Read tonight")},
		{name: "copyright only", tenantID: english.ID, copyright: nullText("© Star Books")},
		{name: "written after the upgrade", tenantID: unconfigured.ID, tagline: nullText("New tagline")},
	} {
		var copyright, description, tagline sql.NullString
		if err := db.QueryRowContext(ctx, `
			SELECT copyright_text, site_description, site_tagline FROM tenant_config WHERE tenant_id = $1
		`, tc.tenantID).Scan(&copyright, &description, &tagline); err != nil {
			t.Fatalf("%s: read reverted config: %v", tc.name, err)
		}
		if copyright != tc.copyright || description != tc.description || tagline != tc.tagline {
			t.Fatalf("%s: reverted config = (%v, %v, %v), want (%v, %v, %v)", tc.name, copyright, description, tagline, tc.copyright, tc.description, tc.tagline)
		}
	}
}

func nullText(s string) sql.NullString {
	return sql.NullString{String: s, Valid: true}
}
