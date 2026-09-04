package platformapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/gen/publira/platform/v1"
	publirasplatformv1connect "github.com/publira/publira/server/gen/publira/platform/v1/publirasplatformv1connect"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBPlatformNotificationsListUnreadAndMark(t *testing.T) {
	server, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	other := pg.SeedPlatformOperator(t, "PLATUSER002", "other@example.com", "Other Operator")

	mine := insertOperatorNotification(t, pg, operator.ID, "episode_publish_failed", "episode:E001", `{"episode_id":"E001"}`)
	insertOperatorNotification(t, pg, operator.ID, "episode_publish_failed", "episode:E002", `{"episode_id":"E002"}`)
	insertOperatorNotification(t, pg, other.ID, "episode_publish_failed", "episode:E003", `{"episode_id":"E003"}`)

	client := publirasplatformv1connect.NewPlatformNotificationServiceClient(server.Client(), server.URL)
	list, err := client.ListNotifications(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ListNotificationsRequest{}))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(list.Msg.Notifications) != 2 {
		t.Fatalf("list count = %d, want 2", len(list.Msg.Notifications))
	}

	unread, err := client.CountUnreadNotifications(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CountUnreadNotificationsRequest{}))
	if err != nil {
		t.Fatalf("CountUnreadNotifications: %v", err)
	}
	if unread.Msg.UnreadCount != 2 {
		t.Fatalf("unread = %d, want 2", unread.Msg.UnreadCount)
	}

	if _, err := client.MarkNotificationAsRead(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.MarkNotificationAsReadRequest{
		NotificationId: mine.String(),
	})); err != nil {
		t.Fatalf("MarkNotificationAsRead: %v", err)
	}

	unread, err = client.CountUnreadNotifications(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.CountUnreadNotificationsRequest{}))
	if err != nil {
		t.Fatalf("CountUnreadNotifications after mark: %v", err)
	}
	if unread.Msg.UnreadCount != 1 {
		t.Fatalf("unread after mark = %d, want 1", unread.Msg.UnreadCount)
	}

	all, err := client.MarkAllNotificationsAsRead(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.MarkAllNotificationsAsReadRequest{}))
	if err != nil {
		t.Fatalf("MarkAllNotificationsAsRead: %v", err)
	}
	if all.Msg.MarkedCount != 1 {
		t.Fatalf("marked_count = %d, want 1", all.Msg.MarkedCount)
	}
}

func TestDBPlatformNotificationsHideOtherOperatorsAndTenantRows(t *testing.T) {
	server, pg := newDBIntegrationEnv(t)
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	other := pg.SeedPlatformOperator(t, "PLATUSER002", "other@example.com", "Other Operator")
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	member := pg.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")

	mine := insertOperatorNotification(t, pg, operator.ID, "episode_publish_failed", "episode:mine", `{"episode_id":"mine"}`)
	theirs := insertOperatorNotification(t, pg, other.ID, "episode_publish_failed", "episode:theirs", `{"episode_id":"theirs"}`)
	memberRow := insertTenantNotificationForPlatformTest(t, pg, tenant.ID, member.ID, "episode_published", "episode:member", `{"episode_id":"member"}`)

	client := publirasplatformv1connect.NewPlatformNotificationServiceClient(server.Client(), server.URL)
	list, err := client.ListNotifications(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.ListNotificationsRequest{}))
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(list.Msg.Notifications) != 1 || list.Msg.Notifications[0].Id != mine.String() {
		t.Fatalf("list = %+v, want only %s", list.Msg.Notifications, mine)
	}

	_, err = client.MarkNotificationAsRead(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.MarkNotificationAsReadRequest{
		NotificationId: theirs.String(),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("mark other operator code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}

	_, err = client.MarkNotificationAsRead(context.Background(), newDBAuthedRequest(operator, publirasplatformv1.MarkNotificationAsReadRequest{
		NotificationId: memberRow.String(),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("mark tenant notification code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func insertOperatorNotification(
	t *testing.T,
	pg *testutil.PostgresEnv,
	platformUserID uuid.UUID,
	notificationType, subjectKey, payload string,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	row, err := dbmodels.New(pg.DB).CreatePlatformNotification(ctx, dbmodels.CreatePlatformNotificationParams{
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

func insertTenantNotificationForPlatformTest(
	t *testing.T,
	pg *testutil.PostgresEnv,
	tenantID, userID uuid.UUID,
	notificationType, subjectKey, payload string,
) uuid.UUID {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	row, err := dbmodels.New(pg.DB).CreateNotification(ctx, dbmodels.CreateNotificationParams{
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
