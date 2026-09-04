package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
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
	listAnnouncementsForTenantAscQuery  = "-- name: ListAnnouncementsForTenantAsc :many\n"
	listAnnouncementsForTenantDescQuery = "-- name: ListAnnouncementsForTenantDesc :many\n"
)

func announcementColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"tenant_id",
		"target_user_id",
		"announcement_type",
		"title",
		"body",
		"link_url",
		"metadata",
		"created_at",
		"target_user_public_id",
		"target_user_name",
	})
}

func addAnnouncementRow(
	rows *sqlmock.Rows,
	id, tenantID uuid.UUID,
	title, body, linkURL string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(
		id,
		tenantID,
		uuid.NullUUID{},
		"announcement",
		title,
		body,
		sql.NullString{String: linkURL, Valid: linkURL != ""},
		json.RawMessage("{}"),
		createdAt,
		nil,
		nil,
	)
}

func newAnnouncementClient(
	t *testing.T,
	tenantID, actorID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminAnnouncementServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")
	return publiraadminv1connect.NewAdminAnnouncementServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newAnnouncementRequest(tenantID uuid.UUID, sessionToken string) *connect.Request[publiraadminv1.ListAnnouncementsRequest] {
	req := connect.NewRequest(&publiraadminv1.ListAnnouncementsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func TestCreateAnnouncementRequiresTenantAdmin(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminAnnouncementServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateAnnouncementRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:  "Maintenance Notice",
		Body:   "Maintenance starts today at 25:00.",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.CreateAnnouncement(context.Background(), req)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateAnnouncement code = %v, want permission_denied", connect.CodeOf(err))
	}

	assertExpectations(t, mock)
}

func TestCreateAnnouncementForSelectedUsers(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	user1ID := uuid.Must(uuid.NewV7())
	user2ID := uuid.Must(uuid.NewV7())
	announcement1ID := uuid.Must(uuid.NewV7())
	announcement2ID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetUserByPublicIDForTenant :one\n")).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, "USER001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}).
			AddRow(user1ID, "USER001", "User One", "u1@example.com", "active", uuid.NullUUID{UUID: tenantID, Valid: true}, now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetUserByPublicIDForTenant :one\n")).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, "USER002").
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}).
			AddRow(user2ID, "USER002", "User Two", "u2@example.com", "active", uuid.NullUUID{UUID: tenantID, Valid: true}, now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: CreateAnnouncement :one\n")).
		WithArgs(sqlmock.AnyArg(), tenantID, uuid.NullUUID{UUID: user1ID, Valid: true}, "announcement", "Update", "Body", sqlmock.AnyArg(), json.RawMessage("{}")).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "target_user_id", "announcement_type", "title", "body", "link_url", "metadata", "created_at"}).
			AddRow(announcement1ID, tenantID, uuid.NullUUID{UUID: user1ID, Valid: true}, "announcement", "Update", "Body", "/series/S001", json.RawMessage("{}"), now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: CreateAnnouncement :one\n")).
		WithArgs(sqlmock.AnyArg(), tenantID, uuid.NullUUID{UUID: user2ID, Valid: true}, "announcement", "Update", "Body", sqlmock.AnyArg(), json.RawMessage("{}")).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "target_user_id", "announcement_type", "title", "body", "link_url", "metadata", "created_at"}).
			AddRow(announcement2ID, tenantID, uuid.NullUUID{UUID: user2ID, Valid: true}, "announcement", "Update", "Body", "/series/S001", json.RawMessage("{}"), now))

	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminAnnouncementServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateAnnouncementRequest{
		Tenant:              &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:               "Update",
		Body:                "Body",
		LinkUrl:             "/series/S001",
		AudienceType:        publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_SELECTED_USERS,
		TargetUserPublicIds: []string{"USER001", "USER002"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.CreateAnnouncement(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateAnnouncement: %v", err)
	}
	if len(resp.Msg.Announcements) != 2 {
		t.Fatalf("announcements count = %d, want 2", len(resp.Msg.Announcements))
	}
	if resp.Msg.Announcements[0].TargetUserPublicId != "USER001" {
		t.Fatalf("target_user_public_id = %q, want USER001", resp.Msg.Announcements[0].TargetUserPublicId)
	}

	assertExpectations(t, mock)
}

func TestListAnnouncementsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAnnouncementsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addAnnouncementRow(announcementColumns(), announcementID, tenantID, "Notice", "Body", "/announcements", now))

	resp, err := client.ListAnnouncements(context.Background(), newAnnouncementRequest(tenantID, sessionToken))
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if len(resp.Msg.Announcements) != 1 {
		t.Fatalf("announcements count = %d, want 1", len(resp.Msg.Announcements))
	}
	if resp.Msg.Announcements[0].AudienceType != publiraadminv1.AnnouncementAudienceType_ANNOUNCEMENT_AUDIENCE_TYPE_ALL_USERS {
		t.Fatalf("audience_type = %v, want all users", resp.Msg.Announcements[0].AudienceType)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}

	assertExpectations(t, mock)
}

func TestListAnnouncementsFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(listAnnouncementsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addAnnouncementRow(
			addAnnouncementRow(
				addAnnouncementRow(announcementColumns(), ids[0], tenantID, "First", "body", "", now),
				ids[1], tenantID, "Second", "body", "", now.Add(-time.Minute),
			),
			ids[2], tenantID, "Third", "body", "", now.Add(-2*time.Minute),
		))

	req := newAnnouncementRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	resp, err := client.ListAnnouncements(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if len(resp.Msg.Announcements) != 2 {
		t.Fatalf("announcements count = %d, want the over-fetched row dropped", len(resp.Msg.Announcements))
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.Msg.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	wantKeys := []string{now.Add(-time.Minute).Format(time.RFC3339Nano), ids[1].String()}
	if cursor.Direction != pagination.Forward || !slices.Equal(cursor.Keys, wantKeys) {
		t.Fatalf("next_token = %+v, want forward keys %v", cursor, wantKeys)
	}
	assertExpectations(t, mock)
}

func TestListAnnouncementsFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	lastID := uuid.Must(uuid.NewV7())
	lastAt := now.Add(-2 * time.Minute)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAnnouncementsForTenantDescQuery)).
		WithArgs(
			tenantID,
			uuid.NullUUID{UUID: boundaryID, Valid: true},
			false,
			sql.NullTime{Time: boundaryAt, Valid: true},
			int32(3),
		).
		WillReturnRows(addAnnouncementRow(announcementColumns(), lastID, tenantID, "Last", "body", "", lastAt))

	req := newAnnouncementRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Forward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAnnouncements(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	prev, err := pagination.Decode(resp.Msg.PreviousToken)
	if err != nil {
		t.Fatalf("decode previous_token: %v", err)
	}
	wantPrev := []string{lastAt.Format(time.RFC3339Nano), lastID.String()}
	if prev.Direction != pagination.Backward || !slices.Equal(prev.Keys, wantPrev) {
		t.Fatalf("previous_token = %+v, want backward keys %v", prev, wantPrev)
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListAnnouncementsFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)
	olderID := uuid.Must(uuid.NewV7())
	newerID := uuid.Must(uuid.NewV7())
	olderAt := now.Add(-2 * time.Minute)
	newerAt := now.Add(-time.Minute)

	mock.ExpectQuery(regexp.QuoteMeta(listAnnouncementsForTenantAscQuery)).
		WithArgs(
			tenantID,
			uuid.NullUUID{UUID: boundaryID, Valid: true},
			false,
			sql.NullTime{Time: boundaryAt, Valid: true},
			int32(3),
		).
		WillReturnRows(addAnnouncementRow(
			addAnnouncementRow(announcementColumns(), olderID, tenantID, "Older", "body", "", olderAt),
			newerID, tenantID, "Newer", "body", "", newerAt,
		))

	req := newAnnouncementRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Backward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAnnouncements(context.Background(), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	titles := make([]string, 0, len(resp.Msg.Announcements))
	for _, item := range resp.Msg.Announcements {
		titles = append(titles, item.Title)
	}
	if !slices.Equal(titles, []string{"Newer", "Older"}) {
		t.Fatalf("titles = %v, want backward page restored to descending order", titles)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	next, err := pagination.Decode(resp.Msg.NextToken)
	if err != nil {
		t.Fatalf("decode next_token: %v", err)
	}
	// After Page reverses ASC rows into DESC display order, next_token is
	// built from the last row of the display page (older).
	wantNext := []string{olderAt.Format(time.RFC3339Nano), olderID.String()}
	if next.Direction != pagination.Forward || !slices.Equal(next.Keys, wantNext) {
		t.Fatalf("next_token = %+v, want forward keys %v", next, wantNext)
	}
	assertExpectations(t, mock)
}

func TestListAnnouncementsEmptyPageKeepsAWayBack(t *testing.T) {
	tests := []struct {
		name                string
		direction           pagination.Direction
		wantQuery           string
		wantRecoveryQuery   string
		wantRecoveredTitles []string
	}{
		{
			name:                "forward",
			direction:           pagination.Forward,
			wantQuery:           listAnnouncementsForTenantDescQuery,
			wantRecoveryQuery:   listAnnouncementsForTenantAscQuery,
			wantRecoveredTitles: []string{"Newer", "Boundary"},
		},
		{
			name:                "backward",
			direction:           pagination.Backward,
			wantQuery:           listAnnouncementsForTenantAscQuery,
			wantRecoveryQuery:   listAnnouncementsForTenantDescQuery,
			wantRecoveredTitles: []string{"Boundary", "Older"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(
					tenantID,
					uuid.NullUUID{UUID: boundaryID, Valid: true},
					false,
					sql.NullTime{Time: now, Valid: true},
					int32(21),
				).
				WillReturnRows(announcementColumns())

			req := newAnnouncementRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.Encode(test.direction, now.Format(time.RFC3339Nano), boundaryID.String())
			resp, err := client.ListAnnouncements(context.Background(), req)
			if err != nil {
				t.Fatalf("ListAnnouncements: %v", err)
			}
			recoveryToken := resp.Msg.PreviousToken
			otherToken := resp.Msg.NextToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.Msg.NextToken
				otherToken = resp.Msg.PreviousToken
				recoveryDirection = pagination.Forward
			}
			if otherToken != "" {
				t.Fatalf("opposite token = %q, want empty on an empty page", otherToken)
			}
			wantRecoveryToken := pagination.EncodeTimeUUIDRecovery(recoveryDirection, now, boundaryID)
			if recoveryToken != wantRecoveryToken {
				t.Fatalf("recovery token = %q, want %q", recoveryToken, wantRecoveryToken)
			}

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")
			recoveryRows := announcementColumns()
			if test.direction == pagination.Forward {
				recoveryRows = addAnnouncementRow(recoveryRows, boundaryID, tenantID, "Boundary", "body", "", now)
				recoveryRows = addAnnouncementRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, "Newer", "body", "", now.Add(time.Minute))
			} else {
				recoveryRows = addAnnouncementRow(recoveryRows, boundaryID, tenantID, "Boundary", "body", "", now)
				recoveryRows = addAnnouncementRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, "Older", "body", "", now.Add(-time.Minute))
			}
			mock.ExpectQuery(regexp.QuoteMeta(test.wantRecoveryQuery)).
				WithArgs(
					tenantID,
					uuid.NullUUID{UUID: boundaryID, Valid: true},
					true,
					sql.NullTime{Time: now, Valid: true},
					int32(21),
				).
				WillReturnRows(recoveryRows)

			recoveryReq := newAnnouncementRequest(tenantID, sessionToken)
			recoveryReq.Msg.Token = recoveryToken
			recovered, err := client.ListAnnouncements(context.Background(), recoveryReq)
			if err != nil {
				t.Fatalf("ListAnnouncements recovery: %v", err)
			}
			titles := make([]string, 0, len(recovered.Msg.Announcements))
			for _, item := range recovered.Msg.Announcements {
				titles = append(titles, item.Title)
			}
			if !slices.Equal(titles, test.wantRecoveredTitles) {
				t.Fatalf("recovered titles = %v, want %v", titles, test.wantRecoveredTitles)
			}
			assertExpectations(t, mock)
		})
	}
}

