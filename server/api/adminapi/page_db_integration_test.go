package adminapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
)

func (e *adminDBEnv) pagesClient() publiraadminv1connect.AdminPagesServiceClient {
	return publiraadminv1connect.NewAdminPagesServiceClient(e.Server.Client(), e.Server.URL)
}

func TestDBCreatePageDuplicateSlugReturnsAlreadyExists(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.pagesClient()

	if _, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/about",
		Title:  "About",
	})); err != nil {
		t.Fatalf("first CreatePage: %v", err)
	}

	// pages_tenant_id_slug_key is the only thing standing between these two rows;
	// the handler has no pre-check, so this is the constraint talking.
	_, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/about",
		Title:  "About Again",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("duplicate CreatePage code = %v, want already_exists (err=%v)", connect.CodeOf(err), err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "slug") {
		t.Fatalf("duplicate CreatePage error = %v, want a slug message", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM pages WHERE slug = $1", "/about"); count != 1 {
		t.Fatalf("pages with slug /about = %d, want 1", count)
	}
}

// A page is stored with its translation in the tenant's default locale, which
// is what the console edits and the storefront serves.
func TestDBCreatePageCreatesTheDefaultLocaleTranslation(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.pagesClient()

	page, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/about",
		Title:  "About",
	}))
	if err != nil {
		t.Fatalf("CreatePage: %v", err)
	}
	if page.Msg.Page.Title != "About" {
		t.Fatalf("title = %q, want About", page.Msg.Page.Title)
	}
	if count := env.countRows(t, `
		SELECT count(*)
		FROM page_translations pt
			JOIN tenants t ON t.id = pt.tenant_id
		WHERE pt.page_id = $1
			AND pt.locale = t.default_locale
			AND pt.title = 'About'
	`, page.Msg.Page.Id); count != 1 {
		t.Fatalf("default-locale translations titled About = %d, want 1", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM page_translations WHERE page_id = $1", page.Msg.Page.Id); count != 1 {
		t.Fatalf("translations = %d, want 1", count)
	}
}

// A tenant that moves to a default locale none of a page's translations is in
// can still find and edit the page, through the translation it already had.
func TestDBPageStaysEditableAfterADefaultLocaleChange(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.pagesClient()

	page, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/about",
		Title:  "About",
	}))
	if err != nil {
		t.Fatalf("CreatePage: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `UPDATE tenants SET default_locale = 'en' WHERE id = $1`, tenant.Tenant.ID); err != nil {
		t.Fatalf("change default locale: %v", err)
	}

	list, err := client.ListPages(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListPagesRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	if len(list.Msg.Pages) != 1 || list.Msg.Pages[0].Id != page.Msg.Page.Id {
		t.Fatalf("pages = %v, want the page created before the change", list.Msg.Pages)
	}

	updated, err := client.UpdatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdatePageRequest{
		Tenant: tenant.tenantContext(),
		PageId: page.Msg.Page.Id,
		Title:  "About Us",
	}))
	if err != nil {
		t.Fatalf("UpdatePage: %v", err)
	}
	if updated.Msg.Page.Title != "About Us" {
		t.Fatalf("title = %q, want About Us", updated.Msg.Page.Title)
	}
	if count := env.countRows(t, "SELECT count(*) FROM page_translations WHERE page_id = $1", page.Msg.Page.Id); count != 1 {
		t.Fatalf("translations = %d, want the one the page already had", count)
	}
}

func TestDBCreatePageAllowsSameSlugInAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.pagesClient()

	for _, tenant := range []adminDBTenant{first, second} {
		if _, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
			Tenant: tenant.tenantContext(),
			Slug:   "/about",
			Title:  "About",
		})); err != nil {
			t.Fatalf("CreatePage for %s: %v", tenant.Tenant.PublicID, err)
		}
	}

	// Uniqueness is per tenant, and each tenant still sees only its own page.
	listed, err := client.ListPages(context.Background(), newAdminDBRequest(first, &publiraadminv1.ListPagesRequest{
		Tenant: first.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	if len(listed.Msg.Pages) != 1 {
		t.Fatalf("tenant A page count = %d, want 1", len(listed.Msg.Pages))
	}
	if count := env.countRows(t, "SELECT count(*) FROM pages WHERE slug = $1", "/about"); count != 2 {
		t.Fatalf("pages with slug /about = %d, want 2 (one per tenant)", count)
	}
}

func TestDBGetPageOfAnotherTenantReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.pagesClient()

	theirs, err := client.CreatePage(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreatePageRequest{
		Tenant: second.tenantContext(),
		Slug:   "/tenant-b",
		Title:  "Tenant B Page",
	}))
	if err != nil {
		t.Fatalf("CreatePage for tenant B: %v", err)
	}

	_, err = client.GetPage(context.Background(), newAdminDBRequest(first, &publiraadminv1.GetPageRequest{
		Tenant: first.tenantContext(),
		PageId: theirs.Msg.Page.Id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetPage across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBCreatePageRequiresTenantEditor(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor)
	auditor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER03", "auditor@tenant-a.example.com", "Tenant A Auditor", auth.RoleTenantAuditor)
	client := env.pagesClient()

	_, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant.as(auditor), &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/auditor-page",
		Title:  "Auditor Page",
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreatePage as auditor code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM pages"); count != 0 {
		t.Fatalf("page rows after an auditor's attempt = %d, want 0", count)
	}

	if _, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant.as(editor), &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/editor-page",
		Title:  "Editor Page",
	})); err != nil {
		t.Fatalf("CreatePage as editor: %v", err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM pages"); count != 1 {
		t.Fatalf("page rows after an editor's page = %d, want 1", count)
	}
}

func TestDBPublishPageVersionUpdatesPublishedVersion(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.pagesClient()

	page, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/terms",
		Title:  "Terms",
	}))
	if err != nil {
		t.Fatalf("CreatePage: %v", err)
	}
	pageID := page.Msg.Page.Id

	version, err := client.CreateVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateVersionRequest{
		Tenant:          tenant.tenantContext(),
		PageId:          pageID,
		ContentMarkdown: "# Terms\n\nFirst revision.",
	}))
	if err != nil {
		t.Fatalf("CreateVersion: %v", err)
	}
	if version.Msg.Version.VersionNumber != 1 {
		t.Fatalf("version_number = %d, want 1", version.Msg.Version.VersionNumber)
	}

	published, err := client.PublishVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.PublishVersionRequest{
		Tenant:    tenant.tenantContext(),
		PageId:    pageID,
		VersionId: version.Msg.Version.Id,
	}))
	if err != nil {
		t.Fatalf("PublishVersion: %v", err)
	}
	if published.Msg.Version.Status != "published" {
		t.Fatalf("version status = %q, want published", published.Msg.Version.Status)
	}

	reloaded, err := client.GetPage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetPageRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
	}))
	if err != nil {
		t.Fatalf("GetPage: %v", err)
	}
	if reloaded.Msg.Page.PublishedVersionId != version.Msg.Version.Id {
		t.Fatalf("published_version_id = %q, want %q", reloaded.Msg.Page.PublishedVersionId, version.Msg.Version.Id)
	}
}

