package publicapi

import (
	"context"
	"errors"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
)

func TestPagesListPublishedPagesSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	pageID := uuid.Must(uuid.NewV7())
	versionID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedPagesForTenant)).
		WithArgs("en", tenantID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "slug", "display_in_footer", "created_at", "updated_at",
			"id", "page_id", "tenant_id", "locale", "title", "published_version_id", "created_at", "updated_at",
		}).AddRow(
			pageID, tenantID, "/privacy", true, now, now,
			uuid.Must(uuid.NewV7()), pageID, tenantID, "ja", "Privacy Policy", versionID, now, now,
		))

	client := publirav1connect.NewPublicPagesServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedPages(context.Background(), connect.NewRequest(&publirav1.ListPublishedPagesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Locale: "en",
	}))
	if err != nil {
		t.Fatalf("ListPublishedPages: %v", err)
	}

	if len(resp.Msg.Pages) != 1 {
		t.Fatalf("pages count = %d, want 1", len(resp.Msg.Pages))
	}
	if resp.Msg.Pages[0].Slug != "/privacy" {
		t.Fatalf("page slug = %q, want /privacy", resp.Msg.Pages[0].Slug)
	}
	if resp.Msg.Pages[0].PublishedVersionId != versionID.String() {
		t.Fatalf("published version id = %q, want %q", resp.Msg.Pages[0].PublishedVersionId, versionID.String())
	}
	if !resp.Msg.Pages[0].DisplayInFooter {
		t.Fatalf("display_in_footer = false, want true")
	}
	// The page has no English translation, so it is listed in the one served.
	if resp.Msg.Pages[0].Locale != "ja" {
		t.Fatalf("locale = %q, want the served ja", resp.Msg.Pages[0].Locale)
	}

	assertPublicExpectations(t, mock)
}

// A page stored under a reserved path before the admin API refused one is left
// out, so the public site never serves it over a sign-in or settings screen.
func TestPagesListPublishedPageSlugsSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPublishedPageSlugsForTenant)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"slug"}).
			AddRow("/legal/terms").
			AddRow("/login").
			AddRow("/series"))

	client := publirav1connect.NewPublicPagesServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedPageSlugs(context.Background(), connect.NewRequest(&publirav1.ListPublishedPageSlugsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListPublishedPageSlugs: %v", err)
	}

	if got := strings.Join(resp.Msg.Slugs, ","); got != "/legal/terms,/series" {
		t.Fatalf("slugs = %q, want /legal/terms,/series", got)
	}

	assertPublicExpectations(t, mock)
}

func TestPagesGetPublishedPageSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	pageID := uuid.Must(uuid.NewV7())
	versionID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	// The translation was retitled after the page itself last changed.
	retitledAt := now.Add(time.Hour)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// Lookup normalizes client slug "privacy" → "/privacy" to match admin storage.
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedPageBySlugForTenant)).
		WithArgs("ja", tenantID, "/privacy").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "slug", "locale", "title", "published_version_id", "display_in_footer", "created_at", "updated_at", "translation_updated_at",
			"version_id", "page_id", "version_number", "content_markdown", "author_user_id", "status", "publish_at", "version_created_at", "published_at",
		}).AddRow(
			pageID, tenantID, "/privacy", "ja", "Privacy Policy", versionID, true, now, now, retitledAt,
			versionID, pageID, int32(2), "# Privacy", nil, "published", nil, now, now,
		))

	client := publirav1connect.NewPublicPagesServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.GetPublishedPage(context.Background(), connect.NewRequest(&publirav1.GetPublishedPageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Slug:   "privacy",
	}))
	if err != nil {
		t.Fatalf("GetPublishedPage: %v", err)
	}
	if resp.Msg.Page == nil || resp.Msg.Page.Slug != "/privacy" {
		t.Fatalf("page = %+v, want slug /privacy", resp.Msg.Page)
	}
	if resp.Msg.Version == nil || resp.Msg.Version.ContentMarkdown != "# Privacy" {
		t.Fatalf("version = %+v, want markdown", resp.Msg.Version)
	}
	if want := retitledAt.Format("2006-01-02T15:04:05Z07:00"); resp.Msg.Page.UpdatedAt != want {
		t.Fatalf("updated_at = %q, want the translation's %q", resp.Msg.Page.UpdatedAt, want)
	}
	if resp.Msg.Page.Locale != "ja" {
		t.Fatalf("locale = %q, want ja", resp.Msg.Page.Locale)
	}

	assertPublicExpectations(t, mock)
}

