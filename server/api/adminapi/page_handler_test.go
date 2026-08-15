package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	listPagesForTenantAscQuery  = "-- name: ListPagesForTenantAsc :many\n"
	listPagesForTenantDescQuery = "-- name: ListPagesForTenantDesc :many\n"
	getPageByIDForTenantQuery   = "-- name: GetPageByIDForTenant :one\n"
	updatePageQuery             = "-- name: UpdatePage :one\nUPDATE pages\nSET title = $1,\n\tdisplay_in_footer = COALESCE($2, display_in_footer),\n\tupdated_at = NOW()\nWHERE id = $3 AND tenant_id = $4\nRETURNING id, tenant_id, slug, title, published_version_id, display_in_footer, created_at, updated_at\n"
)

func pageColumns() []string {
	return []string{
		"id", "tenant_id", "slug", "title", "published_version_id", "display_in_footer", "created_at", "updated_at",
	}
}

func pageRows() *sqlmock.Rows {
	return sqlmock.NewRows(pageColumns())
}

func addPageRow(rows *sqlmock.Rows, id, tenantID uuid.UUID, slug, title string, createdAt time.Time) *sqlmock.Rows {
	return rows.AddRow(id, tenantID, slug, title, uuid.NullUUID{}, false, createdAt, createdAt)
}

func newPageClient(
	t *testing.T,
	tenantID, userID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminPagesServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "tenant_admin")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, "tenant_admin")
	return publiraadminv1connect.NewAdminPagesServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newListPagesRequest(tenantID uuid.UUID, sessionToken string) *connect.Request[publiraadminv1.ListPagesRequest] {
	req := connect.NewRequest(&publiraadminv1.ListPagesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func TestCreatePageInvalidSlugIncludesFieldViolation(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

	req := connect.NewRequest(&publiraadminv1.CreatePageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Slug:   "not_a_slug",
		Title:  "Invalid slug",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.CreatePage(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreatePage code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertBadRequestField(t, err, "slug")
	assertExpectations(t, mock)
}

func TestListPagesFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(listPagesForTenantAscQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addPageRow(
			addPageRow(
				addPageRow(pageRows(), ids[0], tenantID, "/first", "First", now),
				ids[1], tenantID, "/second", "Second", now.Add(time.Minute),
			),
			ids[2], tenantID, "/third", "Third", now.Add(2*time.Minute),
		))

	req := newListPagesRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	resp, err := client.ListPages(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	if len(resp.Msg.Pages) != 2 {
		t.Fatalf("pages count = %d, want the over-fetched row dropped", len(resp.Msg.Pages))
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantKeys := []string{now.Add(time.Minute).Format(time.RFC3339Nano), ids[1].String()}
	if cursor.Direction != pagination.Forward || !slices.Equal(cursor.Keys, wantKeys) {
		t.Fatalf("next_token = %+v, want forward keys %v", cursor, wantKeys)
	}
	assertExpectations(t, mock)
}

func TestListPagesFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listPagesForTenantAscQuery)).
		WithArgs(tenantID, boundaryID, false, now, int32(3)).
		WillReturnRows(addPageRow(pageRows(), uuid.Must(uuid.NewV7()), tenantID, "/last", "Last", now.Add(time.Minute)))

	req := newListPagesRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.EncodeTimeUUID(pagination.Forward, now, boundaryID)
	resp, err := client.ListPages(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the previous page")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListPagesFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)
	newerID := uuid.Must(uuid.NewV7())
	olderID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(listPagesForTenantDescQuery)).
		WithArgs(tenantID, boundaryID, false, now, int32(3)).
		WillReturnRows(addPageRow(
			addPageRow(pageRows(), newerID, tenantID, "/newer", "Newer", now.Add(-time.Minute)),
			olderID, tenantID, "/older", "Older", now.Add(-2*time.Minute),
		))

	req := newListPagesRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.EncodeTimeUUID(pagination.Backward, now, boundaryID)
	resp, err := client.ListPages(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	slugs := make([]string, 0, len(resp.Msg.Pages))
	for _, page := range resp.Msg.Pages {
		slugs = append(slugs, page.Slug)
	}
	if !slices.Equal(slugs, []string{"/older", "/newer"}) {
		t.Fatalf("slugs = %v, want backward page restored to ascending order", slugs)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertExpectations(t, mock)
}

func TestListPagesEmptyPageKeepsAWayBack(t *testing.T) {
	tests := []struct {
		name              string
		direction         pagination.Direction
		wantQuery         string
		recoveryDirection pagination.Direction
	}{
		{name: "forward", direction: pagination.Forward, wantQuery: listPagesForTenantAscQuery, recoveryDirection: pagination.Backward},
		{name: "backward", direction: pagination.Backward, wantQuery: listPagesForTenantDescQuery, recoveryDirection: pagination.Forward},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, false, now, int32(21)).
				WillReturnRows(pageRows())

			req := newListPagesRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.EncodeTimeUUID(test.direction, now, boundaryID)
			resp, err := client.ListPages(context.Background(), req)
			if err != nil {
				t.Fatalf("ListPages: %v", err)
			}
			recoveryToken := resp.Msg.PreviousToken
			if test.direction == pagination.Backward {
				recoveryToken = resp.Msg.NextToken
			}
			want := pagination.EncodeTimeUUIDRecovery(test.recoveryDirection, now, boundaryID)
			if recoveryToken != want {
				t.Fatalf("recovery token = %q, want %q", recoveryToken, want)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestListPagesEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listPagesForTenantDescQuery)).
		WithArgs(tenantID, boundaryID, true, now, int32(21)).
		WillReturnRows(pageRows())

	req := newListPagesRequest(tenantID, sessionToken)
	req.Msg.Token = pagination.EncodeTimeUUIDRecovery(pagination.Backward, now, boundaryID)
	resp, err := client.ListPages(context.Background(), req)
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty after one recovery", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListPagesInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)
	req := newListPagesRequest(tenantID, sessionToken)
	req.Msg.Token = "not-a-valid-token"

	_, err := client.ListPages(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListPages code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("error = %q, want token internals hidden", err)
	}
	assertExpectations(t, mock)
}

func TestListPagesDatabaseErrorIsHidden(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listPagesForTenantAscQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnError(errors.New(`pq: relation "tenant_pages" does not exist`))

	_, err := client.ListPages(context.Background(), newListPagesRequest(tenantID, sessionToken))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListPages code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}

func TestGetPageDatabaseErrorIsHidden(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	pageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(getPageByIDForTenantQuery)).
		WithArgs(pageID, tenantID).
		WillReturnError(errors.New(`pq: relation "pages" does not exist`))

	req := connect.NewRequest(&publiraadminv1.GetPageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PageId: pageID.String(),
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.GetPage(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("GetPage code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
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
