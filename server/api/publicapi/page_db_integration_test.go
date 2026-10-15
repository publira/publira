package publicapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/lib/pq"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Static pages are published through a version row rather than a flag, so what
// the storefront may serve is decided by the join between pages, their
// translations, and page_versions. Only a real database exercises that join.

func TestDBListPublishedPagesReturnsOnlyPublishedFooterPages(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:            "privacy",
		Title:           "Privacy Policy",
		ContentMarkdown: "# Privacy",
		Published:       true,
		DisplayInFooter: true,
	})
	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:      "about",
		Title:     "About Us",
		Published: true,
	})
	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:            "terms",
		Title:           "Terms (draft)",
		DisplayInFooter: true,
	})
	env.PG.SeedPage(t, second.ID, testutil.PageSeed{
		Slug:            "privacy",
		Title:           "Tenant B Privacy Policy",
		Published:       true,
		DisplayInFooter: true,
	})

	resp, err := env.pagesClient().ListPublishedPages(context.Background(), &publirav1.ListPublishedPagesRequest{
		Tenant: tenantContext(first),
	})
	if err != nil {
		t.Fatalf("ListPublishedPages: %v", err)
	}
	if len(resp.Pages) != 1 {
		titles := make([]string, 0, len(resp.Pages))
		for _, page := range resp.Pages {
			titles = append(titles, page.Title)
		}
		t.Fatalf("pages = %v, want only the published footer page of tenant A", titles)
	}
	if resp.Pages[0].Title != "Privacy Policy" {
		t.Fatalf("page title = %q, want Privacy Policy", resp.Pages[0].Title)
	}
}

func TestDBListPublishedPageSlugsReturnsEveryPublishedPageOfTheTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:            "privacy",
		Title:           "Privacy Policy",
		Published:       true,
		DisplayInFooter: true,
	})
	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:      "series",
		Title:     "About Our Series",
		Published: true,
	})
	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:            "terms",
		Title:           "Terms (draft)",
		DisplayInFooter: true,
	})
	// Stored past the admin API, which refuses a reserved slug.
	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:      "login",
		Title:     "Sign-in help",
		Published: true,
	})
	env.PG.SeedPage(t, second.ID, testutil.PageSeed{
		Slug:      "contact",
		Title:     "Tenant B Contact",
		Published: true,
	})

	resp, err := env.pagesClient().ListPublishedPageSlugs(context.Background(), &publirav1.ListPublishedPageSlugsRequest{
		Tenant: tenantContext(first),
	})
	if err != nil {
		t.Fatalf("ListPublishedPageSlugs: %v", err)
	}
	if got := strings.Join(resp.Slugs, ","); got != "/privacy,/series" {
		t.Fatalf("slugs = %q, want the published pages of tenant A, footer or not, less the reserved one", got)
	}
}

func TestDBGetPublishedPageServesTheStoredVersion(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{
		Slug:            "legal/terms",
		Title:           "Terms Of Service",
		ContentMarkdown: "# Terms\n\nThe stored body.",
		Published:       true,
	})

	client := env.pagesClient()
	// The storefront may ask with or without the leading slash, and with the
	// duplicated slashes a path join can produce.
	for _, slug := range []string{"legal/terms", "/legal/terms", "//legal//terms//"} {
		resp, err := client.GetPublishedPage(context.Background(), &publirav1.GetPublishedPageRequest{
			Tenant: tenantContext(tenant),
			Slug:   slug,
		})
		if err != nil {
			t.Fatalf("GetPublishedPage %q: %v", slug, err)
		}
		if resp.Page.Slug != "/legal/terms" {
			t.Fatalf("GetPublishedPage %q slug = %q, want /legal/terms", slug, resp.Page.Slug)
		}
		if resp.Version.ContentMarkdown != "# Terms\n\nThe stored body." {
			t.Fatalf("GetPublishedPage %q content = %q, want the stored body", slug, resp.Version.ContentMarkdown)
		}
	}
}

func TestDBGetPublishedPageHidesPagesThatAreNotPublishedYet(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	draft := env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "terms", Title: "Terms (draft)"})
	embargoed := env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:        "notice",
		Title:       "Notice",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})
	theirs := env.PG.SeedPage(t, second.ID, testutil.PageSeed{
		Slug:      "privacy",
		Title:     "Tenant B Privacy Policy",
		Published: true,
	})

	client := env.pagesClient()
	for _, slug := range []string{draft.Slug, embargoed.Slug, theirs.Slug} {
		_, err := client.GetPublishedPage(context.Background(), &publirav1.GetPublishedPageRequest{
			Tenant: tenantContext(first),
			Slug:   slug,
		})
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("GetPublishedPage %q code = %v, want not_found (err=%v)", slug, connect.CodeOf(err), err)
		}
	}
}