func TestDBUnpublishPageClearsPublishedVersionAndKeepsVersions(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.pagesClient()

	page, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/privacy",
		Title:  "Privacy",
	}))
	if err != nil {
		t.Fatalf("CreatePage: %v", err)
	}
	pageID := page.Msg.Page.Id

	version, err := client.CreateVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateVersionRequest{
		Tenant:          tenant.tenantContext(),
		PageId:          pageID,
		ContentMarkdown: "# Privacy\n\nOnly revision.",
	}))
	if err != nil {
		t.Fatalf("CreateVersion: %v", err)
	}
	versionID := version.Msg.Version.Id

	if _, err := client.PublishVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.PublishVersionRequest{
		Tenant:    tenant.tenantContext(),
		PageId:    pageID,
		VersionId: versionID,
	})); err != nil {
		t.Fatalf("PublishVersion: %v", err)
	}

	unpublished, err := client.UnpublishPage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UnpublishPageRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
	}))
	if err != nil {
		t.Fatalf("UnpublishPage: %v", err)
	}
	if unpublished.Msg.Page.PublishedVersionId != "" {
		t.Fatalf("published_version_id = %q, want empty", unpublished.Msg.Page.PublishedVersionId)
	}

	versions, err := client.ListVersions(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListVersionsRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
	}))
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	if len(versions.Msg.Versions) != 1 || versions.Msg.Versions[0].Id != versionID {
		t.Fatalf("versions = %v, want the published one kept", versions.Msg.Versions)
	}

	// The same version goes back up: nothing about the body had to be re-entered.
	if _, err := client.PublishVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.PublishVersionRequest{
		Tenant:    tenant.tenantContext(),
		PageId:    pageID,
		VersionId: versionID,
	})); err != nil {
		t.Fatalf("PublishVersion after unpublish: %v", err)
	}
	reloaded, err := client.GetPage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetPageRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
	}))
	if err != nil {
		t.Fatalf("GetPage: %v", err)
	}
	if reloaded.Msg.Page.PublishedVersionId != versionID {
		t.Fatalf("published_version_id = %q, want %q", reloaded.Msg.Page.PublishedVersionId, versionID)
	}
}

func TestDBUnpublishAnotherTenantsPageReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.pagesClient()

	theirs, err := client.CreatePage(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreatePageRequest{
		Tenant: second.tenantContext(),
		Slug:   "/tenant-b",
		Title:  "Tenant B Page",
	}))
	if err != nil {
		t.Fatalf("CreatePage for tenant B: %v", err)
	}

	_, err = client.UnpublishPage(context.Background(), newAdminDBRequest(first, &publiraadminv1.UnpublishPageRequest{
		Tenant: first.tenantContext(),
		PageId: theirs.Msg.Page.Id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UnpublishPage across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBCreateVersionForAnotherTenantsPageReturnsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.pagesClient()

	theirs, err := client.CreatePage(context.Background(), newAdminDBRequest(second, &publiraadminv1.CreatePageRequest{
		Tenant: second.tenantContext(),
		Slug:   "/tenant-b",
		Title:  "Tenant B Page",
	}))
	if err != nil {
		t.Fatalf("CreatePage for tenant B: %v", err)
	}

	_, err = client.CreateVersion(context.Background(), newAdminDBRequest(first, &publiraadminv1.CreateVersionRequest{
		Tenant:          first.tenantContext(),
		PageId:          theirs.Msg.Page.Id,
		ContentMarkdown: "Injected content",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("CreateVersion across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM page_versions"); count != 0 {
		t.Fatalf("page_versions rows = %d, want 0", count)
	}
}

// Rolling back copies the chosen version's body into a new draft numbered after
// the latest one, and leaves the live version where it was.
func TestDBRollbackToVersionCreatesADraftFromTheTarget(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.pagesClient()

	page, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/terms",
		Title:  "Terms",
	}))
	if err != nil {
		t.Fatalf("CreatePage: %v", err)
	}
	pageID := page.Msg.Page.Id

	var versionIDs []string
	for _, body := range []string{"# Terms\n\nFirst revision.", "# Terms\n\nSecond revision."} {
		version, err := client.CreateVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateVersionRequest{
			Tenant:          tenant.tenantContext(),
			PageId:          pageID,
			ContentMarkdown: body,
		}))
		if err != nil {
			t.Fatalf("CreateVersion: %v", err)
		}
		versionIDs = append(versionIDs, version.Msg.Version.Id)
	}
	if _, err := client.PublishVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.PublishVersionRequest{
		Tenant:    tenant.tenantContext(),
		PageId:    pageID,
		VersionId: versionIDs[1],
	})); err != nil {
		t.Fatalf("PublishVersion: %v", err)
	}

	rolledBack, err := client.RollbackToVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.RollbackToVersionRequest{
		Tenant:    tenant.tenantContext(),
		PageId:    pageID,
		VersionId: versionIDs[0],
	}))
	if err != nil {
		t.Fatalf("RollbackToVersion: %v", err)
	}
	version := rolledBack.Msg.Version
	if version.VersionNumber != 3 {
		t.Fatalf("version_number = %d, want 3", version.VersionNumber)
	}
	if version.ContentMarkdown != "# Terms\n\nFirst revision." {
		t.Fatalf("content_markdown = %q, want the first revision", version.ContentMarkdown)
	}
	if version.Status != "draft" {
		t.Fatalf("status = %q, want draft", version.Status)
	}

	reloaded, err := client.GetPage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetPageRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
	}))
	if err != nil {
		t.Fatalf("GetPage: %v", err)
	}
	if reloaded.Msg.Page.PublishedVersionId != versionIDs[1] {
		t.Fatalf("published_version_id = %q, want the second revision still live", reloaded.Msg.Page.PublishedVersionId)
	}
}

