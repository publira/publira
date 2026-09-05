package adminapi

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

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

const (
	listNotificationsForUserDescQuery = "-- name: ListNotificationsForUserDesc :many\n"
	countUnreadNotificationsQuery     = "-- name: CountUnreadNotificationsForUser :one\n"
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
) *sqlmock.Rows {
	return rows.AddRow(
		id,
		tenantID,
		userID,
		notificationType,
		"episode:E001",
		json.RawMessage(`{"episode_id":"E001"}`),
		createdAt,
		false,
		sql.NullTime{},
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

func TestListNotificationsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	notificationID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(listNotificationsForUserDescQuery)).
		WithArgs(actorID, tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addNotificationRow(notificationColumns(), notificationID, tenantID, actorID, "episode_published", now))

	resp, err := client.ListNotifications(context.Background(), newNotificationRequest(tenantID, sessionToken))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(resp.Msg.Notifications) != 1 {
		t.Fatalf("count = %d, want 1", len(resp.Msg.Notifications))
	}
	if resp.Msg.Notifications[0].NotificationType != "episode_published" {
		t.Fatalf("type = %q", resp.Msg.Notifications[0].NotificationType)
	}

	assertExpectations(t, mock)
}

func TestListNotificationsInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)

	req := newNotificationRequest(tenantID, sessionToken)
	req.Msg.Token = "not-a-token"
	_, err := client.ListNotifications(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListNotifications code = %v, want invalid_argument", connect.CodeOf(err))
	}

	assertExpectations(t, mock)
}

func TestCountUnreadNotificationsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(countUnreadNotificationsQuery)).
		WithArgs(tenantID, actorID).
		WillReturnRows(sqlmock.NewRows([]string{"unread_count"}).AddRow(int32(2)))

	req := connect.NewRequest(&publiraadminv1.CountUnreadNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)
	resp, err := client.CountUnreadNotifications(context.Background(), req)
	if err != nil {
		t.Fatalf("CountUnreadNotifications: %v", err)
	}
	if resp.Msg.UnreadCount != 2 {
		t.Fatalf("unread = %d, want 2", resp.Msg.UnreadCount)
	}

	assertExpectations(t, mock)
}

func TestListNotificationsRequiresTenantAdmin(t *testing.T) {
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookup(mock, tenantID, userID, sessionToken, now)

	client := publiraadminv1connect.NewAdminNotificationServiceClient(testServer.Client(), testServer.URL)
	_, err := client.ListNotifications(context.Background(), newNotificationRequest(tenantID, sessionToken))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListNotifications code = %v, want permission_denied", connect.CodeOf(err))
	}

	assertExpectations(t, mock)
}
