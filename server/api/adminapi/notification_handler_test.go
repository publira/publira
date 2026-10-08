package adminapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
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
	return publiraadminv1connect.NewAdminNotificationServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL))), mock, sessionToken
}

func newNotificationRequest(tenantID uuid.UUID) *publiraadminv1.ListNotificationsRequest {
	req := &publiraadminv1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	return req
}

func TestListNotificationsSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	notificationID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListNotificationsForUserDesc)).
		WithArgs(actorID, tenantID, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addNotificationRow(notificationColumns(), notificationID, tenantID, actorID, "episode_published", now))

	resp, err := client.ListNotifications(testutil.WithBearer(context.Background(), sessionToken), newNotificationRequest(tenantID))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(resp.Notifications) != 1 {
		t.Fatalf("count = %d, want 1", len(resp.Notifications))
	}
	if resp.Notifications[0].NotificationType != "episode_published" {
		t.Fatalf("type = %q", resp.Notifications[0].NotificationType)
	}

	assertExpectations(t, mock)
}

func TestListNotificationsInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock, sessionToken := newNotificationClient(t, tenantID, actorID, now)

	req := newNotificationRequest(tenantID)
	req.Token = "not-a-token"
	_, err := client.ListNotifications(testutil.WithBearer(context.Background(), sessionToken), req)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CountUnreadNotificationsForUser)).
		WithArgs(tenantID, actorID).
		WillReturnRows(sqlmock.NewRows([]string{"unread_count"}).AddRow(int32(2)))

	req := &publiraadminv1.CountUnreadNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	}
	resp, err := client.CountUnreadNotifications(testutil.WithBearer(context.Background(), sessionToken), req)
	if err != nil {
		t.Fatalf("CountUnreadNotifications: %v", err)
	}
	if resp.UnreadCount != 2 {
		t.Fatalf("unread = %d, want 2", resp.UnreadCount)
	}

	assertExpectations(t, mock)
}