// A tenant that moves to a default locale none of a page's translations is in
// keeps serving the page, in the translation it already had.
func TestDBPublishedPagesSurviveADefaultLocaleChange(t *testing.T) {
	env := newPublicDBEnv(t)
	first, _ := env.seedTwoTenants(t)

	env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:            "privacy",
		Title:           "Privacy Policy",
		ContentMarkdown: "# Privacy",
		Published:       true,
		DisplayInFooter: true,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `UPDATE tenants SET default_locale = 'en' WHERE id = $1`, first.ID); err != nil {
		t.Fatalf("change default locale: %v", err)
	}

	list, err := env.pagesClient().ListPublishedPages(context.Background(), &publirav1.ListPublishedPagesRequest{
		Tenant: tenantContext(first),
	})
	if err != nil {
		t.Fatalf("ListPublishedPages: %v", err)
	}
	if len(list.Pages) != 1 || list.Pages[0].Title != "Privacy Policy" {
		t.Fatalf("pages = %v, want the privacy policy", list.Pages)
	}

	page, err := env.pagesClient().GetPublishedPage(context.Background(), &publirav1.GetPublishedPageRequest{
		Tenant: tenantContext(first),
		Slug:   "privacy",
	})
	if err != nil {
		t.Fatalf("GetPublishedPage: %v", err)
	}
	if page.Version.GetContentMarkdown() != "# Privacy" {
		t.Fatalf("content = %q, want # Privacy", page.Version.GetContentMarkdown())
	}
}

// A reader is served each page in their own locale where it has a published
// translation, and in the tenant's default locale otherwise, and every answer
// names the locale it was served in.
func TestDBPublishedPagesAreServedInTheReadersLocale(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	privacy := env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:            "privacy",
		Title:           "Privacy Policy (ja)",
		ContentMarkdown: "# Privacy (ja)",
		Published:       true,
		DisplayInFooter: true,
	})
	env.PG.SeedPageTranslation(t, first.ID, privacy.ID, testutil.PageTranslationSeed{
		Locale:          "en",
		Title:           "Privacy Policy",
		ContentMarkdown: "# Privacy",
		Published:       true,
	})
	terms := env.PG.SeedPage(t, first.ID, testutil.PageSeed{
		Slug:            "terms",
		Title:           "Terms (ja)",
		ContentMarkdown: "# Terms (ja)",
		Published:       true,
		DisplayInFooter: true,
	})
	// A draft is not an English version a reader can read yet.
	env.PG.SeedPageTranslation(t, first.ID, terms.ID, testutil.PageTranslationSeed{
		Locale:          "en",
		Title:           "Terms (draft)",
		ContentMarkdown: "# Terms (draft)",
	})
	theirs := env.PG.SeedPage(t, second.ID, testutil.PageSeed{
		Slug:            "privacy",
		Title:           "Tenant B Privacy Policy (ja)",
		Published:       true,
		DisplayInFooter: true,
	})
	env.PG.SeedPageTranslation(t, second.ID, theirs.ID, testutil.PageTranslationSeed{
		Locale:          "en",
		Title:           "Tenant B Privacy Policy",
		ContentMarkdown: "# Tenant B Privacy",
		Published:       true,
	})

	client := env.pagesClient()
	for _, tc := range []struct {
		locale string
		want   []string
	}{
		{locale: "en", want: []string{"en:Privacy Policy", "ja:Terms (ja)"}},
		{locale: "ja", want: []string{"ja:Privacy Policy (ja)", "ja:Terms (ja)"}},
		{locale: "", want: []string{"ja:Privacy Policy (ja)", "ja:Terms (ja)"}},
	} {
		list, err := client.ListPublishedPages(context.Background(), &publirav1.ListPublishedPagesRequest{
			Tenant: tenantContext(first),
			Locale: tc.locale,
		})
		if err != nil {
			t.Fatalf("ListPublishedPages %q: %v", tc.locale, err)
		}
		got := make([]string, 0, len(list.Pages))
		for _, page := range list.Pages {
			got = append(got, page.Locale+":"+page.Title)
		}
		if strings.Join(got, ",") != strings.Join(tc.want, ",") {
			t.Fatalf("ListPublishedPages %q = %v, want %v", tc.locale, got, tc.want)
		}
	}

	// The draft English terms is not an alternate either.
	for _, tc := range []struct {
		slug, locale, wantLocale, wantBody, wantAlternates string
	}{
		{slug: "privacy", locale: "en", wantLocale: "en", wantBody: "# Privacy", wantAlternates: "en,ja"},
		{slug: "privacy", locale: "ja", wantLocale: "ja", wantBody: "# Privacy (ja)", wantAlternates: "en,ja"},
		{slug: "terms", locale: "en", wantLocale: "ja", wantBody: "# Terms (ja)", wantAlternates: "ja"},
		{slug: "terms", locale: "", wantLocale: "ja", wantBody: "# Terms (ja)", wantAlternates: "ja"},
	} {
		page, err := client.GetPublishedPage(context.Background(), &publirav1.GetPublishedPageRequest{
			Tenant: tenantContext(first),
			Slug:   tc.slug,
			Locale: tc.locale,
		})
		if err != nil {
			t.Fatalf("GetPublishedPage %s %q: %v", tc.slug, tc.locale, err)
		}
		if page.Page.Locale != tc.wantLocale || page.Version.ContentMarkdown != tc.wantBody {
			t.Fatalf("GetPublishedPage %s %q = %s %q, want %s %q",
				tc.slug, tc.locale, page.Page.Locale, page.Version.ContentMarkdown, tc.wantLocale, tc.wantBody)
		}
		if got := strings.Join(page.PublishedLocales, ","); got != tc.wantAlternates {
			t.Fatalf("GetPublishedPage %s %q published_locales = %q, want %q", tc.slug, tc.locale, got, tc.wantAlternates)
		}
	}
}

