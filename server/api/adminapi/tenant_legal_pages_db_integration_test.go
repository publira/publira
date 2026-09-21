package adminapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

// createDBPage creates a page with one version and publishes it unless told
// not to, answering the page's id.
func createDBPage(t *testing.T, env *adminDBEnv, tenant adminDBTenant, slug, title string, publish bool) string {
	t.Helper()

	client := env.pagesClient()
	ctx := context.Background()
	page, err := client.CreatePage(ctx, newAdminDBRequest(tenant, &publiraadminv1.CreatePageRequest{
		Tenant: tenant.tenantContext(),
		Slug:   slug,
		Title:  title,
	}))
	if err != nil {
		t.Fatalf("CreatePage(%s): %v", slug, err)
	}
	pageID := page.Msg.Page.Id
	version, err := client.CreateVersion(ctx, newAdminDBRequest(tenant, &publiraadminv1.CreateVersionRequest{
		Tenant:          tenant.tenantContext(),
		PageId:          pageID,
		ContentMarkdown: "# " + title,
	}))
	if err != nil {
		t.Fatalf("CreateVersion(%s): %v", slug, err)
	}
	if publish {
		if _, err := client.PublishVersion(ctx, newAdminDBRequest(tenant, &publiraadminv1.PublishVersionRequest{
			Tenant:    tenant.tenantContext(),
			PageId:    pageID,
			VersionId: version.Msg.Version.Id,
		})); err != nil {
			t.Fatalf("PublishVersion(%s): %v", slug, err)
		}
	}
	return pageID
}

func getDBTenantLegalPages(t *testing.T, env *adminDBEnv, tenant adminDBTenant) *publiraadminv1.TenantLegalPages {
	t.Helper()

	resp, err := env.tenantSettingsClient().GetTenantLegalPages(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetTenantLegalPagesRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("GetTenantLegalPages: %v", err)
	}
	return resp.Msg.Pages
}

func updateDBTenantLegalPages(env *adminDBEnv, tenant adminDBTenant, termsPageID, privacyPageID string) (*publiraadminv1.TenantLegalPages, error) {
	resp, err := env.tenantSettingsClient().UpdateTenantLegalPages(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateTenantLegalPagesRequest{
		Tenant:        tenant.tenantContext(),
		TermsPageId:   termsPageID,
		PrivacyPageId: privacyPageID,
	}))
	if err != nil {
		return nil, err
	}
	return resp.Msg.Pages, nil
}

func assertLegalPage(t *testing.T, role string, got *publiraadminv1.TenantLegalPage, wantID, wantSlug string, wantPublished bool) {
	t.Helper()

	if got == nil {
		t.Fatalf("%s page = nil, want %s", role, wantSlug)
	}
	if got.PageId != wantID || got.Slug != wantSlug || got.Published != wantPublished {
		t.Fatalf("%s page = %v, want id %s, slug %s, published %t", role, got, wantID, wantSlug, wantPublished)
	}
}

// A tenant that has named nothing reads as naming nothing; published pages can
// be named and cleared, and an unpublished one stays named but is reported as
// unpublished.
func TestDBTenantLegalPagesAreNominatedReportedAndCleared(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	pagesClient := env.pagesClient()

	if got := getDBTenantLegalPages(t, env, tenant); got.TermsPage != nil || got.PrivacyPage != nil {
		t.Fatalf("initial legal pages = %v, want none", got)
	}

	termsID := createDBPage(t, env, tenant, "tos", "Terms of Service", true)
	privacyID := createDBPage(t, env, tenant, "privacy", "Privacy Policy", true)

	saved, err := updateDBTenantLegalPages(env, tenant, termsID, " "+privacyID+" ")
	if err != nil {
		t.Fatalf("UpdateTenantLegalPages: %v", err)
	}
	assertLegalPage(t, "terms", saved.TermsPage, termsID, "/tos", true)
	assertLegalPage(t, "privacy", saved.PrivacyPage, privacyID, "/privacy", true)
	if saved.TermsPage.Title != "Terms of Service" {
		t.Fatalf("terms title = %q, want Terms of Service", saved.TermsPage.Title)
	}

	if _, err := pagesClient.UnpublishPage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UnpublishPageRequest{
		Tenant: tenant.tenantContext(),
		PageId: termsID,
	})); err != nil {
		t.Fatalf("UnpublishPage: %v", err)
	}
	read := getDBTenantLegalPages(t, env, tenant)
	assertLegalPage(t, "terms after unpublishing it", read.TermsPage, termsID, "/tos", false)
	assertLegalPage(t, "privacy after unpublishing terms", read.PrivacyPage, privacyID, "/privacy", true)

	// Saving the privacy page again keeps the unpublished terms page named,
	// since it was already named for that role.
	kept, err := updateDBTenantLegalPages(env, tenant, termsID, privacyID)
	if err != nil {
		t.Fatalf("UpdateTenantLegalPages keeping an unpublished page: %v", err)
	}
	assertLegalPage(t, "kept terms", kept.TermsPage, termsID, "/tos", false)

	cleared, err := updateDBTenantLegalPages(env, tenant, "", privacyID)
	if err != nil {
		t.Fatalf("UpdateTenantLegalPages clearing terms: %v", err)
	}
	if cleared.TermsPage != nil {
		t.Fatalf("terms page after clearing = %v, want none", cleared.TermsPage)
	}
	assertLegalPage(t, "privacy after clearing terms", cleared.PrivacyPage, privacyID, "/privacy", true)
}