// Recovery happens once. When the boundary row itself is gone the recovery
// query is empty too, and both tokens stay empty so the client falls back to
// the first page instead of bouncing between empty pages.
func TestListAnnouncementsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		wantQuery string
	}{
		{
			name:      "recovering backward",
			direction: pagination.Backward,
			wantQuery: listAnnouncementsForTenantAscQuery,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: listAnnouncementsForTenantDescQuery,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(
					tenantID,
					uuid.NullUUID{UUID: boundaryID, Valid: true},
					true,
					sql.NullTime{Time: now, Valid: true},
					int32(21),
				).
				WillReturnRows(announcementColumns())

			req := newAnnouncementRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.EncodeTimeUUIDRecovery(test.direction, now, boundaryID)
			resp, err := client.ListAnnouncements(context.Background(), req)
			if err != nil {
				t.Fatalf("ListAnnouncements: %v", err)
			}
			if len(resp.Msg.Announcements) != 0 {
				t.Fatalf("announcements = %d rows, want an empty page", len(resp.Msg.Announcements))
			}
			if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
				t.Fatalf(
					"previous_token = %q / next_token = %q, want both empty once recovery also came back empty",
					resp.Msg.PreviousToken, resp.Msg.NextToken,
				)
			}
			assertExpectations(t, mock)
		})
	}
}

func TestListAnnouncementsInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)
	req := newAnnouncementRequest(tenantID, sessionToken)
	req.Msg.Token = "not-a-valid-token"

	_, err := client.ListAnnouncements(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListAnnouncements code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("error = %q, want token internals hidden", err)
	}
	assertExpectations(t, mock)
}

func TestListAnnouncementsDatabaseErrorIsHidden(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listAnnouncementsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnError(errors.New(`pq: relation "announcements" does not exist`))

	_, err := client.ListAnnouncements(context.Background(), newAnnouncementRequest(tenantID, sessionToken))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListAnnouncements code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}
