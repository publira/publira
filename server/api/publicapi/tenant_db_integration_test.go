package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/tenanttz"
	"github.com/publira/publira/server/internal/testutil"
)

// Every storefront request starts by turning a host name into a tenant and then
// reading that tenant's branding. Domain resolution runs before any tenant
// context exists, and the branding tables sit behind RLS, so the two halves are
// worth seeing against a real database.

// seedTenantBranding stores the rows the storefront chrome is built from. Both
// tables are tenant-isolated, so the seed goes through the superuser connection.
func seedTenantBranding(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, copyright, description, tagline, primaryColor string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_config_translations (id, tenant_id, locale, copyright_text, site_description, site_tagline)
		VALUES (uuidv7(), $1, $2, $3, $4, $5)
	`, tenant.ID, tenant.DefaultLocale, copyright, description, tagline); err != nil {
		t.Fatalf("insert tenant_config_translations for %s: %v", tenant.PublicID, err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_themes (tenant_id, primary_color)
		VALUES ($1, $2)
	`, tenant.ID, primaryColor); err != nil {
		t.Fatalf("insert tenant_themes for %s: %v", tenant.PublicID, err)
	}
}

func TestDBGetTenantReturnsItsOwnBranding(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	seedTenantBranding(t, env, first, "© Tenant A", "Tenant A description", "Tenant A tagline", "#111111")
	seedTenantBranding(t, env, second, "© Tenant B", "Tenant B description", "Tenant B tagline", "#222222")

	resp, err := env.tenantAPIClient().GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: tenantContext(first),
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.TenantPublicId != first.PublicID || resp.TenantDomain != first.Domain {
		t.Fatalf("tenant = %s/%s, want %s/%s", resp.TenantPublicId, resp.TenantDomain, first.PublicID, first.Domain)
	}
	if resp.CopyrightText != "© Tenant A" {
		t.Fatalf("copyright_text = %q, want the row of tenant A", resp.CopyrightText)
	}
	if resp.SiteDescription != "Tenant A description" || resp.SiteTagline != "Tenant A tagline" {
		t.Fatalf("site text = %q / %q, want the rows of tenant A", resp.SiteDescription, resp.SiteTagline)
	}
	if resp.Theme == nil || resp.Theme.PrimaryColor != "#111111" {
		t.Fatalf("theme = %+v, want the primary color of tenant A", resp.Theme)
	}
	if resp.Timezone != tenanttz.Default {
		t.Fatalf("timezone = %q, want the column default %q", resp.Timezone, tenanttz.Default)
	}
	if resp.DefaultLocale != first.DefaultLocale {
		t.Fatalf("default_locale = %q, want the stored value %q", resp.DefaultLocale, first.DefaultLocale)
	}
}

// The dark palette is a row of its own that a tenant may not have, and the
// storefront reads each tenant's alone: a tenant without one is answered
// without one, not with another tenant's or with the light palette.
func TestDBGetTenantAnswersItsOwnDarkTheme(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_theme_dark (
			tenant_id,
			background_color, foreground_color, surface_color, surface_foreground_color,
			card_color, card_foreground_color, popover_color, popover_foreground_color,
			primary_color, primary_foreground_color, secondary_color, secondary_foreground_color,
			accent_color, accent_foreground_color, muted_color, muted_foreground_color,
			border_color, input_color, ring_color,
			success_color, success_foreground_color, warning_color, warning_foreground_color,
			destructive_color, destructive_foreground_color, info_color, info_foreground_color
		) VALUES (
			$1,
			'#121212', '#e8e6e3', '#1a1a1a', '#e8e6e3',
			'#1e1e1e', '#e8e6e3', '#1e1e1e', '#e8e6e3',
			'#8fb0f0', '#0d1b33', '#f08a6c', '#2a0d05',
			'#2a3550', '#dfe6f5', '#2a2a28', '#b5b3ad',
			'#3a3a37', '#44443f', '#8fb0f0',
			'#7cc79a', '#0b2414', '#e0b060', '#2a1a00',
			'#f08080', '#2a0505', '#82b0e0', '#0a1a2a'
		)
	`, first.ID); err != nil {
		t.Fatalf("insert tenant_theme_dark for %s: %v", first.PublicID, err)
	}

	resp, err := env.tenantAPIClient().GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: tenantContext(first),
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.DarkTheme == nil || resp.DarkTheme.BackgroundColor != "#121212" || resp.DarkTheme.PrimaryColor != "#8fb0f0" || resp.DarkTheme.InfoForegroundColor != "#0a1a2a" {
		t.Fatalf("dark_theme = %+v, want the row of tenant A", resp.DarkTheme)
	}
	if resp.Theme == nil || resp.Theme.BackgroundColor == "#121212" {
		t.Fatalf("theme = %+v, want the light palette beside the dark one", resp.Theme)
	}

	other, err := env.tenantAPIClient().GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: tenantContext(second),
	})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if other.DarkTheme != nil {
		t.Fatalf("dark_theme of tenant B = %+v, want none", other.DarkTheme)
	}
}

// A reader in a locale the tenant wrote no copy in is served the copy of the
// tenant's default locale, and a reader in a locale it did write is served
// that one.
func TestDBGetTenantReadsTheSiteCopyInTheReadersLocale(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	seedTenantBranding(t, env, tenant, "© Hoshi Shobo", "Comics from Hoshi Shobo", "Read tonight", "#111111")

	read := func(locale string) *publirav1.GetTenantResponse {
		t.Helper()
		resp, err := env.tenantAPIClient().GetTenant(context.Background(), &publirav1.GetTenantRequest{
			Tenant: tenantContext(tenant),
			Locale: locale,
		})
		if err != nil {
			t.Fatalf("GetTenant(%q): %v", locale, err)
		}
		return resp
	}

	if got := read("en"); got.CopyrightText != "© Hoshi Shobo" || got.SiteDescription != "Comics from Hoshi Shobo" || got.SiteTagline != "Read tonight" {
		t.Fatalf("en with only %s copy = %q / %q / %q, want the %s copy", tenant.DefaultLocale, got.CopyrightText, got.SiteDescription, got.SiteTagline, tenant.DefaultLocale)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_config_translations (id, tenant_id, locale, copyright_text)
		VALUES (uuidv7(), $1, 'en', '© Star Books')
	`, tenant.ID); err != nil {
		t.Fatalf("insert the en copy: %v", err)
	}

	// The en copy is taken whole: the fields it leaves empty are not filled in
	// from the default locale's.
	if got := read("en"); got.CopyrightText != "© Star Books" || got.SiteDescription != "" || got.SiteTagline != "" {
		t.Fatalf("en = %q / %q / %q, want the en copy alone", got.CopyrightText, got.SiteDescription, got.SiteTagline)
	}
	if got := read(""); got.CopyrightText != "© Hoshi Shobo" {
		t.Fatalf("no locale = %q, want the %s copy", got.CopyrightText, tenant.DefaultLocale)
	}
}

