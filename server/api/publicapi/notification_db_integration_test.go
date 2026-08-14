package publicapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

func TestDBMemberNotificationsListUnreadAndMark(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	other := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Other")

	mine := insertTenantNotification(t, env, tenant.ID, member.ID, "episode_published", "episode:E001", `{"episode_id":"E001"}`)
	insertTenantNotification(t, env, tenant.ID, member.ID, "episode_published", "episode:E002", `{"episode_id":"E002"}`)
	insertTenantNotification(t, env, tenant.ID, other.ID, "episode_published", "episode:E003", `{"episode_id":"E003"}`)

	client := env.notificationClient()
	token := tokenFor(t, tenant, member)
	list, err := client.ListNotifications(context.Background(), newBearerRequest(&publirav1.ListNotificationsRequest{
		Tenant: tenantContext(tenant),
	}, token))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(list.Msg.Notifications) != 2 {
		t.Fatalf("list count = %d, want 2", len(list.Msg.Notifications))
	}
	if list.Msg.Notifications[0].NotificationType != "episode_published" {
		t.Fatalf("type = %q, want episode_published", list.Msg.Notifications[0].NotificationType)
	}
	if list.Msg.Notifications[0].Payload == "" || list.Msg.Notifications[0].Payload == "null" {
		t.Fatalf("payload = %q, want JSON object", list.Msg.Notifications[0].Payload)
	}
	if list.Msg.Notifications[0].IsRead {
		t.Fatal("first item is read, want unread")
	}

	unread, err := client.CountUnreadNotifications(context.Background(), newBearerRequest(&publirav1.CountUnreadNotificationsRequest{
		Tenant: tenantContext(tenant),
	}, token))
	if err != nil {
		t.Fatalf("CountUnreadNotifications: %v", err)
	}
	if unread.Msg.UnreadCount != 2 {
		t.Fatalf("unread = %d, want 2", unread.Msg.UnreadCount)
	}

	marked, err := client.MarkNotificationAsRead(context.Background(), newBearerRequest(&publirav1.MarkNotificationAsReadRequest{
		Tenant:         tenantContext(tenant),
		NotificationId: mine.String(),
	}, token))
	if err != nil {
		t.Fatalf("MarkNotificationAsRead: %v", err)
	}
	if !marked.Msg.Marked {
		t.Fatal("marked = false, want true")
	}

	unread, err = client.CountUnreadNotifications(context.Background(), newBearerRequest(&publirav1.CountUnreadNotificationsRequest{
		Tenant: tenantContext(tenant),
	}, token))
	if err != nil {
		t.Fatalf("CountUnreadNotifications after mark: %v", err)
	}
	if unread.Msg.UnreadCount != 1 {
		t.Fatalf("unread after mark = %d, want 1", unread.Msg.UnreadCount)
	}

	all, err := client.MarkAllNotificationsAsRead(context.Background(), newBearerRequest(&publirav1.MarkAllNotificationsAsReadRequest{
		Tenant: tenantContext(tenant),
	}, token))
	if err != nil {
		t.Fatalf("MarkAllNotificationsAsRead: %v", err)
	}
	if all.Msg.MarkedCount != 1 {
		t.Fatalf("marked_count = %d, want 1", all.Msg.MarkedCount)
	}
}

func TestDBMemberNotificationsHideOtherUsersTenantsAndPlatformRows(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)
	member := env.PG.SeedEndUser(t, first.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member A")
	other := env.PG.SeedEndUser(t, first.ID, "ENDUSERA0002", "other@tenant-a.example.com", "Other A")
	foreign := env.PG.SeedEndUser(t, second.ID, "ENDUSERB0001", "member@tenant-b.example.com", "Member B")
	operator := env.PG.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")

	mine := insertTenantNotification(t, env, first.ID, member.ID, "episode_published", "episode:mine", `{"episode_id":"mine"}`)
	theirs := insertTenantNotification(t, env, first.ID, other.ID, "episode_published", "episode:other", `{"episode_id":"other"}`)
	foreignID := insertTenantNotification(t, env, second.ID, foreign.ID, "episode_published", "episode:foreign", `{"episode_id":"foreign"}`)
	insertPlatformNotification(t, env, operator.ID, "episode_publish_failed", "episode:platform", `{"episode_id":"platform"}`)

	client := env.notificationClient()
	token := tokenFor(t, first, member)
	list, err := client.ListNotifications(context.Background(), newBearerRequest(&publirav1.ListNotificationsRequest{
		Tenant: tenantContext(first),
	}, token))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(list.Msg.Notifications) != 1 || list.Msg.Notifications[0].Id != mine.String() {
		t.Fatalf("list = %+v, want only %s", list.Msg.Notifications, mine)
	}

	_, err = client.MarkNotificationAsRead(context.Background(), newBearerRequest(&publirav1.MarkNotificationAsReadRequest{
		Tenant:         tenantContext(first),
		NotificationId: theirs.String(),
	}, token))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("mark other user code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	_, err = client.MarkNotificationAsRead(context.Background(), newBearerRequest(&publirav1.MarkNotificationAsReadRequest{
		Tenant:         tenantContext(first),
		NotificationId: foreignID.String(),
	}, token))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("mark other tenant code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBMemberNotificationsDoNotMixWithAnnouncements(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	insertTenantNotification(t, env, tenant.ID, member.ID, "episode_published", "episode:E001", `{"episode_id":"E001"}`)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	announcementID := uuid.Must(uuid.NewV7())
	if _, err := env.PG.DB.ExecContext(ctx, `
		INSERT INTO announcements (id, tenant_id, announcement_type, title, body)
		VALUES ($1, $2, 'announcement', 'お知らせ', '本文')
	`, announcementID, tenant.ID); err != nil {
		t.Fatalf("insert announcement: %v", err)
	}

	token := tokenFor(t, tenant, member)
	notifications, err := env.notificationClient().ListNotifications(context.Background(), newBearerRequest(&publirav1.ListNotificationsRequest{
		Tenant: tenantContext(tenant),
	}, token))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(notifications.Msg.Notifications) != 1 {
		t.Fatalf("notification count = %d, want 1", len(notifications.Msg.Notifications))
	}

	announcements, err := env.authClient().ListAnnouncements(context.Background(), newBearerRequest(&publirav1.ListAnnouncementsRequest{
		Tenant: tenantContext(tenant),
	}, token))
	if err != nil {
		t.Fatalf("ListAnnouncements: %v", err)
	}
	if len(announcements.Msg.Announcements) != 1 || announcements.Msg.Announcements[0].Id != announcementID.String() {
		t.Fatalf("announcements = %+v, want only the announcement row", announcements.Msg.Announcements)
	}
}

func insertTenantNotification(
	t *testing.T,
	env *publicDBEnv,
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

func insertPlatformNotification(
	t *testing.T,
	env *publicDBEnv,
	platformUserID uuid.UUID,
	notificationType, subjectKey, payload string,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	row, err := dbmodels.New(env.PG.DB).CreatePlatformNotification(ctx, dbmodels.CreatePlatformNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		PlatformUserID:   platformUserID,
		NotificationType: notificationType,
		SubjectKey:       subjectKey,
		Payload:          json.RawMessage(payload),
	})
	if err != nil {
		t.Fatalf("CreatePlatformNotification: %v", err)
	}
	return row.ID
}
