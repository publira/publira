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

func TestDBCreatePageRequiresTenantAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor)

	_, err := env.pagesClient().CreatePage(context.Background(), newAdminDBRequest(tenant.as(editor), &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   "/editor-page",
		Title:  "Editor Page",
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreatePage as editor code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM pages"); count != 0 {
		t.Fatalf("page rows = %d, want 0", count)
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
