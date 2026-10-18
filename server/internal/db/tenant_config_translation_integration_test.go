package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// tenant_config_translation_for picks the asked locale's copy, then the tenant
// default locale's, then the oldest, as page_translation_for does, so a site
// keeps its copy after its tenant moves to a default locale none of it is in.
func TestTenantConfigTranslationForFallsBackToTheDefaultThenTheOldest(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	silent := pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	// The default locale's copy is written first and the en copy after it, so
	// the oldest is the ja one until it is deleted.
	mustExec(t, ctx, pg.DB, `
		INSERT INTO tenant_config_translations (id, tenant_id, locale, copyright_text, created_at)
		VALUES (uuidv7(), $1, 'ja', '© Hoshi Shobo', now() - interval '1 minute'),
			(uuidv7(), $1, 'en', '© Star Books', now())
	`, tenant.ID)

	copyright := func(tenantID any, locale string) (string, bool) {
		t.Helper()
		var text string
		err := pg.DB.QueryRowContext(ctx, `
			SELECT tct.copyright_text FROM tenant_config_translation_for($1, $2) tct
		`, tenantID, locale).Scan(&text)
		if errors.Is(err, sql.ErrNoRows) {
			return "", false
		}
		if err != nil {
			t.Fatalf("tenant_config_translation_for(%q): %v", locale, err)
		}
		return text, true
	}
	expect := func(step, locale, want string) {
		t.Helper()
		if got, _ := copyright(tenant.ID, locale); got != want {
			t.Fatalf("%s: copy for %q = %q, want %q", step, locale, got, want)
		}
	}

	expect("asked locale", "en", "© Star Books")
	expect("default locale", "ko", "© Hoshi Shobo")
	expect("no locale", "", "© Hoshi Shobo")

	mustExec(t, ctx, pg.DB, `UPDATE tenants SET default_locale = 'ko' WHERE id = $1`, tenant.ID)
	expect("oldest after the default moved", "zh-Hans", "© Hoshi Shobo")

	mustExec(t, ctx, pg.DB, `DELETE FROM tenant_config_translations WHERE tenant_id = $1 AND locale = 'ja'`, tenant.ID)
	expect("oldest left", "zh-Hans", "© Star Books")

	if got, ok := copyright(silent.ID, "ja"); ok {
		t.Fatalf("a tenant with no copy answered %q, want no row", got)
	}
}

// A row holds some copy: one whose three fields are all blank is refused, since
// a locale with no copy is a locale with no row.
func TestTenantConfigTranslationsRefuseARowWithNoCopy(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_config_translations (id, tenant_id, locale, site_tagline)
		VALUES (uuidv7(), $1, 'ja', '  ')
	`, tenant.ID); err == nil {
		t.Fatal("a row with no copy was stored, want tenant_config_translations_copy_not_blank_check to refuse it")
	}
}