func TestDBGetTenantRejectsAnUnknownTenant(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_, err := env.tenantAPIClient().GetTenant(context.Background(), &publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: uuid.Must(uuid.NewV7()).String()},
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetTenant for an unknown tenant code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

// Domain resolution is the one public RPC that runs without a tenant context,
// because it is what produces one. It therefore also runs without
// app.current_tenant_id set on the connection.
func TestDBGetTenantByDomainResolvesTheFirstMatchingHost(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	client := env.domainClient()

	resp, err := client.GetTenantByDomain(context.Background(), &publirav1.GetTenantByDomainRequest{
		Domains: []string{"unknown.example.com", second.Domain, first.Domain},
	})
	if err != nil {
		t.Fatalf("GetTenantByDomain: %v", err)
	}
	if resp.TenantId != second.ID.String() {
		t.Fatalf("tenant_id = %q, want tenant B (%s), the first candidate that matches", resp.TenantId, second.ID)
	}
	if resp.DefaultLocale != second.DefaultLocale {
		t.Fatalf("default_locale = %q, want the stored value %q of the matched tenant", resp.DefaultLocale, second.DefaultLocale)
	}

	_, err = client.GetTenantByDomain(context.Background(), &publirav1.GetTenantByDomainRequest{
		Domains: []string{"nobody.example.com"},
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetTenantByDomain for an unknown host code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

// The marks are read without a session, each tenant's own, and a tenant that
// uploaded none answers none.
func TestDBGetTenantAnswersItsOwnBrandMarks(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	admin := env.PG.SeedTenantAdmin(t, first.ID, "ADMINA000001", "admin@tenant-a.example.com", "Admin")
	imageID := uuid.Must(uuid.NewV7())
	acceptedAt := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	ctx := context.Background()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{"INSERT INTO tenant_images (id, tenant_id) VALUES ($1, $2)", []any{imageID, first.ID}},
		{`INSERT INTO tenant_image_variants
			(id, tenant_id, tenant_image_id, label, variant_type, storage_provider, object_key, content_type, file_size_bytes, width, height)
			VALUES ($1, $2, $3, 'original', 'line_share', 's3', 'tenants/brand-marks/line.png', 'image/png', 1, 64, 64)`,
			[]any{uuid.Must(uuid.NewV7()), first.ID, imageID}},
		{`INSERT INTO tenant_brand_marks (tenant_id, kind, image_id, terms_url, terms_accepted_by_user_id, terms_accepted_at)
			VALUES ($1, 'line_share', $2, 'https://example.com/line-guidelines', $3, $4)`,
			[]any{first.ID, imageID, admin.ID, acceptedAt}},
	} {
		if _, err := env.PG.DB.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("seed brand mark: %v", err)
		}
	}

	resp, err := env.tenantAPIClient().GetTenant(ctx, &publirav1.GetTenantRequest{Tenant: tenantContext(first)})
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if len(resp.BrandMarks) != 1 {
		t.Fatalf("brand_marks = %v, want the LINE mark alone", resp.BrandMarks)
	}
	mark := resp.BrandMarks[0]
	if mark.Kind != publirattypesv1.TenantBrandMarkKind_TENANT_BRAND_MARK_KIND_LINE_SHARE {
		t.Fatalf("kind = %s, want LINE_SHARE", mark.Kind)
	}
	if mark.TermsUrl != "https://example.com/line-guidelines" || mark.TermsAcceptedAt != acceptedAt.Format(time.RFC3339) {
		t.Fatalf("consent = %q at %q, want the stored URL and time", mark.TermsUrl, mark.TermsAcceptedAt)
	}
	if len(mark.ImageVariants) != 1 || mark.ImageVariants[0].VariantType != "line_share" {
		t.Fatalf("image_variants = %v, want the line_share variant", mark.ImageVariants)
	}

	other, err := env.tenantAPIClient().GetTenant(ctx, &publirav1.GetTenantRequest{Tenant: tenantContext(second)})
	if err != nil {
		t.Fatalf("GetTenant (no marks): %v", err)
	}
	if len(other.BrandMarks) != 0 {
		t.Fatalf("brand_marks of a tenant that uploaded none = %v, want none", other.BrandMarks)
	}
}
