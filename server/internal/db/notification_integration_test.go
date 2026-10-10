package dbtest

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
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

	firstID := uuid.Must(uuid.NewV7())
	err := queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               firstID,
		TenantID:         tenantID,
		UserID:           userID,
		NotificationType: "episode_published",
		SubjectKey:       "episode:EPISODE0001",
		Payload:          json.RawMessage(`{"episode_id":"EPISODE0001"}`),
	})
	if err != nil {
		t.Fatalf("CreateNotification: %v", err)
	}

	err = queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
		ID:               uuid.Must(uuid.NewV7()),
		TenantID:         tenantID,
		UserID:           userID,
		NotificationType: "episode_published",
		SubjectKey:       "episode:EPISODE0001",
		Payload:          json.RawMessage(`{"episode_id":"EPISODE0001"}`),
	})
	if err != nil {
		t.Fatalf("duplicate CreateNotification: %v", err)
	}

	err = queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
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
	var published uuid.UUID
	if err := pg.DB.QueryRowContext(ctx, `SELECT id FROM notifications WHERE user_id = $1 AND notification_type = 'episode_published'`, userID).Scan(&published); err != nil {
		t.Fatalf("read episode_published notification: %v", err)
	}
	if published != firstID {
		t.Fatalf("episode_published notification id = %s, want the first insert's %s", published, firstID)
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

// A surface lists, counts, and marks the notifications shown on it — those
// filed for every surface and those filed for it alone — and the tenant
// console, which names no surface, reads every one.
func TestNotificationsAreListedCountedAndMarkedOnTheirSurface(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "NOTIFTENANT1", "notif.example.com", "admin-notif.example.com", "Notification Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "NOTIFUSER001", "notif-user@example.com", "Notification User")
	queries := dbmodels.New(pg.DB)

	idOf := map[string]uuid.UUID{}
	for _, availability := range []string{"", "web", "app"} {
		id := uuid.Must(uuid.NewV7())
		if err := queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
			ID:               id,
			TenantID:         tenantID,
			UserID:           userID,
			NotificationType: "episode_published",
			SubjectKey:       "episode:" + availability,
			Payload:          json.RawMessage(`{}`),
			Availability:     sql.NullString{String: availability, Valid: availability != ""},
		}); err != nil {
			t.Fatalf("CreateNotification %q: %v", availability, err)
		}
		idOf[availability] = id
	}

	web := sql.NullString{String: "web", Valid: true}
	app := sql.NullString{String: "app", Valid: true}
	for _, tc := range []struct {
		surface sql.NullString
		want    []uuid.UUID
	}{
		{web, []uuid.UUID{idOf["web"], idOf[""]}},
		{app, []uuid.UUID{idOf["app"], idOf[""]}},
		{sql.NullString{}, []uuid.UUID{idOf["app"], idOf["web"], idOf[""]}},
	} {
		desc, err := queries.ListNotificationsForUserDesc(ctx, dbmodels.ListNotificationsForUserDescParams{
			TenantID: tenantID,
			UserID:   userID,
			Surface:  tc.surface,
			Limit:    10,
		})
		if err != nil {
			t.Fatalf("ListNotificationsForUserDesc %q: %v", tc.surface.String, err)
		}
		if got := notificationDescIDs(desc); !slices.Equal(got, tc.want) {
			t.Fatalf("listed on %q = %v, want %v", tc.surface.String, got, tc.want)
		}
		asc, err := queries.ListNotificationsForUserAsc(ctx, dbmodels.ListNotificationsForUserAscParams{
			TenantID: tenantID,
			UserID:   userID,
			Surface:  tc.surface,
			Limit:    10,
		})
		if err != nil {
			t.Fatalf("ListNotificationsForUserAsc %q: %v", tc.surface.String, err)
		}
		backward := slices.Clone(tc.want)
		slices.Reverse(backward)
		if got := notificationAscIDs(asc); !slices.Equal(got, backward) {
			t.Fatalf("listed backward on %q = %v, want %v", tc.surface.String, got, backward)
		}

		unread, err := queries.CountUnreadNotificationsForUser(ctx, dbmodels.CountUnreadNotificationsForUserParams{
			TenantID: tenantID,
			UserID:   userID,
			Surface:  tc.surface,
		})
		if err != nil {
			t.Fatalf("CountUnreadNotificationsForUser %q: %v", tc.surface.String, err)
		}
		if int(unread) != len(tc.want) {
			t.Fatalf("unread on %q = %d, want %d", tc.surface.String, unread, len(tc.want))
		}
	}

	marked, err := queries.MarkAllNotificationsAsRead(ctx, dbmodels.MarkAllNotificationsAsReadParams{
		TenantID: tenantID,
		UserID:   userID,
		Surface:  app,
	})
	if err != nil {
		t.Fatalf("MarkAllNotificationsAsRead on the app: %v", err)
	}
	if marked != 2 {
		t.Fatalf("marked on the app = %d, want 2", marked)
	}
	unread, err := queries.CountUnreadNotificationsForUser(ctx, dbmodels.CountUnreadNotificationsForUserParams{
		TenantID: tenantID,
		UserID:   userID,
		Surface:  web,
	})
	if err != nil {
		t.Fatalf("CountUnreadNotificationsForUser on the site: %v", err)
	}
	if unread != 1 {
		t.Fatalf("unread on the site after the app marked all = %d, want 1, the site's own", unread)
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

	err := queries.CreateNotification(ctx, dbmodels.CreateNotificationParams{
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
