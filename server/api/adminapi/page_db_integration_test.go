package adminapi

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	"github.com/publira/publira/server/internal/auth"
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
