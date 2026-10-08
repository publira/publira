package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/testutil"
)

func pageOnlyColumns() []string {
	return []string{"id", "tenant_id", "slug", "display_in_footer", "created_at", "updated_at"}
}

func pageTranslationColumns() []string {
	return []string{"id", "page_id", "tenant_id", "locale", "title", "published_version_id", "created_at", "updated_at"}
}

// pageRows answers a query that reads a page together with its translation.
func pageRows() *sqlmock.Rows {
	return sqlmock.NewRows(append(pageOnlyColumns(), pageTranslationColumns()...))
}

func addPageRow(rows *sqlmock.Rows, id, tenantID uuid.UUID, slug, title string, createdAt time.Time) *sqlmock.Rows {
	return rows.AddRow(
		id, tenantID, slug, false, createdAt, createdAt,
		uuid.Must(uuid.NewV7()), id, tenantID, "ja", title, uuid.NullUUID{}, createdAt, createdAt,
	)
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
	return publiraadminv1connect.NewAdminPagesServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL))), mock, sessionToken
}

func newListPagesRequest(tenantID uuid.UUID) *publiraadminv1.ListPagesRequest {
	req := &publiraadminv1.ListPagesRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	return req
}

func TestCreatePageInvalidSlugIncludesFieldViolation(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

	req := &publiraadminv1.CreatePageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Slug:   "not_a_slug",
		Title:  "Invalid slug",
	}

	_, err := client.CreatePage(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreatePage code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertBadRequestField(t, err, "slug")
	assertExpectations(t, mock)
}

func TestCreatePageRefusesASlugThatTakesOverTheSignInScreen(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

	req := &publiraadminv1.CreatePageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Slug:   "/login",
		Title:  "Sign in help",
	}

	_, err := client.CreatePage(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreatePage code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertBadRequestField(t, err, "slug")
	if reason := badRequestReason(t, err); reason != rpcerrors.FieldReasonPageSlugReserved {
		t.Fatalf("reason = %q, want %q", reason, rpcerrors.FieldReasonPageSlugReserved)
	}
	assertExpectations(t, mock)
}

func TestCreatePageRefusesASlugTheSiteAnswersBeforePages(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

	req := &publiraadminv1.CreatePageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Slug:   "/ja",
		Title:  "Japanese",
	}

	_, err := client.CreatePage(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreatePage code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertBadRequestField(t, err, "slug")
	if reason := badRequestReason(t, err); reason != rpcerrors.FieldReasonPageSlugUnreachable {
		t.Fatalf("reason = %q, want %q", reason, rpcerrors.FieldReasonPageSlugUnreachable)
	}
	assertExpectations(t, mock)
}

func TestListPagesFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPagesForTenantAsc)).
		WithArgs("ja", tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addPageRow(
			addPageRow(
				addPageRow(pageRows(), ids[0], tenantID, "/first", "First", now),
				ids[1], tenantID, "/second", "Second", now.Add(time.Minute),
			),
			ids[2], tenantID, "/third", "Third", now.Add(2*time.Minute),
		))

	req := newListPagesRequest(tenantID)
	req.Limit = 2
	resp, err := client.ListPages(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	if len(resp.Pages) != 2 {
		t.Fatalf("pages count = %d, want the over-fetched row dropped", len(resp.Pages))
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.NextToken)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPagesForTenantAsc)).
		WithArgs("ja", tenantID, boundaryID, false, now, int32(3)).
		WillReturnRows(addPageRow(pageRows(), uuid.Must(uuid.NewV7()), tenantID, "/last", "Last", now.Add(time.Minute)))

	req := newListPagesRequest(tenantID)
	req.Limit = 2
	req.Token = pagination.EncodeTimeUUID(pagination.Forward, now, boundaryID)
	resp, err := client.ListPages(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	if resp.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the previous page")
	}
	if resp.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.NextToken)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPagesForTenantDesc)).
		WithArgs("ja", tenantID, boundaryID, false, now, int32(3)).
		WillReturnRows(addPageRow(
			addPageRow(pageRows(), newerID, tenantID, "/newer", "Newer", now.Add(-time.Minute)),
			olderID, tenantID, "/older", "Older", now.Add(-2*time.Minute),
		))

	req := newListPagesRequest(tenantID)
	req.Limit = 2
	req.Token = pagination.EncodeTimeUUID(pagination.Backward, now, boundaryID)
	resp, err := client.ListPages(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	slugs := make([]string, 0, len(resp.Pages))
	for _, page := range resp.Pages {
		slugs = append(slugs, page.Slug)
	}
	if !slices.Equal(slugs, []string{"/older", "/newer"}) {
		t.Fatalf("slugs = %v, want backward page restored to ascending order", slugs)
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.PreviousToken)
	}
	if resp.NextToken == "" {
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
		{name: "forward", direction: pagination.Forward, wantQuery: dbmodels.ListPagesForTenantAsc, recoveryDirection: pagination.Backward},
		{name: "backward", direction: pagination.Backward, wantQuery: dbmodels.ListPagesForTenantDesc, recoveryDirection: pagination.Forward},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			userID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs("ja", tenantID, boundaryID, false, now, int32(21)).
				WillReturnRows(pageRows())

			req := newListPagesRequest(tenantID)
			req.Token = pagination.EncodeTimeUUID(test.direction, now, boundaryID)
			resp, err := client.ListPages(testutil.WithBearer(context.Background(), sessionToken), req)
			if err != nil {
				t.Fatalf("ListPages: %v", err)
			}
			recoveryToken := resp.PreviousToken
			if test.direction == pagination.Backward {
				recoveryToken = resp.NextToken
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPagesForTenantDesc)).
		WithArgs("ja", tenantID, boundaryID, true, now, int32(21)).
		WillReturnRows(pageRows())

	req := newListPagesRequest(tenantID)
	req.Token = pagination.EncodeTimeUUIDRecovery(pagination.Backward, now, boundaryID)
	resp, err := client.ListPages(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	if resp.PreviousToken != "" || resp.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty after one recovery", resp.PreviousToken, resp.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListPagesInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)
	req := newListPagesRequest(tenantID)
	req.Token = "not-a-valid-token"

	_, err := client.ListPages(testutil.WithBearer(context.Background(), sessionToken), req)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListPagesForTenantAsc)).
		WithArgs("ja", tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnError(errors.New(`pq: relation "tenant_pages" does not exist`))

	_, err := client.ListPages(testutil.WithBearer(context.Background(), sessionToken), newListPagesRequest(tenantID))
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPageByIDForTenant)).
		WithArgs("ja", pageID, tenantID).
		WillReturnError(errors.New(`pq: relation "pages" does not exist`))

	req := &publiraadminv1.GetPageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PageId: pageID.String(),
	}

	_, err := client.GetPage(testutil.WithBearer(context.Background(), sessionToken), req)
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

	translationID := uuid.Must(uuid.NewV7())
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPageByIDForTenant)).
		WithArgs("ja", pageID, tenantID).
		WillReturnRows(pageRows().AddRow(
			pageID, tenantID, "/privacy", true, now, now,
			translationID, pageID, tenantID, "ja", "Before", uuid.NullUUID{}, now, now,
		))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpdatePageTranslationTitle)).
		WithArgs("Updated Title", translationID, tenantID).
		WillReturnRows(sqlmock.NewRows(pageTranslationColumns()).
			AddRow(translationID, pageID, tenantID, "ja", "Updated Title", uuid.NullUUID{}, now, now))
	// Omitted optional field → sql.NullBool{Valid: false} → driver nil arg.
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpdatePage)).
		WithArgs(nil, pageID, tenantID).
		WillReturnRows(sqlmock.NewRows(pageOnlyColumns()).
			AddRow(pageID, tenantID, "/privacy", true, now, now))
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminPagesServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.UpdatePageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PageId: pageID.String(),
		Title:  new("Updated Title"),
		// DisplayInFooter intentionally omitted
	}

	resp, err := client.UpdatePage(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("UpdatePage: %v", err)
	}
	if resp.Page == nil {
		t.Fatalf("page is nil")
	}
	if resp.Page.Title != "Updated Title" {
		t.Fatalf("title = %q, want Updated Title", resp.Page.Title)
	}
	if !resp.Page.DisplayInFooter {
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

	translationID := uuid.Must(uuid.NewV7())
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPageByIDForTenant)).
		WithArgs("ja", pageID, tenantID).
		WillReturnRows(pageRows().AddRow(
			pageID, tenantID, "/privacy", true, now, now,
			translationID, pageID, tenantID, "ja", "Before", uuid.NullUUID{}, now, now,
		))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpdatePageTranslationTitle)).
		WithArgs("Title", translationID, tenantID).
		WillReturnRows(sqlmock.NewRows(pageTranslationColumns()).
			AddRow(translationID, pageID, tenantID, "ja", "Title", uuid.NullUUID{}, now, now))
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpdatePage)).
		WithArgs(sql.NullBool{Bool: false, Valid: true}, pageID, tenantID).
		WillReturnRows(sqlmock.NewRows(pageOnlyColumns()).
			AddRow(pageID, tenantID, "/privacy", false, now, now))
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)

	displayInFooter := false
	client := publiraadminv1connect.NewAdminPagesServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
	req := &publiraadminv1.UpdatePageRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PageId:          pageID.String(),
		Title:           new("Title"),
		DisplayInFooter: &displayInFooter,
	}

	resp, err := client.UpdatePage(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("UpdatePage: %v", err)
	}
	if resp.Page == nil {
		t.Fatalf("page is nil")
	}
	if resp.Page.DisplayInFooter {
		t.Fatalf("display_in_footer = true, want false")
	}
	assertExpectations(t, mock)
}

