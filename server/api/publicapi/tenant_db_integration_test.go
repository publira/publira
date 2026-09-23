package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
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
		INSERT INTO tenant_config (tenant_id, copyright_text, site_description, site_tagline)
		VALUES ($1, $2, $3, $4)
	`, tenant.ID, copyright, description, tagline); err != nil {
		t.Fatalf("insert tenant_config for %s: %v", tenant.PublicID, err)
	}
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO tenant_themes (tenant_id, primary_color)
		VALUES ($1, $2)
	`, tenant.ID, primaryColor); err != nil {
		t.Fatalf("insert tenant_themes for %s: %v", tenant.PublicID, err)
	}
}

func TestDBGetTenantReturnsItsOwnBranding(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	seedTenantBranding(t, env, first, "© Tenant A", "Tenant A description", "Tenant A tagline", "#111111")
	seedTenantBranding(t, env, second, "© Tenant B", "Tenant B description", "Tenant B tagline", "#222222")

	resp, err := env.tenantAPIClient().GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: tenantContext(first),
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	if resp.Msg.TenantPublicId != first.PublicID || resp.Msg.TenantDomain != first.Domain {
		t.Fatalf("tenant = %s/%s, want %s/%s", resp.Msg.TenantPublicId, resp.Msg.TenantDomain, first.PublicID, first.Domain)
	}
	if resp.Msg.CopyrightText != "© Tenant A" {
		t.Fatalf("copyright_text = %q, want the row of tenant A", resp.Msg.CopyrightText)
	}
	if resp.Msg.SiteDescription != "Tenant A description" || resp.Msg.SiteTagline != "Tenant A tagline" {
		t.Fatalf("site text = %q / %q, want the rows of tenant A", resp.Msg.SiteDescription, resp.Msg.SiteTagline)
	}
	if resp.Msg.Theme == nil || resp.Msg.Theme.PrimaryColor != "#111111" {
		t.Fatalf("theme = %+v, want the primary color of tenant A", resp.Msg.Theme)
	}
	if resp.Msg.Timezone != tenanttz.Default {
		t.Fatalf("timezone = %q, want the column default %q", resp.Msg.Timezone, tenanttz.Default)
	}
	if resp.Msg.DefaultLocale != first.DefaultLocale {
		t.Fatalf("default_locale = %q, want the stored value %q", resp.Msg.DefaultLocale, first.DefaultLocale)
	}
}

func TestDBGetTenantRejectsAnUnknownTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_, err := env.tenantAPIClient().GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: uuid.Must(uuid.NewV7()).String()},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetTenant for an unknown tenant code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

// Domain resolution is the one public RPC that runs without a tenant context,
// because it is what produces one. It therefore also runs without
// app.current_tenant_id set on the connection.
func TestDBGetTenantByDomainResolvesTheFirstMatchingHost(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	client := env.domainClient()

	resp, err := client.GetTenantByDomain(context.Background(), connect.NewRequest(&publirav1.GetTenantByDomainRequest{
		Domains: []string{"unknown.example.com", second.Domain, first.Domain},
	}))
	if err != nil {
		t.Fatalf("GetTenantByDomain: %v", err)
	}
	if resp.Msg.TenantId != second.ID.String() {
		t.Fatalf("tenant_id = %q, want tenant B (%s), the first candidate that matches", resp.Msg.TenantId, second.ID)
	}
	if resp.Msg.DefaultLocale != second.DefaultLocale {
		t.Fatalf("default_locale = %q, want the stored value %q of the matched tenant", resp.Msg.DefaultLocale, second.DefaultLocale)
	}

	_, err = client.GetTenantByDomain(context.Background(), connect.NewRequest(&publirav1.GetTenantByDomainRequest{
		Domains: []string{"nobody.example.com"},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetTenantByDomain for an unknown host code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func getDBTenant(t *testing.T, env *publicDBEnv, tenant testutil.Tenant) *publirav1.GetTenantResponse {
	t.Helper()

	resp, err := env.tenantAPIClient().GetTenant(context.Background(), connect.NewRequest(&publirav1.GetTenantRequest{
		Tenant: tenantContext(tenant),
	}))
	if err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	return resp.Msg
}

// The storefront links the terms and privacy pages a tenant names, and only
// while they are published: a tenant that named none, and one whose named page
// is unpublished, gets nothing to link to.
func TestDBGetTenantReportsItsPublishedLegalPages(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	seedTenantBranding(t, env, first, "© Tenant A", "", "", "#111111")
	seedTenantBranding(t, env, second, "© Tenant B", "", "", "#222222")
	terms := env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "tos", Title: "Terms of Service", Published: true})
	privacy := env.PG.SeedPage(t, first.ID, testutil.PageSeed{Slug: "privacy", Title: "Privacy Policy", Published: true})

	if got := getDBTenant(t, env, first); got.TermsPage != nil || got.PrivacyPage != nil {
		t.Fatalf("legal pages before naming any = %v / %v, want none", got.TermsPage, got.PrivacyPage)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := env.PG.DB.ExecContext(ctx, `
		UPDATE tenant_config SET terms_page_id = $2, privacy_page_id = $3 WHERE tenant_id = $1
	`, first.ID, terms.ID, privacy.ID); err != nil {
		t.Fatalf("name legal pages: %v", err)
	}

	got := getDBTenant(t, env, first)
	if got.TermsPage.GetSlug() != "/tos" || got.TermsPage.GetTitle() != "Terms of Service" ||
		got.TermsPage.GetVersionId() != terms.VersionID.String() {
		t.Fatalf("terms_page = %v, want /tos titled Terms of Service at version %s", got.TermsPage, terms.VersionID)
	}
	if got.PrivacyPage.GetSlug() != "/privacy" || got.PrivacyPage.GetTitle() != "Privacy Policy" ||
		got.PrivacyPage.GetVersionId() != privacy.VersionID.String() {
		t.Fatalf("privacy_page = %v, want /privacy titled Privacy Policy at version %s", got.PrivacyPage, privacy.VersionID)
	}
	if other := getDBTenant(t, env, second); other.TermsPage != nil || other.PrivacyPage != nil {
		t.Fatalf("tenant B legal pages = %v / %v, want none", other.TermsPage, other.PrivacyPage)
	}

	if _, err := env.PG.DB.ExecContext(ctx, "UPDATE pages SET published_version_id = NULL WHERE id = $1", terms.ID); err != nil {
		t.Fatalf("unpublish terms: %v", err)
	}
	got = getDBTenant(t, env, first)
	if got.TermsPage != nil {
		t.Fatalf("terms_page after unpublishing it = %v, want none", got.TermsPage)
	}
	if got.PrivacyPage.GetSlug() != "/privacy" {
		t.Fatalf("privacy_page after unpublishing terms = %v, want /privacy", got.PrivacyPage)
	}
}
