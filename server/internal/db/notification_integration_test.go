package dbmodels_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/testutil"
)

func TestCreateNotificationIgnoresDuplicateSubject(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "NOTIFTENANT1", "notif.example.com", "admin-notif.example.com", "Notification Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER001", "notif-user@example.com", "Notification User")
	queries := dbmodels.New(pg.DB)

	first, err := queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		TenantID:         tenantID,
		UserID:           userID,
		NotificationType: "episode_published",
		SubjectKey:       "episode:EPISODE0001",
		Payload:          json.RawMessage(`{"episode_id":"EPISODE0001"}`),
	})
	if err != nil {
		t.Fatalf("CreateNotification: %v", err)
	}

	_, err = queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		TenantID:         tenantID,
		UserID:           userID,
		NotificationType: "episode_published",
		SubjectKey:       "episode:EPISODE0001",
		Payload:          json.RawMessage(`{"episode_id":"EPISODE0001"}`),
	})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("duplicate CreateNotification error = %v, want sql.ErrNoRows", err)
	}

	_, err = queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		TenantID:         tenantID,
		UserID:           userID,
		NotificationType: "episode_publish_failed",
		SubjectKey:       "episode:EPISODE0001",
		Payload:          json.RawMessage(`{"episode_id":"EPISODE0001"}`),
	})
	if err != nil {
		t.Fatalf("CreateNotification different type: %v", err)
	}

	var count int
	if err := pg.DB.QueryRowContext(ctx, `SELECT count(*) FROM notifications WHERE user_id = $1`, userID).Scan(&count); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if count != 2 {
		t.Fatalf("notification count = %d, want 2", count)
	}
	if first.NotificationType != "episode_published" {
		t.Fatalf("first type = %q", first.NotificationType)
	}
}

func TestCreatePlatformNotificationIgnoresDuplicateSubject(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	queries := dbmodels.New(pg.DB)

	if _, err := queries.CreatePlatformNotification(ctx, dbmodels.CreatePlatformNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		PlatformUserID:   operator.ID,
		NotificationType: "episode_publish_failed",
		SubjectKey:       "episode:EPISODE0001",
		Payload:          json.RawMessage(`{"episode_id":"EPISODE0001"}`),
	}); err != nil {
		t.Fatalf("CreatePlatformNotification: %v", err)
	}

	_, err := queries.CreatePlatformNotification(ctx, dbmodels.CreatePlatformNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		PlatformUserID:   operator.ID,
		NotificationType: "episode_publish_failed",
		SubjectKey:       "episode:EPISODE0001",
		Payload:          json.RawMessage(`{"episode_id":"EPISODE0001"}`),
	})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("duplicate CreatePlatformNotification error = %v, want sql.ErrNoRows", err)
	}
}