// Only a published page of the tenant's own can be named, and a refused save
// leaves what was stored alone.
func TestDBTenantLegalPagesRefuseAPageThatCannotBeNamed(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	privacyID := createDBPage(t, env, first, "privacy", "Privacy Policy", true)
	draftID := createDBPage(t, env, first, "draft", "Draft Terms", false)
	otherTenantsID := createDBPage(t, env, second, "tos", "Terms of Service", true)
	if _, err := updateDBTenantLegalPages(env, first, "", privacyID); err != nil {
		t.Fatalf("UpdateTenantLegalPages: %v", err)
	}

	for name, termsPageID := range map[string]string{
		"an unpublished page":      draftID,
		"another tenant's page":    otherTenantsID,
		"an id that is not a uuid": "not-a-page",
	} {
		_, err := updateDBTenantLegalPages(env, first, termsPageID, privacyID)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("naming %s: code = %v, want invalid_argument (err=%v)", name, connect.CodeOf(err), err)
		}
	}
	// The privacy page named for its own role is not a free pass for the other.
	if _, err := updateDBTenantLegalPages(env, first, "", draftID); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("naming an unpublished privacy page: code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}

	read := getDBTenantLegalPages(t, env, first)
	if read.TermsPage != nil {
		t.Fatalf("terms page after refused saves = %v, want none", read.TermsPage)
	}
	assertLegalPage(t, "privacy after refused saves", read.PrivacyPage, privacyID, "/privacy", true)
}

// Deleting a named page clears the nomination rather than leaving a reference
// to a row that is gone.
func TestDBTenantLegalPagesForgetADeletedPage(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	termsID := createDBPage(t, env, tenant, "tos", "Terms of Service", true)
	privacyID := createDBPage(t, env, tenant, "privacy", "Privacy Policy", true)
	if _, err := updateDBTenantLegalPages(env, tenant, termsID, privacyID); err != nil {
		t.Fatalf("UpdateTenantLegalPages: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, "DELETE FROM pages WHERE id = $1", termsID); err != nil {
		t.Fatalf("delete page: %v", err)
	}

	read := getDBTenantLegalPages(t, env, tenant)
	if read.TermsPage != nil {
		t.Fatalf("terms page after deleting it = %v, want none", read.TermsPage)
	}
	assertLegalPage(t, "privacy after deleting terms", read.PrivacyPage, privacyID, "/privacy", true)
	if count := env.countRows(t, "SELECT count(*) FROM tenant_config WHERE tenant_id = $1", tenant.Tenant.ID); count != 1 {
		t.Fatalf("tenant_config rows = %d, want the row kept", count)
	}
}

func TestDBUpdateTenantLegalPagesRequiresTenantAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	termsID := createDBPage(t, env, tenant, "tos", "Terms of Service", true)
	editor := env.PG.SeedTenantUser(t, tenant.Tenant.ID, "TAUSER02", "editor@tenant-a.example.com", "Tenant A Editor", auth.RoleTenantEditor)

	_, err := updateDBTenantLegalPages(env, tenant.as(editor), termsID, "")
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
	if got := getDBTenantLegalPages(t, env, tenant); got.TermsPage != nil {
		t.Fatalf("terms page after a refused save = %v, want none", got.TermsPage)
	}
}
