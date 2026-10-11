package publicapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	publirav1connect "github.com/publira/publira/server/internal/proto/gen/publira/v1/publirav1connect"
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
	return publirav1connect.NewNotificationServiceClient(connect.NewClient(connecthttp.NewTransport(testServer.Client(), testServer.URL))), mock
}

func TestNotificationListSuccess(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	notificationID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListNotificationsForUserDesc)).
		WithArgs(userID, tenantID, sql.NullString{String: "web", Valid: true}, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnRows(addNotificationRow(notificationColumns(), notificationID, tenantID, userID, "episode_published", now, false))

	resp, err := client.ListNotifications(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(resp.Notifications) != 1 {
		t.Fatalf("count = %d, want 1", len(resp.Notifications))
	}
	if resp.Notifications[0].NotificationType != "episode_published" {
		t.Fatalf("type = %q", resp.Notifications[0].NotificationType)
	}
	if resp.Notifications[0].Payload != `{"episode_id":"E001"}` {
		t.Fatalf("payload = %q", resp.Notifications[0].Payload)
	}
	if resp.Notifications[0].IsRead {
		t.Fatal("is_read = true, want false")
	}

	assertPublicExpectations(t, mock)
}

func TestNotificationListDatabaseErrorIsHidden(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListNotificationsForUserDesc)).
		WithArgs(userID, tenantID, sql.NullString{String: "web", Valid: true}, uuid.NullUUID{}, false, sql.NullTime{}, int32(21)).
		WillReturnError(errors.New(`pq: relation "notifications" does not exist`))

	_, err := client.ListNotifications(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("ListNotifications code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want database details hidden", err)
	}
	assertPublicExpectations(t, mock)
}

func TestNotificationListInvalidToken(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	req := &publirav1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:  "not-a-token",
	}
	_, err := client.ListNotifications(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), req)
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

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CountUnreadNotificationsForUser)).
		WithArgs(tenantID, userID, sql.NullString{String: "web", Valid: true}).
		WillReturnRows(sqlmock.NewRows([]string{"unread_count"}).AddRow(int32(3)))

	resp, err := client.CountUnreadNotifications(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.CountUnreadNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("CountUnreadNotifications: %v", err)
	}
	if resp.UnreadCount != 3 {
		t.Fatalf("unread = %d, want 3", resp.UnreadCount)
	}

	assertPublicExpectations(t, mock)
}

func TestNotificationMarkAsReadNotFound(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	notificationID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.MarkNotificationAsRead)).
		WithArgs(userID, notificationID, tenantID).
		WillReturnError(sql.ErrNoRows)

	_, err := client.MarkNotificationAsRead(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.MarkNotificationAsReadRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		NotificationId: notificationID.String(),
	})
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

	_, err := client.MarkNotificationAsRead(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.MarkNotificationAsReadRequest{
		Tenant:         &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		NotificationId: "not-a-uuid",
	})
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

	mock.ExpectExec(regexp.QuoteMeta(dbmodels.MarkAllNotificationsAsRead)).
		WithArgs(userID, tenantID, sql.NullString{String: "web", Valid: true}).
		WillReturnResult(sqlmock.NewResult(0, 4))

	resp, err := client.MarkAllNotificationsAsRead(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.MarkAllNotificationsAsReadRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if err != nil {
		t.Fatalf("MarkAllNotificationsAsRead: %v", err)
	}
	if resp.MarkedCount != 4 {
		t.Fatalf("marked_count = %d, want 4", resp.MarkedCount)
	}

	assertPublicExpectations(t, mock)
}

func TestNotificationMarkAllAsReadRejectsOverflow(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	mock.ExpectExec(regexp.QuoteMeta(dbmodels.MarkAllNotificationsAsRead)).
		WithArgs(userID, tenantID, sql.NullString{String: "web", Valid: true}).
		WillReturnResult(sqlmock.NewResult(0, int64(math.MaxInt32)+1))

	_, err := client.MarkAllNotificationsAsRead(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.MarkAllNotificationsAsReadRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
	})
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("MarkAllNotificationsAsRead code = %v, want internal", connect.CodeOf(err))
	}
	if err.Error() != "internal: internal server error" {
		t.Fatalf("error = %q, want overflow hidden behind a fixed message", err)
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
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListNotificationsForUserDesc)).
		WithArgs(userID, tenantID, sql.NullString{String: "web", Valid: true}, uuid.NullUUID{}, false, sql.NullTime{}, int32(3)).
		WillReturnRows(rows)

	resp, err := client.ListNotifications(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.ListNotificationsRequest{
		Tenant: &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:  2,
	})
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(resp.Notifications) != 2 {
		t.Fatalf("count = %d, want 2", len(resp.Notifications))
	}
	if resp.NextToken == "" {
		t.Fatal("next_token is empty")
	}
	if _, err := pagination.Decode(resp.NextToken); err != nil {
		t.Fatalf("next_token decode: %v", err)
	}

	assertPublicExpectations(t, mock)
}

// The app reads the app's inbox, and the token it is handed names the app, so
// the site cannot page through it with that token.
func TestNotificationListNamesTheCallingSurface(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)
	ids := []uuid.UUID{uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())}

	rows := notificationColumns()
	for index, id := range ids {
		addNotificationRow(rows, id, tenantID, userID, "episode_published", now.Add(-time.Duration(index)*time.Minute), false)
	}
	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.ListNotificationsForUserDesc)).
		WithArgs(userID, tenantID, sql.NullString{String: "app", Valid: true}, uuid.NullUUID{}, false, sql.NullTime{}, int32(2)).
		WillReturnRows(rows)

	resp, err := client.ListNotifications(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.ListNotificationsRequest{
		Tenant:  &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Limit:   1,
		Surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_APP,
	})
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	next, err := pagination.Decode(resp.NextToken)
	if err != nil {
		t.Fatalf("next_token decode: %v", err)
	}
	if len(next.Keys) == 0 || next.Keys[0] != "surface:app" {
		t.Fatalf("next_token keys = %v, want the app surface first", next.Keys)
	}

	expectTenantLookup(mock, tenantID, "TENANT", now)
	expectAuthSession(mock, tenantID, userID, now)
	_, err = client.ListNotifications(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.ListNotificationsRequest{
		Tenant:  &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Token:   resp.NextToken,
		Surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB,
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("ListNotifications with the app's token on the site code = %v, want invalid_argument", connect.CodeOf(err))
	}

	assertPublicExpectations(t, mock)
}

func TestNotificationCountUnreadOnTheApp(t *testing.T) {
	tenantID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())
	now := time.Now().UTC().Truncate(time.Microsecond)
	client, mock := newNotificationClient(t, tenantID, userID, now)

	mock.ExpectQuery(regexp.QuoteMeta(dbmodels.CountUnreadNotificationsForUser)).
		WithArgs(tenantID, userID, sql.NullString{String: "app", Valid: true}).
		WillReturnRows(sqlmock.NewRows([]string{"unread_count"}).AddRow(int32(1)))

	resp, err := client.CountUnreadNotifications(testutil.WithBearer(context.Background(), issueTestPublicToken(tenantID.String())), &publirav1.CountUnreadNotificationsRequest{
		Tenant:  &publirattypesv1.TenantContext{TenantId: tenantID.String()},
		Surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_APP,
	})
	if err != nil {
		t.Fatalf("CountUnreadNotifications: %v", err)
	}
	if resp.UnreadCount != 1 {
		t.Fatalf("unread = %d, want 1", resp.UnreadCount)
	}

	assertPublicExpectations(t, mock)
}