// A page whose only published translation is not in the default locale is
// still a published page: it is routed, listed, and served in that translation
// on every locale.
func TestDBPageWithOnlyANonDefaultTranslationPublishedIsServed(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	page := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{
		Slug:            "notice",
		Title:           "Notice (ja draft)",
		DisplayInFooter: true,
	})
	env.PG.SeedPageTranslation(t, tenant.ID, page.ID, testutil.PageTranslationSeed{
		Locale:          "en",
		Title:           "Notice",
		ContentMarkdown: "# Notice",
		Published:       true,
	})

	client := env.pagesClient()
	slugs, err := client.ListPublishedPageSlugs(context.Background(), &publirav1.ListPublishedPageSlugsRequest{
		Tenant: tenantContext(tenant),
	})
	if err != nil {
		t.Fatalf("ListPublishedPageSlugs: %v", err)
	}
	if got := strings.Join(slugs.Slugs, ","); got != "/notice" {
		t.Fatalf("slugs = %q, want /notice", got)
	}

	list, err := client.ListPublishedPages(context.Background(), &publirav1.ListPublishedPagesRequest{
		Tenant: tenantContext(tenant),
		Locale: "ja",
	})
	if err != nil {
		t.Fatalf("ListPublishedPages: %v", err)
	}
	if len(list.Pages) != 1 || list.Pages[0].Locale != "en" || list.Pages[0].Title != "Notice" {
		t.Fatalf("pages = %v, want the en notice", list.Pages)
	}

	served, err := client.GetPublishedPage(context.Background(), &publirav1.GetPublishedPageRequest{
		Tenant: tenantContext(tenant),
		Slug:   "notice",
		Locale: "ja",
	})
	if err != nil {
		t.Fatalf("GetPublishedPage: %v", err)
	}
	if served.Page.Locale != "en" || served.Version.ContentMarkdown != "# Notice" {
		t.Fatalf("served = %s %q, want the en notice", served.Page.Locale, served.Version.ContentMarkdown)
	}
	if got := strings.Join(served.PublishedLocales, ","); got != "en" {
		t.Fatalf("published_locales = %q, want en alone", got)
	}
}

