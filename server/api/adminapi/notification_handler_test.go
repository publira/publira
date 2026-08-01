package adminapi

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
)

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
	testServer, mock := newTestAdminServer(t)

	tenantID := uuid.Must(uuid.NewV7())
	actorID := uuid.Must(uuid.NewV7())
	notificationID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	sessionToken := issueTestAdminToken(tenantID.String(), testUserPublicID, "editor")

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectActiveSessionLookupWithRole(mock, tenantID, actorID, sessionToken, now, "tenant_admin")

	mock.ExpectQuery(regexp.QuoteMeta("-- name: ListNotificationsForTenant :many\n")).
		WithArgs(tenantID, int32(20), int32(0)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tenant_id", "target_user_id", "notification_type", "title", "body", "link_url", "metadata", "created_at", "target_user_public_id", "target_user_name"}).
			AddRow(notificationID, tenantID, uuid.NullUUID{}, "admin_notification", "お知らせ", "本文", "/notifications", json.RawMessage("{}"), now, nil, nil))

	client := publiraadminv1connect.NewAdminNotificationServiceClient(testServer.Client(), testServer.URL)
	req := connect.NewRequest(&publiraadminv1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	req.Header().Set("Authorization", "Bearer "+sessionToken)

	resp, err := client.ListNotifications(context.Background(), req)
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(resp.Msg.Notifications) != 1 {
		t.Fatalf("notifications count = %d, want 1", len(resp.Msg.Notifications))
	}
	if resp.Msg.Notifications[0].AudienceType != publiraadminv1.NotificationAudienceType_NOTIFICATION_AUDIENCE_TYPE_ALL_USERS {
		t.Fatalf("audience_type = %v, want all users", resp.Msg.Notifications[0].AudienceType)
	}

	assertExpectations(t, mock)
}
