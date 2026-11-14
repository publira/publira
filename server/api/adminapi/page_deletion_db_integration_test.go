package adminapi

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

// pageDeletionFixture is a tenant with an admin, a reader, and a counter for
// the slugs the pages a test seeds need.
type pageDeletionFixture struct {
	env    *adminDBEnv
	admin  adminDBTenant
	reader testutil.TenantUser
	next   int
}

func newPageDeletionFixture(t *testing.T, env *adminDBEnv) *pageDeletionFixture {
	t.Helper()

	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	return &pageDeletionFixture{
		env:    env,
		admin:  admin,
		reader: env.PG.SeedEndUser(t, admin.Tenant.ID, "READER01", "reader@example.com", "Reader"),
	}
}

func (f *pageDeletionFixture) page(t *testing.T, title string, published bool) testutil.Page {
	t.Helper()
	f.next++
	return f.env.PG.SeedPage(t, f.admin.Tenant.ID, testutil.PageSeed{
		Slug:      fmt.Sprintf("page-%d", f.next),
		Title:     title,
		Published: published,
	})
}

// otherLocale answers a supported locale that is not the tenant's default, for
// a second translation of a page.
func (f *pageDeletionFixture) otherLocale(t *testing.T) string {
	t.Helper()
	if f.admin.Tenant.DefaultLocale == "en" {
		return "ja"
	}
	return "en"
}

func (f *pageDeletionFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.env.PG.DB.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

// nameLegalPage makes the page the tenant's terms of service or its privacy
// policy, as UpdateTenantLegalPages does.
func (f *pageDeletionFixture) nameLegalPage(t *testing.T, column string, page testutil.Page) {
	t.Helper()
	f.exec(t, fmt.Sprintf(`INSERT INTO tenant_config (tenant_id, %[1]s) VALUES ($1, $2)
		ON CONFLICT (tenant_id) DO UPDATE SET %[1]s = EXCLUDED.%[1]s`, column), f.admin.Tenant.ID, page.ID)
}

// agree records the reader's agreement to the page's first version. The
// version is marked published, as one a reader agrees to always is, but no
// translation serves it any more and no setting names the page, as for a page
// that was the terms of service once.
func (f *pageDeletionFixture) agree(t *testing.T, page testutil.Page) {
	t.Helper()
	f.exec(t, "UPDATE page_versions SET status = 'published', published_at = now() WHERE id = $1", page.VersionID)
	f.exec(t, "INSERT INTO user_page_consents (tenant_id, user_id, page_version_id) VALUES ($1, $2, $3)",
		f.admin.Tenant.ID, f.reader.ID, page.VersionID)
}

func (f *pageDeletionFixture) delete(as adminDBTenant, page testutil.Page) error {
	_, err := f.env.pagesClient().DeletePage(testutil.WithBearer(context.Background(), as.token()), &publiraadminv1.DeletePageRequest{
		Tenant: as.tenantContext(),
		PageId: page.ID.String(),
	})
	return err
}

// An unpublished page no setting names and no reader agreed to goes with every
// translation and every version, leaves the storefront's cached pages owing a
// refresh, and is named in the audit log by its title and its slug. Another
// page stays as it was.
func TestDBDeletePageTakesItsTranslationsAndVersions(t *testing.T) {
	f := newPageDeletionFixture(t, newReaderIconDBEnv(t))
	tenantID := f.admin.Tenant.ID
	page := f.page(t, "Old campaign", false)
	kept := f.page(t, "About", true)

	// A second translation, and a version once published and taken down
	// since, which is what an unpublished page usually has.
	f.env.PG.SeedPageTranslation(t, tenantID, page.ID, testutil.PageTranslationSeed{Locale: f.otherLocale(t), Title: "Translated campaign"})
	f.exec(t, `INSERT INTO page_versions (id, tenant_id, page_id, translation_id, version_number, content_markdown, status, published_at)
		VALUES ($1, $2, $3, $4, 2, 'Body', 'published', now())`, uuid.Must(uuid.NewV7()), tenantID, page.ID, page.TranslationID)

	if err := f.delete(f.admin, page); err != nil {
		t.Fatalf("DeletePage: %v", err)
	}

	for _, table := range []string{"pages WHERE id = $1", "page_translations WHERE page_id = $1", "page_versions WHERE page_id = $1"} {
		if got := f.env.countRows(t, "SELECT count(*) FROM "+table, page.ID); got != 0 {
			t.Errorf("rows left in %s = %d, want 0", table, got)
		}
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM pages WHERE slug = $1 AND tenant_id = $2", page.Slug, tenantID); got != 0 {
		t.Errorf("pages left at the slug %s = %d, want 0", page.Slug, got)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM page_versions WHERE page_id = $1", kept.ID); got != 1 {
		t.Errorf("the other page's versions = %d, want 1", got)
	}

	tags := f.env.revalidatedTags(t, f.admin.Tenant)
	for _, want := range []string{fmt.Sprintf("tenant:%s:pages", tenantID), fmt.Sprintf("tenant:%s:pages:%s", tenantID, page.ID)} {
		if !slices.Contains(tags, want) {
			t.Errorf("cache tags recorded = %v, want %s among them", tags, want)
		}
	}
	if got := f.env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'page_deleted' AND target_type = 'page' AND target_id = $2 AND reason = $3",
		tenantID, page.ID.String(), "Old campaign ("+page.Slug+")",
	); got != 1 {
		t.Errorf("audit entries naming the deletion = %d, want 1", got)
	}

	// A request delivered again finds nothing to delete.
	if err := f.delete(f.admin, page); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeletePage again = %v, want not_found", err)
	}
}

