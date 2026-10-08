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

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/pagination"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func announcementColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"tenant_id",
		"announcement_type",
		"title",
		"body",
		"link_url",
		"metadata",
		"created_at",
		"pinned",
		"pinned_until",
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
		"announcement",
		title,
		body,
		sql.NullString{String: linkURL, Valid: linkURL != ""},
		json.RawMessage("{}"),
		createdAt,
		false,
		sql.NullTime{},
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
	return publiraadminv1connect.NewAdminAnnouncementServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL))), mock, sessionToken
}

func newAnnouncementRequest(tenantID uuid.UUID) *publiraadminv1.ListAnnouncementsRequest {
	req := &publiraadminv1.ListAnnouncementsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	return req
}

func TestCreateAnnouncementRefusesATenantAuditor(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, auth.RoleTenantAuditor)

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, userID, sessionToken, now, auth.RoleTenantAuditor)

	client := publiraadminv1connect.NewAdminAnnouncementServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.CreateAnnouncementRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:  "Maintenance Notice",
		Body:   "Maintenance starts today at 25:00.",
	}

	_, err := client.CreateAnnouncement(testutil.WithBearer(context.Background(), sessionToken), req)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateAnnouncement code = %v, want permission_denied", connect.CodeOf(err))
	}

	assertExpectations(t, mock)
}

func TestCreateAnnouncementForEveryoneQueuesOneNotificationEvent(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CreateAnnouncement)).
		WithArgs(sqlmock.AnyArg(), tenantID, "announcement", "Update", "Body", sqlmock.AnyArg(), json.RawMessage("{}"), false, sql.NullTime{}).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "announcement_type", "title", "body", "link_url", "metadata", "created_at", "pinned", "pinned_until"}).
			AddRow(announcementID, tenantID, "announcement", "Update", "Body", nil, json.RawMessage("{}"), now, false, sql.NullTime{}))
	expectAnnouncementNotificationEvent(mock, tenantID, announcementID)
	mock.ExpectCommit()

	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminAnnouncementServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL)))
	req := &publiraadminv1.CreateAnnouncementRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:  "Update",
		Body:   "Body",
	}

	if _, err := client.CreateAnnouncement(testutil.WithBearer(context.Background(), sessionToken), req); err != nil {
		t.Fatalf("CreateAnnouncement: %v", err)
	}

	assertExpectations(t, mock)
}

// expectAnnouncementNotificationEvent is the outbox row CreateAnnouncement
// writes beside every announcement, in the same transaction: the worker turns
// it into one bell notification per reader the announcement addresses.
func expectAnnouncementNotificationEvent(
	mock sqlmock.Sqlmock,
	tenantID, announcementID uuid.UUID,
) {
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.InsertOutboxEvent)).
		WithArgs(
			sqlmock.AnyArg(),
			uuid.NullUUID{UUID: tenantID, Valid: true},
			outbox.EventTypeAnnouncementNotification,
			sqlmock.AnyArg(),
			outbox.AnnouncementIdempotencyKey(announcementID),
			sqlmock.AnyArg(),
		).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "event_type", "payload", "idempotency_key",
			"status", "attempts", "available_at", "last_error", "created_at", "updated_at", "progress_cursor",
		}).AddRow(
			uuid.Must(uuid.NewV7()),
			uuid.NullUUID{UUID: tenantID, Valid: true},
			outbox.EventTypeAnnouncementNotification,
			json.RawMessage("{}"),
			outbox.AnnouncementIdempotencyKey(announcementID),
			"pending", int32(0), time.Now().UTC(), nil, time.Now().UTC(), time.Now().UTC(), nil,
		))
}

func TestListAnnouncementsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	announcementID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForTenantDesc)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addAnnouncementRow(announcementColumns(), announcementID, tenantID, "Notice", "Body", "/announcements", now))

	resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), newAnnouncementRequest(tenantID))
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if len(resp.Announcements) != 1 {
		t.Fatalf("announcements count = %d, want 1", len(resp.Announcements))
	}
	if resp.PreviousToken != "" || resp.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.PreviousToken, resp.NextToken)
	}

	assertExpectations(t, mock)
}

func TestListAnnouncementsFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newAnnouncementClient(t, tenantID, actorID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForTenantDesc)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addAnnouncementRow(
			addAnnouncementRow(
				addAnnouncementRow(announcementColumns(), ids[0], tenantID, "First", "body", "", now),
				ids[1], tenantID, "Second", "body", "", now.Add(-time.Minute),
			),
			ids[2], tenantID, "Third", "body", "", now.Add(-2*time.Minute),
		))

	req := newAnnouncementRequest(tenantID)
	req.Limit = 2
	resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if len(resp.Announcements) != 2 {
		t.Fatalf("announcements count = %d, want the over-fetched row dropped", len(resp.Announcements))
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", resp.PreviousToken)
	}
	cursor, err := pagination.Decode(resp.NextToken)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForTenantDesc)).
		WithArgs(
			tenantID,
			uuid.NullUUID{UUID: boundaryID, Valid: true},
			false,
			sql.NullTime{Time: boundaryAt, Valid: true},
			int32(3),
		).
		WillReturnRows(addAnnouncementRow(announcementColumns(), lastID, tenantID, "Last", "body", "", lastAt))

	req := newAnnouncementRequest(tenantID)
	req.Limit = 2
	req.Token = pagination.Encode(pagination.Forward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	prev, err := pagination.Decode(resp.PreviousToken)
	if err != nil {
		t.Fatalf("decode previous_token: %v", err)
	}
	wantPrev := []string{lastAt.Format(time.RFC3339Nano), lastID.String()}
	if prev.Direction != pagination.Backward || !slices.Equal(prev.Keys, wantPrev) {
		t.Fatalf("previous_token = %+v, want backward keys %v", prev, wantPrev)
	}
	if resp.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.NextToken)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForTenantAsc)).
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

	req := newAnnouncementRequest(tenantID)
	req.Limit = 2
	req.Token = pagination.Encode(pagination.Backward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	titles := make([]string, 0, len(resp.Announcements))
	for _, item := range resp.Announcements {
		titles = append(titles, item.Title)
	}
	if !slices.Equal(titles, []string{"Newer", "Older"}) {
		t.Fatalf("titles = %v, want backward page restored to descending order", titles)
	}
	if resp.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.PreviousToken)
	}
	next, err := pagination.Decode(resp.NextToken)
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
			wantQuery:           dbmodels.ListAnnouncementsForTenantDesc,
			wantRecoveryQuery:   dbmodels.ListAnnouncementsForTenantAsc,
			wantRecoveredTitles: []string{"Newer", "Boundary"},
		},
		{
			name:                "backward",
			direction:           pagination.Backward,
			wantQuery:           dbmodels.ListAnnouncementsForTenantAsc,
			wantRecoveryQuery:   dbmodels.ListAnnouncementsForTenantDesc,
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

			req := newAnnouncementRequest(tenantID)
			req.Token = pagination.Encode(test.direction, now.Format(time.RFC3339Nano), boundaryID.String())
			resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
			if err != nil {
				t.Fatalf("ListAnnouncements: %v", err)
			}
			recoveryToken := resp.PreviousToken
			otherToken := resp.NextToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.NextToken
				otherToken = resp.PreviousToken
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

			recoveryReq := newAnnouncementRequest(tenantID)
			recoveryReq.Token = recoveryToken
			recovered, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), recoveryReq)
			if err != nil {
				t.Fatalf("ListAnnouncements recovery: %v", err)
			}
			titles := make([]string, 0, len(recovered.Announcements))
			for _, item := range recovered.Announcements {
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
			wantQuery: dbmodels.ListAnnouncementsForTenantAsc,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: dbmodels.ListAnnouncementsForTenantDesc,
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

			req := newAnnouncementRequest(tenantID)
			req.Token = pagination.EncodeTimeUUIDRecovery(test.direction, now, boundaryID)
			resp, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
			if err != nil {
				t.Fatalf("ListAnnouncements: %v", err)
			}
			if len(resp.Announcements) != 0 {
				t.Fatalf("announcements = %d rows, want an empty page", len(resp.Announcements))
			}
			if resp.PreviousToken != "" || resp.NextToken != "" {
				t.Fatalf(
					"previous_token = %q / next_token = %q, want both empty once recovery also came back empty",
					resp.PreviousToken, resp.NextToken,
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
	req := newAnnouncementRequest(tenantID)
	req.Token = "not-a-valid-token"

	_, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), req)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListAnnouncementsForTenantDesc)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnError(errors.New(`pq: relation "announcements" does not exist`))

	_, err := client.ListAnnouncements(testutil.WithBearer(context.Background(), sessionToken), newAnnouncementRequest(tenantID))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListAnnouncements code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertExpectations(t, mock)
}
