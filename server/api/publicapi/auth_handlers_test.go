package publicapi

import (
	"context"
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
	"github.com/publira/publira/server/internal/auth"
)

const (
	getUserByIDQuery                = "-- name: GetUserByID :one\n"
	listTenantUserRolesQuery        = "-- name: ListTenantUserRoles :many\nSELECT role\nFROM tenant_user_roles\nWHERE user_id = $1\nORDER BY role\n"
	listNotificationsForUserQuery   = "-- name: ListNotificationsForUser :many\nSELECT\n    n.id, n.tenant_id, n.target_user_id, n.notification_type, n.title, n.body, n.link_url, n.metadata, n.created_at,\n    (nr.notification_id IS NOT NULL) AS is_read,\n    nr.read_at\nFROM notifications n\n    LEFT JOIN notification_reads nr ON nr.notification_id = n.id\n    AND nr.user_id = $2\nWHERE n.tenant_id = $1\n    AND (n.target_user_id IS NULL OR n.target_user_id = $2)\nORDER BY n.created_at DESC\nLIMIT $3 OFFSET $4\n"
	markNotificationAsReadQuery     = "-- name: MarkNotificationAsRead :one\nINSERT INTO notification_reads (notification_id, user_id, read_at)\nSELECT n.id, $3, NOW()\nFROM notifications n\nWHERE n.id = $1\n    AND n.tenant_id = $2\n    AND (n.target_user_id IS NULL OR n.target_user_id = $3)\nON CONFLICT (notification_id, user_id) DO UPDATE\nSET read_at = EXCLUDED.read_at\nRETURNING notification_id, user_id, read_at\n"
	markAllNotificationsAsReadQuery = "-- name: MarkAllNotificationsAsRead :execrows\nINSERT INTO notification_reads (notification_id, user_id, read_at)\nSELECT n.id, $2, NOW()\nFROM notifications n\nWHERE n.tenant_id = $1\n    AND (n.target_user_id IS NULL OR n.target_user_id = $2)\n    AND NOT EXISTS (\n        SELECT 1\n        FROM notification_reads nr\n        WHERE nr.notification_id = n.id\n            AND nr.user_id = $2\n    )\n"
)

const testPublicUserPublicID = "USR001"

func issueTestPublicToken(tenantPublicID string) string {
	token, _, err := auth.MustTokenManagerFromEnv().Issue(
		testPublicUserPublicID,
		auth.AudiencePublic,
		tenantPublicID,
		"tenant_member",
		1,
		time.Now(),
	)
	if err != nil {
		panic(err)
	}
	return token
}

func expectAuthSession(mock sqlmock.Sqlmock, tenantID, userID uuid.UUID, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("-- name: GetUserByPublicIDForTenant :one\n")).
		WithArgs(uuid.NullUUID{UUID: tenantID, Valid: true}, testPublicUserPublicID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "name", "email", "status", "tenant_id", "created_at"}).
			AddRow(userID, testPublicUserPublicID, "Member User", "member@example.com", "active", uuid.NullUUID{UUID: tenantID, Valid: true}, now))

	mock.ExpectQuery(regexp.QuoteMeta(getUserByIDQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "email", "password_hash", "name", "created_at", "status", "tenant_id", "email_verified_at", "credentials_version"}).
			AddRow(userID, testPublicUserPublicID, "member@example.com", "", "Member User", now, "active", uuid.NullUUID{UUID: tenantID, Valid: true}, now, int32(1)))

	mock.ExpectQuery(regexp.QuoteMeta(listTenantUserRolesQuery)).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("tenant_member"))
}

func newAuthedPublicRequest[T any](msg *T, tenantPublicID string) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("Authorization", "Bearer "+issueTestPublicToken(tenantPublicID))
	return req
}

