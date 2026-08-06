package publicapi

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
)

func TestPagesListPublishedPagesSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	pageID := uuid.Must(uuid.NewV7())
	versionID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	mock.ExpectQuery(regexp.QuoteMeta(listPublishedPagesForTenantQuery)).
		WithArgs(tenantID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "slug", "title", "published_version_id", "created_at", "updated_at"}).
			AddRow(pageID, tenantID, "/privacy", "プライバシーポリシー", versionID, now, now))

	client := publirav1connect.NewPublicPagesServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListPublishedPages(context.Background(), connect.NewRequest(&publirav1.ListPublishedPagesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
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

	assertPublicExpectations(t, mock)
}

func TestPagesGetPublishedPageSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	pageID := uuid.Must(uuid.NewV7())
	versionID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	// Lookup normalizes client slug "privacy" → "/privacy" to match admin storage.
	mock.ExpectQuery(regexp.QuoteMeta(getPublishedPageBySlugQuery)).
		WithArgs(tenantID, "/privacy").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "slug", "title", "published_version_id", "created_at", "updated_at",
			"version_id", "page_id", "version_number", "content_markdown", "author_user_id", "status", "publish_at", "version_created_at", "published_at",
		}).AddRow(
			pageID, tenantID, "/privacy", "プライバシーポリシー", versionID, now, now,
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

	t.Run("not-found", func(t *testing.T) {
		testServer, mock := newTestPublicServer(t)

		tenantID := uuid.Must(uuid.NewV7())
		now := time.Now().UTC()
		expectTenantLookup(mock, tenantID, "TENANT", now)
		mock.ExpectQuery(regexp.QuoteMeta(getPublishedPageBySlugQuery)).
			WithArgs(tenantID, "/missing").
			WillReturnRows(sqlmock.NewRows([]string{
				"id", "tenant_id", "slug", "title", "published_version_id", "created_at", "updated_at",
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

func TestPagesPublishedQueriesHavePublicationGuards(t *testing.T) {
	required := []string{
		"pv.status = 'published'",
		"pv.published_at IS NOT NULL",
		"pv.published_at <= NOW()",
	}
	for _, snippet := range required {
		if !strings.Contains(listPublishedPagesForTenantQuery, snippet) {
			t.Fatalf("listPublishedPagesForTenantQuery does not contain %q", snippet)
		}
		if !strings.Contains(getPublishedPageBySlugQuery, snippet) {
			t.Fatalf("getPublishedPageBySlugQuery does not contain %q", snippet)
		}
	}
}
