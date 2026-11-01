package outbox

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// An announcement written in two languages reaches each reader in the one their
// last locale picks: English for a reader who last read in English, and the
// tenant default locale's for a reader who never named a locale or last read
// in one the announcement was not written in.
func TestAnnouncementNotificationReachesEachReaderInTheirLocaleInTheDatabase(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "ANNLOCALE001", "announcement-locale.example.com", "Announcement Locale Tenant")
	english := pg.SeedEndUser(t, tenant.ID, "READERLOC001", "english@announcement-locale.example.com", "English Reader")
	unknown := pg.SeedEndUser(t, tenant.ID, "READERLOC002", "unknown@announcement-locale.example.com", "Reader With No Locale")
	korean := pg.SeedEndUser(t, tenant.ID, "READERLOC003", "korean@announcement-locale.example.com", "Korean Reader")
	for userID, locale := range map[uuid.UUID]string{english.ID: "en", korean.ID: "ko"} {
		if _, err := pg.DB.ExecContext(ctx, "UPDATE users SET last_locale = $2 WHERE id = $1", userID, locale); err != nil {
			t.Fatalf("set last_locale: %v", err)
		}
	}

	var defaultLocale string
	if err := pg.DB.QueryRowContext(ctx, "SELECT default_locale FROM tenants WHERE id = $1", tenant.ID).Scan(&defaultLocale); err != nil {
		t.Fatalf("read default locale: %v", err)
	}
	if defaultLocale == "en" {
		t.Fatal("the seeded tenant defaults to en, which would hide the fallback this test is about")
	}

	announcementID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO announcements (id, tenant_id, announcement_type) VALUES ($1, $2, 'announcement')
	`, announcementID, tenant.ID); err != nil {
		t.Fatalf("insert announcement: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
		VALUES (uuidv7(), $1, $2, $3, 'Maintenance tonight (default)', 'The site closes at 2:00.'),
			(uuidv7(), $1, $2, 'en', 'Maintenance tonight', 'The site closes at 2:00.')
	`, announcementID, tenant.ID, defaultLocale); err != nil {
		t.Fatalf("insert announcement translations: %v", err)
	}

	handler := NewAnnouncementNotificationHandler(AnnouncementNotificationHandlerConfig{DB: pg.DB})
	if err := handler(ctx, announcementEvent(t, tenant.ID, announcementID)); err != nil {
		t.Fatalf("handler: %v", err)
	}

	rows, err := pg.DB.QueryContext(ctx,
		"SELECT user_id, payload FROM notifications WHERE notification_type = $1 AND subject_key = $2",
		NotificationTypeAnnouncementPosted, AnnouncementSubjectKey(announcementID),
	)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	got := map[uuid.UUID]string{}
	for rows.Next() {
		var (
			userID uuid.UUID
			body   json.RawMessage
		)
		if err := rows.Scan(&userID, &body); err != nil {
			t.Fatalf("scan notification: %v", err)
		}
		var decoded announcementNotificationBody
		if err := json.Unmarshal(body, &decoded); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		got[userID] = decoded.AnnouncementTitle
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate notifications: %v", err)
	}

	want := map[uuid.UUID]string{
		english.ID: "Maintenance tonight",
		unknown.ID: "Maintenance tonight (default)",
		korean.ID:  "Maintenance tonight (default)",
	}
	if len(got) != len(want) {
		t.Fatalf("notifications = %v, want one per reader %v", got, want)
	}
	for userID, title := range want {
		if got[userID] != title {
			t.Fatalf("notification for %s titled %q, want %q", userID, got[userID], title)
		}
	}
}

// A reader an earlier attempt wrote a row for, who no longer meets the audience
// when the event is retried, is still mailed: the retry finds nobody to write a
// row for, and queues the mail for the row that is there.
func TestTargetedAnnouncementRetryQueuesTheMailOfAnEarlierAttemptInTheDatabase(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "ANNRETRY0001", "announcement-retry.example.com", "Announcement Retry Tenant")
	reader := pg.SeedEndUser(t, tenant.ID, "READERRET001", "reader@announcement-retry.example.com", "Reader")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "RETRYSERIES1", Title: "Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "RETRYEPISOD1", Title: "Episode", Price: 100, Status: testutil.EpisodeStatusPublished})

	announcementID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO announcements (id, tenant_id, announcement_type, audience)
		VALUES ($1, $2, 'announcement', '{"version": 1, "conditions": [{"type": "never_purchased"}]}')
	`, announcementID, tenant.ID); err != nil {
		t.Fatalf("insert announcement: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
		SELECT uuidv7(), $1, t.id, t.default_locale, 'For readers yet to buy', 'Body'
		FROM tenants t
		WHERE t.id = $2
	`, announcementID, tenant.ID); err != nil {
		t.Fatalf("insert announcement translation: %v", err)
	}
	// The row the earlier attempt wrote before it failed short of the mail.
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO notifications (id, tenant_id, user_id, notification_type, subject_key, payload, category)
		VALUES (uuidv7(), $1, $2, $3, $4, '{}', 'announcements')
	`, tenant.ID, reader.ID, NotificationTypeAnnouncementPosted, AnnouncementSubjectKey(announcementID)); err != nil {
		t.Fatalf("insert notification: %v", err)
	}
	pg.SeedPurchase(t, tenant.ID, reader.ID, episode.ID, 100)

	handler := NewAnnouncementNotificationHandler(AnnouncementNotificationHandlerConfig{DB: pg.DB})
	if err := handler(ctx, announcementEvent(t, tenant.ID, announcementID)); err != nil {
		t.Fatalf("handler: %v", err)
	}

	var queued int
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM outbox_events WHERE event_type = $1 AND idempotency_key = $2",
		EventTypeNotificationEmail, NotificationEmailIdempotencyKey(tenant.ID, NotificationTypeAnnouncementPosted, AnnouncementSubjectKey(announcementID)),
	).Scan(&queued); err != nil {
		t.Fatalf("count queued mail: %v", err)
	}
	if queued != 1 {
		t.Fatalf("queued notification_email events = %d, want 1", queued)
	}
}
