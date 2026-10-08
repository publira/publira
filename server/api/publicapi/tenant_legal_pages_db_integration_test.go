package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func getDBTenantLegalPages(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, locale string) *publirav1.GetTenantLegalPagesResponse {
	t.Helper()

	resp, err := env.tenantAPIClient().GetTenantLegalPages(context.Background(), &publirav1.GetTenantLegalPagesRequest{
		Tenant: tenantContext(tenant),
		Locale: locale,
	})
	if err != nil {
		t.Fatalf("GetTenantLegalPages(%q): %v", locale, err)
	}
	return resp
}

// wantLegalPage fails unless page is the given translation of a page at slug.
func wantLegalPage(t *testing.T, role string, page *publirav1.TenantLegalPage, slug, title, locale string, translation testutil.PageTranslation) {
	t.Helper()

	if page.GetSlug() != slug || page.GetTitle() != title || page.GetLocale() != locale ||
		page.GetVersionId() != translation.VersionID.String() {
		t.Fatalf("%s = %v, want %s titled %q in %s at version %s", role, page, slug, title, locale, translation.VersionID)
	}
}

// The storefront links the terms and privacy pages a tenant names, and only
// while they are published: a tenant that named none, and one whose named page
// is unpublished, gets nothing to link to.
func TestDBGetTenantLegalPagesReportsTheTenantsOwnPublishedPages(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	terms := env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	privacy := env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})
	otherTerms := env.PG.SeedPage(t, second.ID, testutil.PageSeed{Slug: "terms", Title: "Tenant B Terms", Published: true})

	if got := getDBTenantLegalPages(t, env, first, ""); got.TermsPage != nil || got.PrivacyPage != nil {
		t.Fatalf("legal pages before naming any = %v / %v, want none", got.TermsPage, got.PrivacyPage)
	}

	nameLegalPages(t, env, first.ID, terms.ID, privacy.ID)
	nameLegalPages(t, env, second.ID, otherTerms.ID, otherTerms.ID)

	got := getDBTenantLegalPages(t, env, first, "")
	wantLegalPage(t, "terms_page", got.TermsPage, "/tos", "Terms of Service", first.DefaultLocale,
		testutil.PageTranslation{ID: terms.TranslationID, VersionID: terms.VersionID})
	wantLegalPage(t, "privacy_page", got.PrivacyPage, "/privacy", "Privacy Policy", first.DefaultLocale,
		testutil.PageTranslation{ID: privacy.TranslationID, VersionID: privacy.VersionID})

	other := getDBTenantLegalPages(t, env, second, "")
	wantLegalPage(t, "tenant B terms_page", other.TermsPage, "/terms", "Tenant B Terms", second.DefaultLocale,
		testutil.PageTranslation{ID: otherTerms.TranslationID, VersionID: otherTerms.VersionID})
	if other.PrivacyPage.GetVersionId() != otherTerms.VersionID.String() {
		t.Fatalf("tenant B privacy_page = %v, want its own terms page named for both roles", other.PrivacyPage)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, "UPDATE page_translations SET published_version_id = NULL WHERE id = $1", terms.TranslationID); err != nil {
		t.Fatalf("unpublish terms: %v", err)
	}
	got = getDBTenantLegalPages(t, env, first, "")
	if got.TermsPage != nil {
		t.Fatalf("terms_page after unpublishing it = %v, want none", got.TermsPage)
	}
	if got.PrivacyPage.GetSlug() != "/privacy" {
		t.Fatalf("privacy_page after unpublishing terms = %v, want /privacy", got.PrivacyPage)
	}
}

// A reader is offered each page in their own locale where it is published in
// it, and in the tenant's default locale where it is not, so the title they
// read and the version they agree to belong to the text the link opens.
func TestDBGetTenantLegalPagesReadsEachPageInTheReadersLocale(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	terms := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms (ja)", Published: true})
	englishTerms := env.PG.SeedPageTranslation(t, tenant.ID, terms.ID, testutil.PageTranslationSeed{
		Locale:    "en",
		Title:     "Terms (en)",
		Published: true,
	})
	privacy := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy (ja)", Published: true})
	// A draft is not a translation the reader can be served, so it does not
	// stand in for the published default-locale one.
	env.PG.SeedPageTranslation(t, tenant.ID, privacy.ID, testutil.PageTranslationSeed{Locale: "en", Title: "Privacy Policy (en draft)"})
	nameLegalPages(t, env, tenant.ID, terms.ID, privacy.ID)

	japaneseTerms := testutil.PageTranslation{ID: terms.TranslationID, VersionID: terms.VersionID}
	japanesePrivacy := testutil.PageTranslation{ID: privacy.TranslationID, VersionID: privacy.VersionID}

	english := getDBTenantLegalPages(t, env, tenant, "en")
	wantLegalPage(t, "en terms_page", english.TermsPage, "/tos", "Terms (en)", "en", englishTerms)
	wantLegalPage(t, "en privacy_page", english.PrivacyPage, "/privacy", "Privacy Policy (ja)", "ja", japanesePrivacy)

	for _, locale := range []string{"ja", ""} {
		got := getDBTenantLegalPages(t, env, tenant, locale)
		wantLegalPage(t, "terms_page for "+locale, got.TermsPage, "/tos", "Terms (ja)", "ja", japaneseTerms)
		wantLegalPage(t, "privacy_page for "+locale, got.PrivacyPage, "/privacy", "Privacy Policy (ja)", "ja", japanesePrivacy)
	}

	_, err := env.tenantAPIClient().GetTenantLegalPages(context.Background(), &publirav1.GetTenantLegalPagesRequest{
		Tenant: tenantContext(tenant),
		Locale: "xx",
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("GetTenantLegalPages for an unsupported locale code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}

// A named page whose only published translation is not in the default locale
// is still served, so it is still linked, in that translation.
func TestDBGetTenantLegalPagesLinksAPagePublishedOnlyInAnotherLocale(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	terms := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{Slug: "tos", Title: "Terms (ja draft)"})
	english := env.PG.SeedPageTranslation(t, tenant.ID, terms.ID, testutil.PageTranslationSeed{
		Locale:    "en",
		Title:     "Terms of Service",
		Published: true,
	})
	nameLegalPages(t, env, tenant.ID, terms.ID, terms.ID)

	got := getDBTenantLegalPages(t, env, tenant, "")
	wantLegalPage(t, "terms_page", got.TermsPage, "/tos", "Terms of Service", "en", english)
}