func TestPagesGetPublishedPageValidationAndNotFound(t *testing.T) {
	t.Run("empty-slug", func(t *testing.T) {
		// Validation fails before tenant lookup when slug is empty.
		testServer, _ := newTestPublicServer(t)
		client := publirav1connect.NewPublicPagesServiceClient(testServer.Client(), testServer.URL)

		_, err := client.GetPublishedPage(context.Background(), connect.NewRequest(&publirav1.GetPublishedPageRequest{
			Tenant: &publirattypesv1.TenantContext{TenantId: "00000000-0000-7000-8000-000000000001"},
			Slug:   " ",
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
		}
	})

	t.Run("unsupported-locale", func(t *testing.T) {
		testServer, mock := newTestPublicServer(t)

		tenantID := uuid.Must(uuid.NewV7())
		expectTenantLookup(mock, tenantID, "TENANT", time.Now().UTC())

		client := publirav1connect.NewPublicPagesServiceClient(testServer.Client(), testServer.URL)
		_, err := client.GetPublishedPage(context.Background(), connect.NewRequest(&publirav1.GetPublishedPageRequest{
			Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			Slug:   "privacy",
			Locale: "xx",
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
		}
		assertPublicExpectations(t, mock)
	})

	t.Run("not-found", func(t *testing.T) {
		testServer, mock := newTestPublicServer(t)

		tenantID := uuid.Must(uuid.NewV7())
		now := time.Now().UTC()
		expectTenantLookup(mock, tenantID, "TENANT", now)
		mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedPageBySlugForTenant)).
			WithArgs("ja", tenantID, "/missing").
			WillReturnRows(sqlmock.NewRows([]string{
				"id", "tenant_id", "slug", "locale", "title", "published_version_id", "display_in_footer", "created_at", "updated_at", "translation_updated_at",
				"version_id", "page_id", "version_number", "content_markdown", "author_user_id", "status", "publish_at", "version_created_at", "published_at",
			}))

		client := publirav1connect.NewPublicPagesServiceClient(testServer.Client(), testServer.URL)
		_, err := client.GetPublishedPage(context.Background(), connect.NewRequest(&publirav1.GetPublishedPageRequest{
			Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
			Slug:   "missing",
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
		}
		assertPublicExpectations(t, mock)
	})
}

func TestPagesGetPublishedPageDatabaseErrorIsHidden(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedPageBySlugForTenant)).
		WithArgs("ja", tenantID, "/privacy").
		WillReturnError(errors.New(`pq: relation "pages" does not exist`))

	client := publirav1connect.NewPublicPagesServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedPage(context.Background(), connect.NewRequest(&publirav1.GetPublishedPageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Slug:   "privacy",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetPublishedPage code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertPublicExpectations(t, mock)
}

func TestPagesGetPublishedPagePreservesContextCanceled(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()
	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPublishedPageBySlugForTenant)).
		WithArgs("ja", tenantID, "/privacy").
		WillReturnError(context.Canceled)

	client := publirav1connect.NewPublicPagesServiceClient(testServer.Client(), testServer.URL)
	_, err := client.GetPublishedPage(context.Background(), connect.NewRequest(&publirav1.GetPublishedPageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Slug:   "privacy",
	}))
	if connect.CodeOf(err) != connect.CodeCanceled {
		t.Fatalf("GetPublishedPage code = %v, want %v", connect.CodeOf(err), connect.CodeCanceled)
	}
	assertPublicExpectations(t, mock)
}

// Which translations count as published is published_page_translation_for's
// to decide, so every public read goes through it rather than restating it.
func TestPagesPublishedQueriesHavePublicationGuards(t *testing.T) {
	for name, query := range map[string]string{
		"ListPublishedPagesForTenant":     dbmodels.ListPublishedPagesForTenant,
		"ListPublishedPageSlugsForTenant": dbmodels.ListPublishedPageSlugsForTenant,
		"GetPublishedPageBySlugForTenant": dbmodels.GetPublishedPageBySlugForTenant,
	} {
		if !strings.Contains(query, "published_page_translation_for(") {
			t.Fatalf("dbmodels.%s does not choose its translation with published_page_translation_for", name)
		}
	}
	if !strings.Contains(dbmodels.ListPublishedPagesForTenant, "p.display_in_footer = true") {
		t.Fatalf("dbmodels.ListPublishedPagesForTenant must filter display_in_footer")
	}
	if strings.Contains(dbmodels.ListPublishedPageSlugsForTenant, "display_in_footer") {
		t.Fatalf("dbmodels.ListPublishedPageSlugsForTenant must not filter display_in_footer")
	}
}