func TestListNotificationsForUserPaginatesBothDirections(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "NOTIFTENANT1", "notif.example.com", "admin-notif.example.com", "Notification Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER001", "notif-user@example.com", "Notification User")
	otherUserID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER002", "notif-other@example.com", "Other User")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	ids := make([]uuid.UUID, 4)
	for index := range ids {
		ids[index] = mustInsertNotification(t, ctx, pg.DB, tenantID, userID, "episode_published", uniqueSubject(index), createdAt.Add(-time.Duration(index)*time.Minute))
	}
	mustInsertNotification(t, ctx, pg.DB, tenantID, otherUserID, "episode_published", "episode:other", createdAt.Add(-30*time.Second))

	queries := dbmodels.New(pg.DB)
	firstPage, err := queries.ListNotificationsForUserDesc(ctx, dbmodels.ListNotificationsForUserDescParams{
		TenantID: tenantID,
		UserID:   userID,
		Limit:    2,
	})
	if err != nil {
		t.Fatalf("ListNotificationsForUserDesc first page: %v", err)
	}
	if got := notificationDescIDs(firstPage); !slices.Equal(got, ids[:2]) {
		t.Fatalf("first page IDs = %v, want %v", got, ids[:2])
	}

	secondPage, err := queries.ListNotificationsForUserDesc(ctx, dbmodels.ListNotificationsForUserDescParams{
		TenantID:        tenantID,
		UserID:          userID,
		CursorID:        uuid.NullUUID{UUID: firstPage[1].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: firstPage[1].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListNotificationsForUserDesc second page: %v", err)
	}
	if got := notificationDescIDs(secondPage); !slices.Equal(got, ids[2:]) {
		t.Fatalf("second page IDs = %v, want %v", got, ids[2:])
	}

	previousPage, err := queries.ListNotificationsForUserAsc(ctx, dbmodels.ListNotificationsForUserAscParams{
		TenantID:        tenantID,
		UserID:          userID,
		CursorID:        uuid.NullUUID{UUID: secondPage[0].ID, Valid: true},
		CursorCreatedAt: sql.NullTime{Time: secondPage[0].CreatedAt, Valid: true},
		Limit:           2,
	})
	if err != nil {
		t.Fatalf("ListNotificationsForUserAsc previous page: %v", err)
	}
	if got := notificationAscIDs(previousPage); !slices.Equal(got, []uuid.UUID{ids[1], ids[0]}) {
		t.Fatalf("previous page IDs = %v, want [%s %s]", got, ids[1], ids[0])
	}
}

func TestCountAndMarkNotificationsForUser(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "NOTIFTENANT1", "notif.example.com", "admin-notif.example.com", "Notification Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER001", "notif-user@example.com", "Notification User")
	otherID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER002", "notif-other@example.com", "Other User")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	mine := mustInsertNotification(t, ctx, pg.DB, tenantID, userID, "episode_published", "episode:mine", createdAt)
	mustInsertNotification(t, ctx, pg.DB, tenantID, userID, "episode_published", "episode:mine2", createdAt.Add(-time.Minute))
	theirs := mustInsertNotification(t, ctx, pg.DB, tenantID, otherID, "episode_published", "episode:theirs", createdAt)

	queries := dbmodels.New(pg.DB)
	unread, err := queries.CountUnreadNotificationsForUser(ctx, dbmodels.CountUnreadNotificationsForUserParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("CountUnreadNotificationsForUser: %v", err)
	}
	if unread != 2 {
		t.Fatalf("unread = %d, want 2", unread)
	}

	if _, err := queries.MarkNotificationAsRead(ctx, dbmodels.MarkNotificationAsReadParams{
		ID:       mine,
		TenantID: tenantID,
		UserID:   userID,
	}); err != nil {
		t.Fatalf("MarkNotificationAsRead: %v", err)
	}

	_, err = queries.MarkNotificationAsRead(ctx, dbmodels.MarkNotificationAsReadParams{
		ID:       theirs,
		TenantID: tenantID,
		UserID:   userID,
	})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("MarkNotificationAsRead other user error = %v, want sql.ErrNoRows", err)
	}

	unread, err = queries.CountUnreadNotificationsForUser(ctx, dbmodels.CountUnreadNotificationsForUserParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("CountUnreadNotificationsForUser after mark: %v", err)
	}
	if unread != 1 {
		t.Fatalf("unread after one mark = %d, want 1", unread)
	}

	marked, err := queries.MarkAllNotificationsAsRead(ctx, dbmodels.MarkAllNotificationsAsReadParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("MarkAllNotificationsAsRead: %v", err)
	}
	if marked != 1 {
		t.Fatalf("marked_count = %d, want 1", marked)
	}

	unread, err = queries.CountUnreadNotificationsForUser(ctx, dbmodels.CountUnreadNotificationsForUserParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("CountUnreadNotificationsForUser after mark all: %v", err)
	}
	if unread != 0 {
		t.Fatalf("unread after mark all = %d, want 0", unread)
	}
}

