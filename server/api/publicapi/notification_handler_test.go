package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/gen/publira/v1/publirav1connect"
	"github.com/publira/publira/server/internal/pagination"
)

const (
	listNotificationsForUserDescQuery = "-- name: ListNotificationsForUserDesc :many\n"
	countUnreadNotificationsQuery     = "-- name: CountUnreadNotificationsForUser :one\n"
	markNotificationAsReadQuery       = "-- name: MarkNotificationAsRead :one\n"
	markAllNotificationsAsReadQuery   = "-- name: MarkAllNotificationsAsRead :execrows\n"
)

func notificationColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "tenant_id", "user_id", "notification_type", "subject_key", "payload", "created_at", "is_read", "read_at",
	})
}

func addNotificationRow(
	rows *sqlmock.Rows,
	id, tenantID, userID uuid.UUID,
	notificationType string,
	createdAt time.Time,
	isRead bool,
) *sqlmock.Rows {
	readAt := sql.NullTime{}
	if isRead {
		readAt = sql.NullTime{Time: createdAt, Valid: true}
	}
	return rows.AddRow(
		id,
		tenantID,
		userID,
		notificationType,
		"episode:E001",
		json.RawMessage(`{"episode_id":"E001"}`),
		createdAt,
		isRead,
		readAt,
	)
}

func newNotificationClient(
	t *testing.T,
	tenantID, userID uuid.UUID,
	now time.Time,
) (publirav1connect.NotificationServiceClient, sqlmock.Sqlmock) {
	t.Helper()
	testServer, mock := newTestPublicServer(t)
	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)
	return publirav1connect.NewNotificationServiceClient(testServer.Client(), testServer.URL), mock
}

func TestNotificationListSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	notificationID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listNotificationsForUserDescQuery)).
		WithArgs(userID, tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addNotificationRow(notificationColumns(), notificationID, tenantID, userID, "episode_published", now, false))

	resp, err := client.ListNotifications(context.Background(), newAuthedPublicRequest(&publirav1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(resp.Msg.Notifications) != 1 {
		t.Fatalf("count = %d, want 1", len(resp.Msg.Notifications))
	}
	if resp.Msg.Notifications[0].NotificationType != "episode_published" {
		t.Fatalf("type = %q", resp.Msg.Notifications[0].NotificationType)
	}
	if resp.Msg.Notifications[0].Payload != `{"episode_id":"E001"}` {
		t.Fatalf("payload = %q", resp.Msg.Notifications[0].Payload)
	}
	if resp.Msg.Notifications[0].IsRead {
		t.Fatal("is_read = true, want false")
	}

	assertPublicExpectations(t, mock)
}

func TestNotificationListInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	req := newAuthedPublicRequest(&publirav1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  "not-a-token",
	}, tenantID.String())
	_, err := client.ListNotifications(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListNotifications code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}

	assertPublicExpectations(t, mock)
}

func TestNotificationCountUnread(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(countUnreadNotificationsQuery)).
		WithArgs(tenantID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"unread_count"}).AddRow(int32(3)))

	resp, err := client.CountUnreadNotifications(context.Background(), newAuthedPublicRequest(&publirav1.CountUnreadNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("CountUnreadNotifications: %v", err)
	}
	if resp.Msg.UnreadCount != 3 {
		t.Fatalf("unread = %d, want 3", resp.Msg.UnreadCount)
	}

	assertPublicExpectations(t, mock)
}

func TestNotificationMarkAsReadNotFound(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	notificationID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(markNotificationAsReadQuery)).
		WithArgs(userID, notificationID, tenantID).
		WillReturnError(sql.ErrNoRows)

	_, err := client.MarkNotificationAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkNotificationAsReadRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		NotificationId: notificationID.String(),
	}, tenantID.String()))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("MarkNotificationAsRead code = %v, want not_found", connect.CodeOf(err))
	}

	assertPublicExpectations(t, mock)
}

func TestNotificationMarkAsReadInvalidID(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	_, err := client.MarkNotificationAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkNotificationAsReadRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		NotificationId: "not-a-uuid",
	}, tenantID.String()))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("MarkNotificationAsRead code = %v, want invalid_argument", connect.CodeOf(err))
	}

	assertPublicExpectations(t, mock)
}

func TestNotificationMarkAllAsRead(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	mock.ExpectExec(regexp.QuoteMeta(markAllNotificationsAsReadQuery)).
		WithArgs(userID, tenantID).
		WillReturnResult(sqlmock.NewResult(0, 4))

	resp, err := client.MarkAllNotificationsAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkAllNotificationsAsReadRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("MarkAllNotificationsAsRead: %v", err)
	}
	if resp.Msg.MarkedCount != 4 {
		t.Fatalf("marked_count = %d, want 4", resp.Msg.MarkedCount)
	}

	assertPublicExpectations(t, mock)
}

func TestNotificationListFirstPageReportsNextToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	rows := notificationColumns()
	for index, id := range ids {
		addNotificationRow(rows, id, tenantID, userID, "episode_published", now.Add(-time.Duration(index)*time.Minute), false)
	}
	mock.ExpectQuery(regexp.QuoteMeta(listNotificationsForUserDescQuery)).
		WithArgs(userID, tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(rows)

	resp, err := client.ListNotifications(context.Background(), newAuthedPublicRequest(&publirav1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
	}, tenantID.String()))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(resp.Msg.Notifications) != 2 {
		t.Fatalf("count = %d, want 2", len(resp.Msg.Notifications))
	}
	if resp.Msg.NextToken == "" {
		t.Fatal("next_token is empty")
	}
	if _, err := pagination.Decode(resp.Msg.NextToken); err != nil {
		t.Fatalf("next_token decode: %v", err)
	}

	assertPublicExpectations(t, mock)
}