// adminPageWithEnglish creates a page, whose translation is in the tenant's
// default locale ja, and adds an English translation to it.
func adminPageWithEnglish(t *testing.T, env *adminDBEnv, tenant adminDBTenant) string {
	t.Helper()
	client := env.pagesClient()
	page, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/privacy",
		Title:  "Privacy (ja)",
	}))
	if err != nil {
		t.Fatalf("CreatePage: %v", err)
	}
	if _, err := client.CreatePageTranslation(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageTranslationRequest{
		Tenant: tenant.tenantContext(),
		PageId: page.Msg.Page.Id,
		Locale: "en",
		Title:  "Privacy",
	})); err != nil {
		t.Fatalf("CreatePageTranslation: %v", err)
	}
	return page.Msg.Page.Id
}

func TestDBCreatePageTranslationAddsALocale(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.pagesClient()
	pageID := adminPageWithEnglish(t, env, tenant)

	list, err := client.ListPageTranslations(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListPageTranslationsRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
	}))
	if err != nil {
		t.Fatalf("ListPageTranslations: %v", err)
	}
	got := make([]string, 0, len(list.Msg.Translations))
	for _, translation := range list.Msg.Translations {
		got = append(got, translation.Locale+":"+translation.Title)
	}
	if strings.Join(got, ",") != "ja:Privacy (ja),en:Privacy" {
		t.Fatalf("translations = %v, want ja then en", got)
	}

	for _, tc := range []struct {
		name, locale string
		want         connect.Code
	}{
		{name: "existing locale", locale: "en", want: connect.CodeAlreadyExists},
		{name: "unsupported locale", locale: "xx", want: connect.CodeInvalidArgument},
		{name: "blank locale", locale: " ", want: connect.CodeInvalidArgument},
	} {
		_, err := client.CreatePageTranslation(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageTranslationRequest{
			Tenant: tenant.tenantContext(),
			PageId: pageID,
			Locale: tc.locale,
			Title:  "Again",
		}))
		if connect.CodeOf(err) != tc.want {
			t.Fatalf("%s: code = %v, want %v (err=%v)", tc.name, connect.CodeOf(err), tc.want, err)
		}
	}
}