func TestMarkNotificationAsReadKeepsFirstReadAt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "NOTIFTENANT1", "notif.example.com", "admin-notif.example.com", "Notification Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER001", "notif-user@example.com", "Notification User")
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	id := mustInsertNotification(t, ctx, pg.DB, tenantID, userID, "episode_published", "episode:mine", createdAt)
	queries := dbmodels.New(pg.DB)

	if _, err := queries.MarkNotificationAsRead(ctx, dbmodels.MarkNotificationAsReadParams{
		ID:       id,
		TenantID: tenantID,
		UserID:   userID,
	}); err != nil {
		t.Fatalf("MarkNotificationAsRead first: %v", err)
	}

	firstReadAt := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE notification_reads SET read_at = $1 WHERE notification_id = $2 AND user_id = $3
	`, firstReadAt, id, userID); err != nil {
		t.Fatalf("set first read_at: %v", err)
	}

	second, err := queries.MarkNotificationAsRead(ctx, dbmodels.MarkNotificationAsReadParams{
		ID:       id,
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("MarkNotificationAsRead second: %v", err)
	}
	if !second.ReadAt.UTC().Equal(firstReadAt) {
		t.Fatalf("read_at = %s, want first value %s", second.ReadAt.UTC(), firstReadAt)
	}
}

func TestMarkPlatformNotificationAsReadKeepsFirstReadAt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	queries := dbmodels.New(pg.DB)
	row, err := queries.CreatePlatformNotification(ctx, dbmodels.CreatePlatformNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		PlatformUserID:   operator.ID,
		NotificationType: "episode_publish_failed",
		SubjectKey:       "episode:E001",
		Payload:          json.RawMessage(`{"episode_id":"E001"}`),
	})
	if err != nil {
		t.Fatalf("CreatePlatformNotification: %v", err)
	}

	if _, err := queries.MarkPlatformNotificationAsRead(ctx, dbmodels.MarkPlatformNotificationAsReadParams{
		ID:             row.ID,
		PlatformUserID: operator.ID,
	}); err != nil {
		t.Fatalf("MarkPlatformNotificationAsRead first: %v", err)
	}

	firstReadAt := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	if _, err := pg.DB.ExecContext(ctx, `
		UPDATE platform_notification_reads SET read_at = $1
		WHERE platform_notification_id = $2 AND platform_user_id = $3
	`, firstReadAt, row.ID, operator.ID); err != nil {
		t.Fatalf("set first read_at: %v", err)
	}

	second, err := queries.MarkPlatformNotificationAsRead(ctx, dbmodels.MarkPlatformNotificationAsReadParams{
		ID:             row.ID,
		PlatformUserID: operator.ID,
	})
	if err != nil {
		t.Fatalf("MarkPlatformNotificationAsRead second: %v", err)
	}
	if !second.ReadAt.UTC().Equal(firstReadAt) {
		t.Fatalf("read_at = %s, want first value %s", second.ReadAt.UTC(), firstReadAt)
	}
}

func TestNotificationPayloadMustBeObject(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "NOTIFTENANT1", "notif.example.com", "admin-notif.example.com", "Notification Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER001", "notif-user@example.com", "Notification User")
	operator := pg.SeedPlatformOperator(t, "PLATUSER001", "platform@example.com", "Platform Operator")
	queries := dbmodels.New(pg.DB)

	_, err := queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		TenantID:         tenantID,
		UserID:           userID,
		NotificationType: "episode_published",
		SubjectKey:       "episode:array",
		Payload:          json.RawMessage(`["not-an-object"]`),
	})
	if err == nil {
		t.Fatal("CreateNotification accepted a JSON array payload")
	}

	_, err = queries.CreatePlatformNotification(ctx, dbmodels.CreatePlatformNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		PlatformUserID:   operator.ID,
		NotificationType: "episode_publish_failed",
		SubjectKey:       "episode:scalar",
		Payload:          json.RawMessage(`"not-an-object"`),
	})
	if err == nil {
		t.Fatal("CreatePlatformNotification accepted a JSON scalar payload")
	}
}

func uniqueSubject(index int) string {
	return "episode:EPISODE000" + string(rune('1'+index))
}

func mustInsertNotification(
	t *testing.T,
	ctx context.Context,
	db *sql.DB,
	tenantID, userID uuid.UUID,
	notificationType, subjectKey string,
	createdAt time.Time,
) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	_, err := db.ExecContext(ctx, `
		INSERT INTO notifications (
			id, tenant_id, user_id, notification_type, subject_key, payload, created_at
		) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6)
	`, id, tenantID, userID, notificationType, subjectKey, createdAt)
	if err != nil {
		t.Fatalf("insert notification: %v", err)
	}
	return id
}

func notificationDescIDs(rows []dbmodels.ListNotificationsForUserDescRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}

func notificationAscIDs(rows []dbmodels.ListNotificationsForUserAscRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids
}
