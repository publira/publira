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

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The creator mark is read by the page query itself. Each test below states
// every statement one page runs, so a lookup per comment added beside the page
// query is an unexpected query and fails it.

func newCommentModerationMockRequest[T any](tenantID uuid.UUID, message *T) *connect.Request[T] {
	request := connect.NewRequest(message)
	request.Header().Set("Authorization", "Bearer "+issueTestAdminToken(tenantID.String(), testUserPublicID, auth.RoleTenantAdmin))
	return request
}

func expectCommentRetentionDefaults(mock sqlmock.Sqlmock, tenantID uuid.UUID) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetPlatformRetentionConfig)).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.GetTenantRetentionSettings)).
		WithArgs(tenantID).
		WillReturnError(sql.ErrNoRows)
}

// assertAdminCommentCreator fails unless the comment names want, or names
// nobody when want is the zero creator.
func assertAdminCommentCreator(t *testing.T, what string, comment *publiraadminv1.AdminComment, want testutil.Creator) {
	t.Helper()

	got := comment.Creator
	if want.ID == uuid.Nil {
		if got != nil {
			t.Fatalf("%s comment %s creator = %v, want none", what, comment.PublicId, got)
		}
		return
	}
	if got == nil {
		t.Fatalf("%s comment %s creator = none, want %s", what, comment.PublicId, want.Name)
	}
	if got.Id != want.ID.String() || got.PublicId != want.PublicID || got.Name != want.Name {
		t.Fatalf("%s comment %s creator = {%s %s %q}, want {%s %s %q}", what, comment.PublicId, got.Id, got.PublicId, got.Name, want.ID, want.PublicID, want.Name)
	}
}

func TestListCommentsReadsTheCreatorMarkWithThePage(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	creator := testutil.Creator{ID: uuid.Must(uuid.NewV7()), PublicID: "CREATOR00001", Name: "Pen Name"}
	now := time.Now().UTC().Truncate(time.Second)

	testServer, mock := newTestAdminServer(t)
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, uuid.Must(uuid.NewV7()), "", now, auth.RoleTenantAdmin)
	rows := sqlmock.NewRows([]string{
		"id", "tenant_id", "public_id", "episode_id", "user_id", "body", "status", "approved_by", "hidden_by", "hidden_reason",
		"created_at", "updated_at", "published_at", "hidden_at", "withdrawn_at", "open_report_count",
		"author_public_id", "author_name", "author_is_staff", "episode_public_id", "episode_title", "series_public_id", "series_title",
		"creator_id", "creator_public_id", "creator_name",
	})
	for _, comment := range []struct {
		publicID, authorPublicID, authorName string
		creatorID                            any
		creatorPublicID                      any
		creatorName                          any
	}{
		{"COMMENT00001", "USERCREATOR1", "Account Name", creator.ID, creator.PublicID, creator.Name},
		{"COMMENT00002", "USERREADER01", "Reader", nil, nil, nil},
		{"COMMENT00003", "USERREADER02", "Another Reader", nil, nil, nil},
	} {
		rows.AddRow(
			uuid.Must(uuid.NewV7()), tenantID, comment.publicID, uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), "A comment.", "published", nil, nil, nil,
			now, now, now, nil, nil, int32(0),
			comment.authorPublicID, comment.authorName, false, "EPISODE00001", "Episode Title", "SERIES000001", "Series Title",
			comment.creatorID, comment.creatorPublicID, comment.creatorName,
		)
	}
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeCommentsForModerationByCreatedAtDesc)).
		WillReturnRows(rows)
	expectCommentRetentionDefaults(mock, tenantID)

	client := publiraadminv1connect.NewAdminCommentServiceClient(testServer.Client(), testServer.URL)
	res, err := client.ListComments(context.Background(), newCommentModerationMockRequest(tenantID, &publiraadminv1.ListCommentsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if got := len(res.Msg.Comments); got != 3 {
		t.Fatalf("comments = %d, want 3", got)
	}
	assertAdminCommentCreator(t, "the author's", res.Msg.Comments[0], creator)
	for _, comment := range res.Msg.Comments[1:] {
		assertAdminCommentCreator(t, "a reader's", comment, testutil.Creator{})
	}

	assertExpectations(t, mock)
}

func TestListCommentReportsReadsTheCreatorMarkWithThePage(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	creator := testutil.Creator{ID: uuid.Must(uuid.NewV7()), PublicID: "CREATOR00001", Name: "Pen Name"}
	now := time.Now().UTC().Truncate(time.Second)

	testServer, mock := newTestAdminServer(t)
	expectTenantLookup(mock, tenantID, "TENANT001", now)
	expectActiveSessionLookupWithRole(mock, tenantID, uuid.Must(uuid.NewV7()), "", now, auth.RoleTenantAdmin)
	rows := sqlmock.NewRows([]string{
		"report_id", "reason", "note", "report_status", "report_created_at", "resolved_at", "reporter_public_id", "reporter_name",
		"id", "public_id", "body", "status", "hidden_reason", "created_at", "published_at", "hidden_at", "withdrawn_at", "open_report_count",
		"author_public_id", "author_name", "author_is_staff", "episode_public_id", "episode_title", "series_public_id", "series_title",
		"creator_id", "creator_public_id", "creator_name",
	})
	for _, comment := range []struct {
		publicID        string
		creatorID       any
		creatorPublicID any
		creatorName     any
	}{
		{"COMMENT00001", creator.ID, creator.PublicID, creator.Name},
		{"COMMENT00002", nil, nil, nil},
		{"COMMENT00003", nil, nil, nil},
	} {
		rows.AddRow(
			uuid.Must(uuid.NewV7()), "spam", nil, "open", now, nil, "REPORTER0001", "Reporter",
			uuid.Must(uuid.NewV7()), comment.publicID, "A reported comment.", "published", nil, now, now, nil, nil, int32(1),
			"AUTHOR000001", "Author", false, "EPISODE00001", "Episode Title", "SERIES000001", "Series Title",
			comment.creatorID, comment.creatorPublicID, comment.creatorName,
		)
	}
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListEpisodeCommentReportsForModerationByCreatedAtDesc)).
		WillReturnRows(rows)
	expectCommentRetentionDefaults(mock, tenantID)

	client := publiraadminv1connect.NewAdminCommentServiceClient(testServer.Client(), testServer.URL)
	res, err := client.ListCommentReports(context.Background(), newCommentModerationMockRequest(tenantID, &publiraadminv1.ListCommentReportsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}))
	if err != nil {
		t.Fatalf("ListCommentReports: %v", err)
	}
	if got := len(res.Msg.Reports); got != 3 {
		t.Fatalf("reports = %d, want 3", got)
	}
	assertAdminCommentCreator(t, "the author's reported", res.Msg.Reports[0].Comment, creator)
	for _, report := range res.Msg.Reports[1:] {
		assertAdminCommentCreator(t, "a reader's reported", report.Comment, testutil.Creator{})
	}

	assertExpectations(t, mock)
}