// Each translation keeps its own title, history, and live version: working on
// one locale never changes what another serves.
func TestDBPageTranslationsAreEditedAndPublishedIndependently(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.pagesClient()
	pageID := adminPageWithEnglish(t, env, tenant)

	if _, err := client.UpdatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdatePageRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
		Locale: "en",
		Title:  "Privacy Policy",
	})); err != nil {
		t.Fatalf("UpdatePage en: %v", err)
	}

	versions := map[string]string{}
	for _, locale := range []string{"ja", "en"} {
		version, err := client.CreateVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateVersionRequest{
			Tenant:          tenant.tenantContext(),
			PageId:          pageID,
			Locale:          locale,
			ContentMarkdown: "# Privacy " + locale,
		}))
		if err != nil {
			t.Fatalf("CreateVersion %s: %v", locale, err)
		}
		if version.Msg.Version.VersionNumber != 1 {
			t.Fatalf("%s version_number = %d, want 1: each translation numbers its own history", locale, version.Msg.Version.VersionNumber)
		}
		versions[locale] = version.Msg.Version.Id
	}

	// A version of one translation cannot be published as another's.
	_, err := client.PublishVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.PublishVersionRequest{
		Tenant:    tenant.tenantContext(),
		PageId:    pageID,
		Locale:    "ja",
		VersionId: versions["en"],
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("PublishVersion of en's version as ja: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := client.PublishVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.PublishVersionRequest{
		Tenant:    tenant.tenantContext(),
		PageId:    pageID,
		Locale:    "en",
		VersionId: versions["en"],
	})); err != nil {
		t.Fatalf("PublishVersion en: %v", err)
	}

	for _, tc := range []struct {
		locale, wantTitle, wantPublished string
	}{
		{locale: "ja", wantTitle: "Privacy (ja)", wantPublished: ""},
		{locale: "", wantTitle: "Privacy (ja)", wantPublished: ""},
		{locale: "en", wantTitle: "Privacy Policy", wantPublished: versions["en"]},
	} {
		page, err := client.GetPage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetPageRequest{
			Tenant: tenant.tenantContext(),
			PageId: pageID,
			Locale: tc.locale,
		}))
		if err != nil {
			t.Fatalf("GetPage %q: %v", tc.locale, err)
		}
		if page.Msg.Page.Title != tc.wantTitle || page.Msg.Page.PublishedVersionId != tc.wantPublished {
			t.Fatalf("GetPage %q = %q published %q, want %q published %q",
				tc.locale, page.Msg.Page.Title, page.Msg.Page.PublishedVersionId, tc.wantTitle, tc.wantPublished)
		}
	}

	rolledBack, err := client.RollbackToVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.RollbackToVersionRequest{
		Tenant:    tenant.tenantContext(),
		PageId:    pageID,
		Locale:    "en",
		VersionId: versions["en"],
	}))
	if err != nil {
		t.Fatalf("RollbackToVersion en: %v", err)
	}
	if rolledBack.Msg.Version.VersionNumber != 2 || rolledBack.Msg.Version.ContentMarkdown != "# Privacy en" {
		t.Fatalf("rolled back = %d %q, want en's version 2 carrying its body",
			rolledBack.Msg.Version.VersionNumber, rolledBack.Msg.Version.ContentMarkdown)
	}

	jaVersions, err := client.ListVersions(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListVersionsRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
		Locale: "ja",
	}))
	if err != nil {
		t.Fatalf("ListVersions ja: %v", err)
	}
	if len(jaVersions.Msg.Versions) != 1 || jaVersions.Msg.Versions[0].Id != versions["ja"] {
		t.Fatalf("ja versions = %v, want only ja's own", jaVersions.Msg.Versions)
	}

	unpublished, err := client.UnpublishPage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UnpublishPageRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
		Locale: "en",
	}))
	if err != nil {
		t.Fatalf("UnpublishPage en: %v", err)
	}
	if unpublished.Msg.Page.Locale != "en" || unpublished.Msg.Page.PublishedVersionId != "" {
		t.Fatalf("unpublished = %s published %q, want en with nothing live", unpublished.Msg.Page.Locale, unpublished.Msg.Page.PublishedVersionId)
	}
}

