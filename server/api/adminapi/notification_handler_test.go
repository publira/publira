package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
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
	listNotificationsForTenantAscQuery  = "-- name: ListNotificationsForTenantAsc :many\n"
	listNotificationsForTenantDescQuery = "-- name: ListNotificationsForTenantDesc :many\n"
)

func notificationColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"tenant_id",
		"target_user_id",
		"notification_type",
		"title",
		"body",
		"link_url",
		"metadata",
		"created_at",
		"target_user_public_id",
		"target_user_name",
	})
}

func addNotificationRow(
	rows *sqlmock.Rows,
	id, tenantID uuid.UUID,
	title, body, linkURL string,
	createdAt time.Time,
) *sqlmock.Rows {
	return rows.AddRow(
		id,
		tenantID,
		uuid.NullUUID{},
		"admin_notification",
		title,
		body,
		sql.NullString{String: linkURL, Valid: linkURL != ""},
		json.RawMessage("{}"),
		createdAt,
		nil,
		nil,
	)
}

func newNotificationClient(
	t *testing.T,
	tenantID, actorID uuid.UUID,
	now time.Time,
) (publiraadminv1connect.AdminNotificationServiceClient, sqlmock.Sqlmock, string) {
	t.Helper()
	testServer, mock := newTestAdminServer(t)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")
	return publiraadminv1connect.NewAdminNotificationServiceClient(testServer.Client(), testServer.URL), mock, sessionToken
}

func newNotificationRequest(tenantID uuid.UUID, sessionToken string) *connect.Request[publiraadminv1.ListNotificationsRequest] {
	req := connect.NewRequest(&publiraadminv1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	return req
}

func TestCreateNotificationRequiresTenantAdmin(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminNotificationServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateNotificationRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:  "メンテナンス告知",
		Body:   "本日 25:00 からメンテナンスを実施します。",
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	_, err := client.CreateNotification(context.Background(), req)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("CreateNotification code = %v, want permission_denied", connect.CodeOf(err))
	}

	assertExpectations(t, mock)
}

func TestCreateNotificationForSelectedUsers(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	user1ID := uuid.Must(uuid.NewV7())
	user2ID := uuid.Must(uuid.NewV7())
	notification1ID := uuid.Must(uuid.NewV7())
	notification2ID := uuid.Must(uuid.NewV7())
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

	mock.ExpectQuery(regexp.QuoteMeta("-- name: CreateNotification :one\n")).
		WithArgs(sqlmock.AnyArg(), tenantID, uuid.NullUUID{UUID: user1ID, Valid: true}, "admin_notification", "更新情報", "本文", sqlmock.AnyArg(), json.RawMessage("{}")).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "target_user_id", "notification_type", "title", "body", "link_url", "metadata", "created_at"}).
			AddRow(notification1ID, tenantID, uuid.NullUUID{UUID: user1ID, Valid: true}, "admin_notification", "更新情報", "本文", "/series/S001", json.RawMessage("{}"), now))

	mock.ExpectQuery(regexp.QuoteMeta("-- name: CreateNotification :one\n")).
		WithArgs(sqlmock.AnyArg(), tenantID, uuid.NullUUID{UUID: user2ID, Valid: true}, "admin_notification", "更新情報", "本文", sqlmock.AnyArg(), json.RawMessage("{}")).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "target_user_id", "notification_type", "title", "body", "link_url", "metadata", "created_at"}).
			AddRow(notification2ID, tenantID, uuid.NullUUID{UUID: user2ID, Valid: true}, "admin_notification", "更新情報", "本文", "/series/S001", json.RawMessage("{}"), now))

	expectAdminAuditLogInsert(mock)

	client := publiraadminv1connect.NewAdminNotificationServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.CreateNotificationRequest{
		Tenant:              &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Title:               "更新情報",
		Body:                "本文",
		LinkUrl:             "/series/S001",
		AudienceType:        publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_SELECTED_USERS,
		TargetUserPublicIds: []string{"USER001", "USER002"},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.CreateNotification(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateNotification: %v", err)
	}
	if len(resp.Msg.Notifications) != 2 {
		t.Fatalf("notifications count = %d, want 2", len(resp.Msg.Notifications))
	}
	if resp.Msg.Notifications[0].TargetUserPublicId != "USER001" {
		t.Fatalf("target_user_public_id = %q, want USER001", resp.Msg.Notifications[0].TargetUserPublicId)
	}

	assertExpectations(t, mock)
}

func TestListNotificationsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	notificationID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listNotificationsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addNotificationRow(notificationColumns(), notificationID, tenantID, "お知らせ", "本文", "/notifications", now))

	resp, err := client.ListNotifications(context.Background(), newNotificationRequest(tenantID, sessionToken))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(resp.Msg.Notifications) != 1 {
		t.Fatalf("notifications count = %d, want 1", len(resp.Msg.Notifications))
	}
	if resp.Msg.Notifications[0].AudienceType != publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_ALL_USERS {
		t.Fatalf("audience_type = %v, want all users", resp.Msg.Notifications[0].AudienceType)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}

	assertExpectations(t, mock)
}

func TestListNotificationsFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	mock.ExpectQuery(regexp.QuoteMeta(listNotificationsForTenantDescQuery)).
		WithArgs(tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(addNotificationRow(
			addNotificationRow(
				addNotificationRow(notificationColumns(), ids[0], tenantID, "First", "body", "", now),
				ids[1], tenantID, "Second", "body", "", now.Add(-time.Minute),
			),
			ids[2], tenantID, "Third", "body", "", now.Add(-2*time.Minute),
		))

	req := newNotificationRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	resp, err := client.ListNotifications(context.Background(), req)
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(resp.Msg.Notifications) != 2 {
		t.Fatalf("notifications count = %d, want the over-fetched row dropped", len(resp.Msg.Notifications))
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

func TestListNotificationsFollowsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-time.Minute)
	client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listNotificationsForTenantDescQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addNotificationRow(notificationColumns(), uuid.Must(uuid.NewV7()), tenantID, "Last", "body", "", now.Add(-2*time.Minute)))

	req := newNotificationRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Forward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListNotifications(context.Background(), req)
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if resp.Msg.PreviousToken == "" {
		t.Fatal("previous_token is empty, want a token back to the page the client came from")
	}
	if resp.Msg.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", resp.Msg.NextToken)
	}
	assertExpectations(t, mock)
}

func TestListNotificationsFollowsPreviousTokenBackwards(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	boundaryID := uuid.Must(uuid.NewV7())
	boundaryAt := now.Add(-10 * time.Minute)
	client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)
	olderID := uuid.Must(uuid.NewV7())
	newerID := uuid.Must(uuid.NewV7())

	mock.ExpectQuery(regexp.QuoteMeta(listNotificationsForTenantAscQuery)).
		WithArgs(tenantID, boundaryID, false, boundaryAt, int32(3)).
		WillReturnRows(addNotificationRow(
			addNotificationRow(notificationColumns(), olderID, tenantID, "Older", "body", "", now.Add(-2*time.Minute)),
			newerID, tenantID, "Newer", "body", "", now.Add(-time.Minute),
		))

	req := newNotificationRequest(tenantID, sessionToken)
	req.Msg.Limit = 2
	req.Msg.Token = pagination.Encode(pagination.Backward, boundaryAt.Format(time.RFC3339Nano), boundaryID.String())
	resp, err := client.ListNotifications(context.Background(), req)
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	titles := make([]string, 0, len(resp.Msg.Notifications))
	for _, item := range resp.Msg.Notifications {
		titles = append(titles, item.Title)
	}
	if !slices.Equal(titles, []string{"Newer", "Older"}) {
		t.Fatalf("titles = %v, want backward page restored to descending order", titles)
	}
	if resp.Msg.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty once the scan reached the first page", resp.Msg.PreviousToken)
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty, want a token back to the page the client came from")
	}
	assertExpectations(t, mock)
}