// A footer-only UpdatePage carries no title, so the translation's title is
// never written: one read before another operator's rename cannot put the old
// title back.
func TestUpdatePageFooterOnlyLeavesTitle(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	pageID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

	translationID := uuid.Must(uuid.NewV7())
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPageByIDForTenant)).
		WithArgs("ja", pageID, tenantID).
		WillReturnRows(pageRows().AddRow(
			pageID, tenantID, "/privacy", false, now, now,
			translationID, pageID, tenantID, "ja", "Renamed elsewhere", uuid.NullUUID{}, now, now,
		))
	// No UpdatePageTranslationTitle: sqlmock fails on a query it was not told to expect.
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.UpdatePage)).
		WithArgs(sql.NullBool{Bool: true, Valid: true}, pageID, tenantID).
		WillReturnRows(sqlmock.NewRows(pageOnlyColumns()).
			AddRow(pageID, tenantID, "/privacy", true, now, now))
	mock.ExpectCommit()
	expectAdminAuditLogInsert(mock)

	resp, err := client.UpdatePage(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.UpdatePageRequest{
		Tenant:          &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PageId:          pageID.String(),
		DisplayInFooter: new(true),
	})
	if err != nil {
		t.Fatalf("UpdatePage: %v", err)
	}
	if resp.Page.Title != "Renamed elsewhere" {
		t.Fatalf("title = %q, want the stored Renamed elsewhere", resp.Page.Title)
	}
	if !resp.Page.DisplayInFooter {
		t.Fatalf("display_in_footer = false, want true")
	}
	assertExpectations(t, mock)
}

func TestUpdatePageRefusesABlankTitle(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newPageClient(t, tenantID, userID, now)

	_, err := client.UpdatePage(testutil.WithBearer(context.Background(), sessionToken), &publiraadminv1.UpdatePageRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		PageId: uuid.Must(uuid.NewV7()).String(),
		Title:  new("   "),
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdatePage code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	assertExpectations(t, mock)
}