// A locale the page has no translation in is not found rather than quietly
// edited through the default-locale translation.
func TestDBPageContentInAMissingLocaleIsNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.pagesClient()

	page, err := client.CreatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/about",
		Title:  "About",
	}))
	if err != nil {
		t.Fatalf("CreatePage: %v", err)
	}

	_, err = client.CreateVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateVersionRequest{
		Tenant:          tenant.tenantContext(),
		PageId:          page.Msg.Page.Id,
		Locale:          "en",
		ContentMarkdown: "# About",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("CreateVersion en: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.UpdatePage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdatePageRequest{
		Tenant: tenant.tenantContext(),
		PageId: page.Msg.Page.Id,
		Locale: "en",
		Title:  "About",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdatePage en: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.GetPage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetPageRequest{
		Tenant: tenant.tenantContext(),
		PageId: page.Msg.Page.Id,
		Locale: "xx",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("GetPage xx: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM page_versions"); count != 0 {
		t.Fatalf("page_versions rows = %d, want 0", count)
	}
}

func TestDBDeletePageTranslationKeepsTheLastOne(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.pagesClient()
	pageID := adminPageWithEnglish(t, env, tenant)

	if _, err := client.CreateVersion(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateVersionRequest{
		Tenant:          tenant.tenantContext(),
		PageId:          pageID,
		Locale:          "en",
		ContentMarkdown: "# Privacy",
	})); err != nil {
		t.Fatalf("CreateVersion en: %v", err)
	}

	// The default locale's translation may go too: the page falls back to its
	// oldest remaining one.
	if _, err := client.DeletePageTranslation(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeletePageTranslationRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
		Locale: "ja",
	})); err != nil {
		t.Fatalf("DeletePageTranslation ja: %v", err)
	}
	page, err := client.GetPage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetPageRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
	}))
	if err != nil {
		t.Fatalf("GetPage: %v", err)
	}
	if page.Msg.Page.Locale != "en" {
		t.Fatalf("page locale = %q, want the remaining en", page.Msg.Page.Locale)
	}

	_, err = client.DeletePageTranslation(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeletePageTranslationRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
		Locale: "en",
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeletePageTranslation of the last one: code = %v, want failed_precondition (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM page_versions WHERE page_id = $1", pageID); count != 1 {
		t.Fatalf("page_versions = %d, want en's one kept", count)
	}

	_, err = client.DeletePageTranslation(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeletePageTranslationRequest{
		Tenant: tenant.tenantContext(),
		PageId: pageID,
		Locale: "ko",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeletePageTranslation of a missing locale: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBPageTranslationsOfAnotherTenantAreNotFound(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.pagesClient()
	theirs := adminPageWithEnglish(t, env, second)

	_, err := client.CreatePageTranslation(context.Background(), newAdminDBRequest(first, &publiraadminv1.CreatePageTranslationRequest{
		Tenant: first.tenantContext(),
		PageId: theirs,
		Locale: "ko",
		Title:  "Injected",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("CreatePageTranslation across tenants: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.ListPageTranslations(context.Background(), newAdminDBRequest(first, &publiraadminv1.ListPageTranslationsRequest{
		Tenant: first.tenantContext(),
		PageId: theirs,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ListPageTranslations across tenants: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.GetPage(context.Background(), newAdminDBRequest(first, &publiraadminv1.GetPageRequest{
		Tenant: first.tenantContext(),
		PageId: theirs,
		Locale: "en",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetPage en across tenants: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	_, err = client.DeletePageTranslation(context.Background(), newAdminDBRequest(first, &publiraadminv1.DeletePageTranslationRequest{
		Tenant: first.tenantContext(),
		PageId: theirs,
		Locale: "en",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeletePageTranslation across tenants: code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM page_translations WHERE page_id = $1", theirs); count != 2 {
		t.Fatalf("tenant B translations = %d, want both kept", count)
	}
}