func TestListNotificationsEmptyPageKeepsAWayBack(t *testing.T) {
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
			wantQuery:           listNotificationsForTenantDescQuery,
			wantRecoveryQuery:   listNotificationsForTenantAscQuery,
			wantRecoveredTitles: []string{"Newer", "Boundary"},
		},
		{
			name:                "backward",
			direction:           pagination.Backward,
			wantQuery:           listNotificationsForTenantAscQuery,
			wantRecoveryQuery:   listNotificationsForTenantDescQuery,
			wantRecoveredTitles: []string{"Boundary", "Older"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, false, now, int32(21)).
				WillReturnRows(notificationColumns())

			req := newNotificationRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.Encode(test.direction, now.Format(time.RFC3339Nano), boundaryID.String())
			resp, err := client.ListNotifications(context.Background(), req)
			if err != nil {
				t.Fatalf("ListNotifications: %v", err)
			}
			recoveryToken := resp.Msg.PreviousToken
			recoveryDirection := pagination.Backward
			if test.direction == pagination.Backward {
				recoveryToken = resp.Msg.NextToken
				recoveryDirection = pagination.Forward
			}
			wantRecoveryToken := pagination.EncodeTimeUUIDRecovery(recoveryDirection, now, boundaryID)
			if recoveryToken != wantRecoveryToken {
				t.Fatalf("recovery token = %q, want %q", recoveryToken, wantRecoveryToken)
			}

			expectTenantLookup(mock, tenantID, "TENANT", now)
			expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")
			recoveryRows := notificationColumns()
			if test.direction == pagination.Forward {
				recoveryRows = addNotificationRow(recoveryRows, boundaryID, tenantID, "Boundary", "body", "", now)
				recoveryRows = addNotificationRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, "Newer", "body", "", now.Add(time.Minute))
			} else {
				recoveryRows = addNotificationRow(recoveryRows, boundaryID, tenantID, "Boundary", "body", "", now)
				recoveryRows = addNotificationRow(recoveryRows, uuid.Must(uuid.NewV7()), tenantID, "Older", "body", "", now.Add(-time.Minute))
			}
			mock.ExpectQuery(regexp.QuoteMeta(test.wantRecoveryQuery)).
				WithArgs(tenantID, boundaryID, true, now, int32(21)).
				WillReturnRows(recoveryRows)

			recoveryReq := newNotificationRequest(tenantID, sessionToken)
			recoveryReq.Msg.Token = recoveryToken
			recovered, err := client.ListNotifications(context.Background(), recoveryReq)
			if err != nil {
				t.Fatalf("ListNotifications recovery: %v", err)
			}
			titles := make([]string, 0, len(recovered.Msg.Notifications))
			for _, item := range recovered.Msg.Notifications {
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
func TestListNotificationsEmptyRecoveryPageDropsBothTokens(t *testing.T) {
	tests := []struct {
		name      string
		direction pagination.Direction
		wantQuery string
	}{
		{
			name:      "recovering backward",
			direction: pagination.Backward,
			wantQuery: listNotificationsForTenantAscQuery,
		},
		{
			name:      "recovering forward",
			direction: pagination.Forward,
			wantQuery: listNotificationsForTenantDescQuery,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tenantID := uuid.Must(uuid.NewV7())
			actorID := uuid.Must(uuid.NewV7())
			now := time.Now().UTC().Truncate(time.Microsecond)
			boundaryID := uuid.Must(uuid.NewV7())
			client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)

			mock.ExpectQuery(regexp.QuoteMeta(test.wantQuery)).
				WithArgs(tenantID, boundaryID, true, now, int32(21)).
				WillReturnRows(notificationColumns())

			req := newNotificationRequest(tenantID, sessionToken)
			req.Msg.Token = pagination.EncodeTimeUUIDRecovery(test.direction, now, boundaryID)
			resp, err := client.ListNotifications(context.Background(), req)
			if err != nil {
				t.Fatalf("ListNotifications: %v", err)
			}
			if len(resp.Msg.Notifications) != 0 {
				t.Fatalf("notifications = %d rows, want an empty page", len(resp.Msg.Notifications))
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

func TestListNotificationsInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)
	req := newNotificationRequest(tenantID, sessionToken)
	req.Msg.Token = "not-a-valid-token"

	_, err := client.ListNotifications(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListNotifications code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if err.Error() != "invalid_argument: token is invalid" {
		t.Fatalf("error = %q, want token internals hidden", err)
	}
	assertExpectations(t, mock)
}