// A translation in a language the tenant does not offer is never served, nor
// named among the page's alternates. A page published only in such languages
// is off the site, and comes back as it was once one of them is offered again.
func TestDBPublishedPagesAreServedOnlyInOfferedLocales(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	notice := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{
		Slug:            "notice",
		Title:           "Notice (ja draft)",
		DisplayInFooter: true,
	})
	env.PG.SeedPageTranslation(t, tenant.ID, notice.ID, testutil.PageTranslationSeed{
		Locale:          "ko",
		Title:           "Notice (ko)",
		ContentMarkdown: "# Notice (ko)",
		Published:       true,
	})
	privacy := env.PG.SeedPage(t, tenant.ID, testutil.PageSeed{
		Slug:            "privacy",
		Title:           "Privacy Policy (ja)",
		ContentMarkdown: "# Privacy (ja)",
		Published:       true,
		DisplayInFooter: true,
	})
	env.PG.SeedPageTranslation(t, tenant.ID, privacy.ID, testutil.PageTranslationSeed{
		Locale:          "ko",
		Title:           "Privacy Policy (ko)",
		ContentMarkdown: "# Privacy (ko)",
		Published:       true,
	})

	offer := func(locales ...string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := env.PG.DB.ExecContext(ctx,
			`UPDATE tenants SET supported_locales = $2 WHERE id = $1`, tenant.ID, pq.Array(locales),
		); err != nil {
			t.Fatalf("offer %v: %v", locales, err)
		}
	}
	client := env.pagesClient()
	slugs := func() string {
		t.Helper()
		resp, err := client.ListPublishedPageSlugs(context.Background(), &publirav1.ListPublishedPageSlugsRequest{
			Tenant: tenantContext(tenant),
		})
		if err != nil {
			t.Fatalf("ListPublishedPageSlugs: %v", err)
		}
		return strings.Join(resp.Slugs, ",")
	}
	footer := func(locale string) string {
		t.Helper()
		resp, err := client.ListPublishedPages(context.Background(), &publirav1.ListPublishedPagesRequest{
			Tenant: tenantContext(tenant),
			Locale: locale,
		})
		if err != nil {
			t.Fatalf("ListPublishedPages %q: %v", locale, err)
		}
		got := make([]string, 0, len(resp.Pages))
		for _, page := range resp.Pages {
			got = append(got, page.Locale+":"+page.Title)
		}
		return strings.Join(got, ",")
	}
	sitemapPages := func() string {
		t.Helper()
		resp := listSitemapEntries(t, env, &publirav1.ListSitemapEntriesRequest{Tenant: tenantContext(tenant)})
		got := make([]string, 0, len(resp.Entries))
		for _, entry := range resp.Entries {
			if entry.Kind == publirav1.SitemapEntryKind_SITEMAP_ENTRY_KIND_PAGE {
				got = append(got, entry.Slug)
			}
		}
		return strings.Join(got, ",")
	}
	served := func(slug, locale string) (*publirav1.GetPublishedPageResponse, error) {
		t.Helper()
		return client.GetPublishedPage(context.Background(), &publirav1.GetPublishedPageRequest{
			Tenant: tenantContext(tenant),
			Slug:   slug,
			Locale: locale,
		})
	}

	offer("ja", "en")
	if got := slugs(); got != "/privacy" {
		t.Fatalf("slugs offering ja and en = %q, want /privacy alone", got)
	}
	if got := footer("en"); got != "ja:Privacy Policy (ja)" {
		t.Fatalf("footer for en offering ja and en = %q, want the ja privacy policy alone", got)
	}
	if got := sitemapPages(); got != "/privacy" {
		t.Fatalf("sitemap pages offering ja and en = %q, want /privacy alone", got)
	}
	for _, locale := range []string{"", "ja", "en", "ko"} {
		if _, err := served("notice", locale); connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("GetPublishedPage notice %q offering ja and en code = %v, want not_found (err=%v)", locale, connect.CodeOf(err), err)
		}
	}
	for _, locale := range []string{"en", "ko"} {
		page, err := served("privacy", locale)
		if err != nil {
			t.Fatalf("GetPublishedPage privacy %q offering ja and en: %v", locale, err)
		}
		if page.Page.Locale != "ja" || page.Version.ContentMarkdown != "# Privacy (ja)" {
			t.Fatalf("GetPublishedPage privacy %q offering ja and en = %s %q, want the ja one",
				locale, page.Page.Locale, page.Version.ContentMarkdown)
		}
		if got := strings.Join(page.PublishedLocales, ","); got != "ja" {
			t.Fatalf("GetPublishedPage privacy %q offering ja and en published_locales = %q, want ja alone", locale, got)
		}
	}

	offer("ja", "en", "ko")
	if got := slugs(); got != "/notice,/privacy" {
		t.Fatalf("slugs with ko offered again = %q, want /notice,/privacy", got)
	}
	if got := footer("ko"); got != "ko:Notice (ko),ko:Privacy Policy (ko)" {
		t.Fatalf("footer for ko with ko offered again = %q, want both pages in ko", got)
	}
	if got := sitemapPages(); got != "/notice,/privacy" {
		t.Fatalf("sitemap pages with ko offered again = %q, want /notice,/privacy", got)
	}
	notices, err := served("notice", "en")
	if err != nil {
		t.Fatalf("GetPublishedPage notice en with ko offered again: %v", err)
	}
	if notices.Page.Locale != "ko" || notices.Version.ContentMarkdown != "# Notice (ko)" {
		t.Fatalf("GetPublishedPage notice en with ko offered again = %s %q, want the ko one unchanged",
			notices.Page.Locale, notices.Version.ContentMarkdown)
	}
	privacies, err := served("privacy", "ko")
	if err != nil {
		t.Fatalf("GetPublishedPage privacy ko with ko offered again: %v", err)
	}
	if privacies.Page.Locale != "ko" || strings.Join(privacies.PublishedLocales, ",") != "ja,ko" {
		t.Fatalf("GetPublishedPage privacy ko with ko offered again = %s %v, want ko among ja,ko",
			privacies.Page.Locale, privacies.PublishedLocales)
	}
}