// A page that has to be kept stays, and the refusal names the first reason in
// the order the RPC documents.
func TestDBDeletePageRefusesAPageThatHasToBeKept(t *testing.T) {
	t.Parallel()

	f := newPageDeletionFixture(t, newAdminDBEnv(t))
	tenantID := f.admin.Tenant.ID

	cases := []struct {
		name      string
		published bool
		seed      func(t *testing.T, page testutil.Page)
		want      string
	}{
		{"a published translation in the default locale", true, func(*testing.T, testutil.Page) {}, rpcerrors.ReasonPagePublished},
		{"a published translation in another locale alone", false, func(t *testing.T, page testutil.Page) {
			f.env.PG.SeedPageTranslation(t, tenantID, page.ID, testutil.PageTranslationSeed{Locale: f.otherLocale(t), Title: "Translated", Published: true})
		}, rpcerrors.ReasonPagePublished},
		{"the terms of service setting", false, func(t *testing.T, page testutil.Page) {
			f.nameLegalPage(t, "terms_page_id", page)
		}, rpcerrors.ReasonPageIsLegalPage},
		{"the privacy policy setting", false, func(t *testing.T, page testutil.Page) {
			f.nameLegalPage(t, "privacy_page_id", page)
		}, rpcerrors.ReasonPageIsLegalPage},
		{"a reader's agreement", false, f.agree, rpcerrors.ReasonPageAgreedTo},
		{"a setting and a publication", true, func(t *testing.T, page testutil.Page) {
			f.nameLegalPage(t, "terms_page_id", page)
		}, rpcerrors.ReasonPagePublished},
		{"an agreement and a setting", false, func(t *testing.T, page testutil.Page) {
			f.agree(t, page)
			f.nameLegalPage(t, "privacy_page_id", page)
		}, rpcerrors.ReasonPageIsLegalPage},
	}
	for _, tc := range cases {
		page := f.page(t, "Page with "+tc.name, tc.published)
		tc.seed(t, page)

		err := f.delete(f.admin, page)
		if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != tc.want {
			t.Errorf("DeletePage of a page with %s = %v (reason %q), want failed_precondition %s", tc.name, err, reason, tc.want)
		}
		if got := f.env.countRows(t, "SELECT count(*) FROM page_versions WHERE page_id = $1", page.ID); got == 0 {
			t.Errorf("the page with %s lost its versions", tc.name)
		}
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'page_deleted'", tenantID); got != 0 {
		t.Errorf("audit entries for refused deletions = %d, want 0", got)
	}

	// An Editor may not delete even a page nothing keeps.
	editor := f.env.PG.SeedTenantUser(t, tenantID, "TAEDITOR1", "editor@tenant-a.example.com", "Editor", "tenant_editor")
	unused := f.page(t, "Unused page", false)
	if err := f.delete(f.admin.as(editor), unused); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("DeletePage as an Editor = %v, want permission_denied", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM pages WHERE id = $1", unused.ID); got != 1 {
		t.Fatalf("an Editor's request deleted the page")
	}

	// Another tenant's page is not one this tenant can name.
	other := f.env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBADMIN01", "admin@tenant-b.example.com")
	foreign := f.env.PG.SeedPage(t, other.Tenant.ID, testutil.PageSeed{Slug: "draft", Title: "Draft B"})
	if err := f.delete(f.admin, foreign); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeletePage of another tenant's page = %v, want not_found", err)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM pages WHERE id = $1", foreign.ID); got != 1 {
		t.Fatalf("another tenant's page is gone")
	}
}

// An agreement written while the page is being deleted either fails on its
// foreign key or lands first, and then the deletion waits for it and refuses:
// the deletion never answers from before the agreement committed.
func TestDBDeletePageWaitsForAnAgreementBeingWritten(t *testing.T) {
	t.Parallel()

	f := newPageDeletionFixture(t, newAdminDBEnv(t))
	page := f.page(t, "Page raced by an agreement", false)
	f.exec(t, "UPDATE page_versions SET status = 'published', published_at = now() WHERE id = $1", page.VersionID)

	ctx := context.Background()
	tx, err := f.env.PG.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	// The insert takes a key share lock on the version row through its
	// foreign key, as every agreement does.
	if _, err := tx.ExecContext(ctx, "INSERT INTO user_page_consents (tenant_id, user_id, page_version_id) VALUES ($1, $2, $3)",
		f.admin.Tenant.ID, f.reader.ID, page.VersionID); err != nil {
		t.Fatalf("agree to the page: %v", err)
	}

	deleted := make(chan error, 1)
	go func() { deleted <- f.delete(f.admin, page) }()

	select {
	case err := <-deleted:
		t.Fatalf("DeletePage did not wait for the agreement being written: %v", err)
	case <-time.After(500 * time.Millisecond):
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	err = <-deleted
	if reason := errorInfoReason(t, err); connect.CodeOf(err) != connect.CodeFailedPrecondition || reason != rpcerrors.ReasonPageAgreedTo {
		t.Fatalf("DeletePage of a page agreed to meanwhile = %v (reason %q), want failed_precondition %s", err, reason, rpcerrors.ReasonPageAgreedTo)
	}
	if got := f.env.countRows(t, "SELECT count(*) FROM user_page_consents WHERE page_version_id = $1", page.VersionID); got != 1 {
		t.Fatalf("agreements to the page = %d, want 1", got)
	}
}
