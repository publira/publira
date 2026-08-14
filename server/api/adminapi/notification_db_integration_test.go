package adminapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
)

func TestDBAdminNotificationsListUnreadAndMark(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "ADMINA000001", "admin@tenant-a.example.com")
	otherAdmin := env.PG.SeedTenantAdmin(t, admin.Tenant.ID, "ADMINA000002", "other-admin@tenant-a.example.com", "Other Admin")

	mine := insertAdminNotification(t, env, admin.Tenant.ID, admin.User.ID, "episode_published", "episode:E001", `{"episode_id":"E001"}`)
	insertAdminNotification(t, env, admin.Tenant.ID, admin.User.ID, "episode_publish_failed", "episode:E002", `{"episode_id":"E002"}`)
	insertAdminNotification(t, env, admin.Tenant.ID, otherAdmin.ID, "episode_published", "episode:E003", `{"episode_id":"E003"}`)

	client := env.notificationClient()
	list, err := client.ListNotifications(context.Background(), newAdminDBRequest(admin, &publiraadminv1.ListNotificationsRequest{
		Tenant: admin.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(list.Msg.Notifications) != 2 {
		t.Fatalf("list count = %d, want 2", len(list.Msg.Notifications))
	}

	unread, err := client.CountUnreadNotifications(context.Background(), newAdminDBRequest(admin, &publiraadminv1.CountUnreadNotificationsRequest{
		Tenant: admin.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("CountUnreadNotifications: %v", err)
	}
	if unread.Msg.UnreadCount != 2 {
		t.Fatalf("unread = %d, want 2", unread.Msg.UnreadCount)
	}

	if _, err := client.MarkNotificationAsRead(context.Background(), newAdminDBRequest(admin, &publiraadminv1.MarkNotificationAsReadRequest{
		Tenant:         admin.tenantContext(),
		NotificationId: mine.String(),
	})); err != nil {
		t.Fatalf("MarkNotificationAsRead: %v", err)
	}

	unread, err = client.CountUnreadNotifications(context.Background(), newAdminDBRequest(admin, &publiraadminv1.CountUnreadNotificationsRequest{
		Tenant: admin.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("CountUnreadNotifications after mark: %v", err)
	}
	if unread.Msg.UnreadCount != 1 {
		t.Fatalf("unread after mark = %d, want 1", unread.Msg.UnreadCount)
	}

	all, err := client.MarkAllNotificationsAsRead(context.Background(), newAdminDBRequest(admin, &publiraadminv1.MarkAllNotificationsAsReadRequest{
		Tenant: admin.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("MarkAllNotificationsAsRead: %v", err)
	}
	if all.Msg.MarkedCount != 1 {
		t.Fatalf("marked_count = %d, want 1", all.Msg.MarkedCount)
	}
}

func TestDBAdminNotificationsHideOtherTenantAndUserRows(t *testing.T) {
	env := newAdminDBEnv(t)
	first := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "ADMINA000001", "admin@tenant-a.example.com")
	second := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "ADMINB000001", "admin@tenant-b.example.com")
	peer := env.PG.SeedTenantAdmin(t, first.Tenant.ID, "ADMINA000002", "peer@tenant-a.example.com", "Peer Admin")
	member := env.PG.SeedEndUser(t, first.Tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	mine := insertAdminNotification(t, env, first.Tenant.ID, first.User.ID, "episode_published", "episode:mine", `{"episode_id":"mine"}`)
	peerID := insertAdminNotification(t, env, first.Tenant.ID, peer.ID, "episode_published", "episode:peer", `{"episode_id":"peer"}`)
	theirs := insertAdminNotification(t, env, second.Tenant.ID, second.User.ID, "episode_published", "episode:theirs", `{"episode_id":"theirs"}`)
	insertAdminNotification(t, env, first.Tenant.ID, member.ID, "episode_published", "episode:member", `{"episode_id":"member"}`)

	client := env.notificationClient()
	list, err := client.ListNotifications(context.Background(), newAdminDBRequest(first, &publiraadminv1.ListNotificationsRequest{
		Tenant: first.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(list.Msg.Notifications) != 1 || list.Msg.Notifications[0].Id != mine.String() {
		t.Fatalf("list = %+v, want only %s", list.Msg.Notifications, mine)
	}

	_, err = client.MarkNotificationAsRead(context.Background(), newAdminDBRequest(first, &publiraadminv1.MarkNotificationAsReadRequest{
		Tenant:         first.tenantContext(),
		NotificationId: peerID.String(),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("mark peer code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	_, err = client.MarkNotificationAsRead(context.Background(), newAdminDBRequest(first, &publiraadminv1.MarkNotificationAsReadRequest{
		Tenant:         first.tenantContext(),
		NotificationId: theirs.String(),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("mark other tenant code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBAdminNotificationsRequireTenantAdmin(t *testing.T) {
	env := newAdminDBEnv(t)
	admin := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "ADMINA000001", "admin@tenant-a.example.com")
	editor := env.PG.SeedTenantUser(t, admin.Tenant.ID, "EDITORA00001", "editor@tenant-a.example.com", "Editor", auth.RoleTenantEditor)
	insertAdminNotification(t, env, admin.Tenant.ID, editor.ID, "episode_published", "episode:editor", `{"episode_id":"editor"}`)

	_, err := env.notificationClient().ListNotifications(context.Background(), newAdminDBRequest(admin.as(editor), &publiraadminv1.ListNotificationsRequest{
		Tenant: admin.tenantContext(),
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("ListNotifications as editor code = %v, want permission_denied (err=%v)", connect.CodeOf(err), err)
	}
}

func insertAdminNotification(
	t *testing.T,
	env *adminDBEnv,
	tenantID, userID uuid.UUID,
	notificationType, subjectKey, payload string,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	row, err := dbmodels.New(env.PG.DB).CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		TenantID:         tenantID,
		UserID:           userID,
		NotificationType: notificationType,
		SubjectKey:       subjectKey,
		Payload:          json.RawMessage(payload),
	})
	if err != nil {
		t.Fatalf("CreateNotification: %v", err)
	}
	return row.ID
}
