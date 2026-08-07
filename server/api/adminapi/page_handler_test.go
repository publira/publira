package adminapi

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
)

const updatePageQuery = "-- name: UpdatePage :one\nUPDATE pages\nSET title = $1,\n\tdisplay_in_footer = COALESCE($2, display_in_footer),\n\tupdated_at = NOW()\nWHERE id = $3 AND tenant_id = $4\nRETURNING id, tenant_id, slug, title, published_version_id, display_in_footer, created_at, updated_at\n"

func pageColumns() []string {
	return []string{
		"id", "tenant_id", "slug", "title", "published_version_id", "display_in_footer", "created_at", "updated_at",
	}
}

// Title-only UpdatePage must not pass a false display_in_footer (proto3 default)
// and must preserve the existing true value via COALESCE(NULL, display_in_footer).
func TestUpdatePageTitleOnlyPreservesDisplayInFooter(t *testing.T) {
	ts, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	pageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	// Omitted optional field → sql.NullBool{Valid: false} → driver nil arg.
	mock.ExpectQuery(regexp.QuoteMeta(updatePageQuery)).
		WithArgs("更新後タイトル", nil, pageID, tenantID).
		WillReturnRows(sqlmock.NewRows(pageColumns()).
			AddRow(pageID, tenantID, "/privacy", "更新後タイトル", uuid.NullUUID{}, true, now, now))
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminPagesServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpdatePageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PageId: pageID.String(),
		Title:  "更新後タイトル",
		// DisplayInFooter intentionally omitted
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.UpdatePage(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdatePage: %v", err)
	}
	if resp.Msg.Page == nil {
		t.Fatalf("page is nil")
	}
	if resp.Msg.Page.Title != "更新後タイトル" {
		t.Fatalf("title = %q, want 更新後タイトル", resp.Msg.Page.Title)
	}
	if !resp.Msg.Page.DisplayInFooter {
		t.Fatalf("display_in_footer = false, want true (preserved on title-only update)")
	}
	assertExpectations(t, mock)
}

func TestUpdatePageSetsDisplayInFooterWhenPresent(t *testing.T) {
	ts, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	pageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta(updatePageQuery)).
		WithArgs("タイトル", sql.NullBool{Bool: false, Valid: true}, pageID, tenantID).
		WillReturnRows(sqlmock.NewRows(pageColumns()).
			AddRow(pageID, tenantID, "/privacy", "タイトル", uuid.NullUUID{}, false, now, now))
	expectAdminAuditLogInsert(mock)

	displayInFooter := false
	client := publiraadminv1connect.NewAdminPagesServiceClient(ts.Client(), ts.URL)
	req := connect.NewRequest(&publiraadminv1.UpdatePageRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PageId:          pageID.String(),
		Title:           "タイトル",
		DisplayInFooter: &displayInFooter,
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.UpdatePage(context.Background(), req)
	if err != nil {
		t.Fatalf("UpdatePage: %v", err)
	}
	if resp.Msg.Page == nil {
		t.Fatalf("page is nil")
	}
	if resp.Msg.Page.DisplayInFooter {
		t.Fatalf("display_in_footer = true, want false")
	}
	assertExpectations(t, mock)
}