func TestAuthListNotificationsSuccess(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	notificationID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)
	mock.ExpectQuery(regexp.QuoteMeta(listNotificationsForUserQuery)).
		WithArgs(tenantID, userID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "tenant_id", "target_user_id", "notification_type", "title", "body", "link_url", "metadata", "created_at", "is_read", "read_at",
		}).AddRow(
			notificationID,
			tenantID,
			uuid.NullUUID{},
			"member_episode_published",
			"新着エピソード",
			"最新話が公開されました",
			"/series/S001/episodes/E001",
			json.RawMessage("{}"),
			now,
			true,
			now,
		))

	client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.ListNotifications(context.Background(), newAuthedPublicRequest(&publirav1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
		Limit:  -1,
		Offset: -1,
	}, "TENANT"))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}

	if len(resp.Msg.Notifications) != 1 {
		t.Fatalf("notifications count = %d, want 1", len(resp.Msg.Notifications))
	}
	if resp.Msg.Notifications[0].LinkUrl != "/series/S001/episodes/E001" {
		t.Fatalf("link_url = %q, want /series/S001/episodes/E001", resp.Msg.Notifications[0].LinkUrl)
	}
	if !resp.Msg.Notifications[0].IsRead {
		t.Fatalf("is_read = false, want true")
	}

	assertPublicExpectations(t, mock)
}

func TestAuthMarkNotificationAsRead(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		testServer, mock := newTestPublicServer(t)

		tenantID := uuid.Must(uuid.NewV7())
		userID := uuid.Must(uuid.NewV7())
		notificationID := uuid.Must(uuid.NewV7())
		now := time.Now().UTC()

		expectTenantLookup(mock, tenantID, "TENANT", now)
		expectAuthSession(mock, tenantID, userID, now)
		mock.ExpectQuery(regexp.QuoteMeta(markNotificationAsReadQuery)).
			WithArgs(notificationID, tenantID, userID).
			WillReturnRows(sqlmock.NewRows([]string{"notification_id", "user_id", "read_at"}).
				AddRow(notificationID, userID, now))

		client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
		resp, err := client.MarkNotificationAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkNotificationAsReadRequest{
			Tenant:         &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
			NotificationId: notificationID.String(),
		}, "TENANT"))
		if err != nil {
			t.Fatalf("MarkNotificationAsRead: %v", err)
		}
		if !resp.Msg.Marked {
			t.Fatalf("marked = false, want true")
		}

		assertPublicExpectations(t, mock)
	})

	t.Run("invalid-notification-id", func(t *testing.T) {
		testServer, mock := newTestPublicServer(t)

		tenantID := uuid.Must(uuid.NewV7())
		userID := uuid.Must(uuid.NewV7())
		now := time.Now().UTC()

		expectTenantLookup(mock, tenantID, "TENANT", now)
		expectAuthSession(mock, tenantID, userID, now)

		client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
		_, err := client.MarkNotificationAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkNotificationAsReadRequest{
			Tenant:         &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
			NotificationId: "not-a-uuid",
		}, "TENANT"))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
		}

		assertPublicExpectations(t, mock)
	})

	t.Run("not-found", func(t *testing.T) {
		testServer, mock := newTestPublicServer(t)

		tenantID := uuid.Must(uuid.NewV7())
		userID := uuid.Must(uuid.NewV7())
		notificationID := uuid.Must(uuid.NewV7())
		now := time.Now().UTC()

		expectTenantLookup(mock, tenantID, "TENANT", now)
		expectAuthSession(mock, tenantID, userID, now)
		mock.ExpectQuery(regexp.QuoteMeta(markNotificationAsReadQuery)).
			WithArgs(notificationID, tenantID, userID).
			WillReturnRows(sqlmock.NewRows([]string{"notification_id", "user_id", "read_at"}))

		client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
		_, err := client.MarkNotificationAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkNotificationAsReadRequest{
			Tenant:         &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
			NotificationId: notificationID.String(),
		}, "TENANT"))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
		}

		assertPublicExpectations(t, mock)
	})
}

func TestAuthMarkAllNotificationsAsRead(t *testing.T) {
	testServer, mock := newTestPublicServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC()

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)
	mock.ExpectExec(regexp.QuoteMeta(markAllNotificationsAsReadQuery)).
		WithArgs(tenantID, userID).
		WillReturnResult(sqlmock.NewResult(0, 3))

	client := publirav1connect.NewAuthServiceClient(testServer.Client(), testServer.URL)
	resp, err := client.MarkAllNotificationsAsRead(context.Background(), newAuthedPublicRequest(&publirav1.MarkAllNotificationsAsReadRequest{
		Tenant: &publirattypesv1.TenantContext{TenantPublicId: "TENANT"},
	}, "TENANT"))
	if err != nil {
		t.Fatalf("MarkAllNotificationsAsRead: %v", err)
	}
	if resp.Msg.MarkedCount != 3 {
		t.Fatalf("marked_count = %d, want 3", resp.Msg.MarkedCount)
	}

	assertPublicExpectations(t, mock)
}
