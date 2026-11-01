package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/push"
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

// A reader who turned both announcement push cells on, and registered a
// browser and a phone, receives the announcement on each, titled in the
// language they last read in. A reader who saved nothing receives none, on
// either platform, and an announcement sent to everyone does not turn the
// push on for them. The bell still records both readers.
func TestAnnouncementPushReachesOnlyAReaderWhoAskedForItInTheDatabase(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "ANNPUSH00001", "announcement-push.example.com", "Announcement Push Tenant")
	optedIn := pg.SeedEndUser(t, tenant.ID, "READERASK001", "asked@announcement-push.example.com", "Reader Who Asked")
	silent := pg.SeedEndUser(t, tenant.ID, "READERSIL001", "silent@announcement-push.example.com", "Reader Who Saved Nothing")
	if _, err := pg.DB.ExecContext(ctx, "UPDATE users SET last_locale = 'en' WHERE id = $1", optedIn.ID); err != nil {
		t.Fatalf("set last_locale: %v", err)
	}
	var defaultLocale string
	if err := pg.DB.QueryRowContext(ctx, "SELECT default_locale FROM tenants WHERE id = $1", tenant.ID).Scan(&defaultLocale); err != nil {
		t.Fatalf("read default locale: %v", err)
	}
	if defaultLocale == "en" {
		t.Fatal("the seeded tenant defaults to en, which would hide the title the reader's own locale picks")
	}

	queries := dbmodels.New(pg.DB)
	if _, err := queries.UpsertUserNotificationSettings(ctx, dbmodels.UpsertUserNotificationSettingsParams{
		TenantID:                       tenant.ID,
		UserID:                         optedIn.ID,
		AnnouncementsWebPushEnabled:    sql.NullBool{Bool: true, Valid: true},
		AnnouncementsMobilePushEnabled: sql.NullBool{Bool: true, Valid: true},
	}); err != nil {
		t.Fatalf("UpsertUserNotificationSettings: %v", err)
	}
	optedInWeb := registerAnnouncementPushDevice(t, ctx, pg.DB, tenant.ID, optedIn.ID, "asked-web", "web")
	optedInPhone := registerAnnouncementPushDevice(t, ctx, pg.DB, tenant.ID, optedIn.ID, "asked-phone", "android")
	silentWeb := registerAnnouncementPushDevice(t, ctx, pg.DB, tenant.ID, silent.ID, "silent-web", "web")
	silentPhone := registerAnnouncementPushDevice(t, ctx, pg.DB, tenant.ID, silent.ID, "silent-phone", "android")

	fcm := &stubPushSender{}
	web := &stubWebPushSender{}
	announce := NewAnnouncementNotificationHandler(AnnouncementNotificationHandlerConfig{DB: pg.DB})
	deliverPush := NewMemberPushNotificationHandler(PushHandlerConfig{DB: pg.DB, Sender: fcm, WebSender: web})

	deliver := func(delivery, englishTitle, defaultTitle, wantCategory string) {
		t.Helper()
		announcementID := insertAnnouncement(t, ctx, pg.DB, tenant.ID, defaultLocale, delivery, englishTitle, defaultTitle)
		if err := announce(ctx, announcementEvent(t, tenant.ID, announcementID)); err != nil {
			t.Fatalf("announcement handler: %v", err)
		}

		var pushEvents int
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM outbox_events WHERE event_type = $1 AND idempotency_key = $2",
			EventTypeAnnouncementPushNotification, AnnouncementPushIdempotencyKey(announcementID),
		).Scan(&pushEvents); err != nil {
			t.Fatalf("count announcement push events: %v", err)
		}
		if pushEvents != 1 {
			t.Fatalf("announcement_push_notification events = %d, want 1", pushEvents)
		}
		var memberPushes int
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM outbox_events WHERE tenant_id = $1 AND event_type = $2",
			tenant.ID, EventTypeMemberPushNotification,
		).Scan(&memberPushes); err != nil {
			t.Fatalf("count member push events: %v", err)
		}
		if memberPushes != 0 {
			t.Fatalf("member_push_notification events = %d, want 0", memberPushes)
		}
		var mails int
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM outbox_events WHERE event_type = $1 AND idempotency_key = $2",
			EventTypeNotificationEmail, NotificationEmailIdempotencyKey(tenant.ID, NotificationTypeAnnouncementPosted, AnnouncementSubjectKey(announcementID)),
		).Scan(&mails); err != nil {
			t.Fatalf("count queued mail: %v", err)
		}
		if mails != 1 {
			t.Fatalf("queued notification_email events = %d, want 1", mails)
		}

		rows := announcementNotificationRows(t, ctx, pg.DB, AnnouncementSubjectKey(announcementID))
		if len(rows) != 2 {
			t.Fatalf("notification rows = %d, want one per reader", len(rows))
		}
		optedInRow, ok := rows[optedIn.ID]
		if !ok {
			t.Fatal("the reader who asked has no notification row")
		}
		silentRow, ok := rows[silent.ID]
		if !ok {
			t.Fatal("the reader who saved nothing has no notification row")
		}
		if optedInRow.category != wantCategory || optedInRow.title != englishTitle {
			t.Fatalf("opted-in row = %s %q, want %s %q", optedInRow.category, optedInRow.title, wantCategory, englishTitle)
		}
		if silentRow.category != wantCategory || silentRow.title != defaultTitle {
			t.Fatalf("silent row = %s %q, want %s %q", silentRow.category, silentRow.title, wantCategory, defaultTitle)
		}

		var eventID uuid.UUID
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT id FROM outbox_events WHERE idempotency_key = $1",
			AnnouncementPushIdempotencyKey(announcementID),
		).Scan(&eventID); err != nil {
			t.Fatalf("read announcement push event: %v", err)
		}
		event, err := queries.GetOutboxEvent(ctx, eventID)
		if err != nil {
			t.Fatalf("GetOutboxEvent: %v", err)
		}
		beforePhone := len(fcmMessages(fcm, optedInPhone))
		beforeBrowser := len(webMessages(web, optedInWeb))
		if err := deliverPush(ctx, event); err != nil {
			t.Fatalf("push handler: %v", err)
		}
		phone := fcmMessages(fcm, optedInPhone)
		if len(phone) != beforePhone+1 {
			t.Fatalf("phone messages = %d, want %d", len(phone), beforePhone+1)
		}
		lastPhone := phone[len(phone)-1]
		assertAnnouncementPushMessage(t, lastPhone.Title, lastPhone.Body, lastPhone.Data, announcementID, optedInRow.id, englishTitle)
		browser := webMessages(web, optedInWeb)
		if len(browser) != beforeBrowser+1 {
			t.Fatalf("browser messages = %d, want %d", len(browser), beforeBrowser+1)
		}
		lastBrowser := browser[len(browser)-1]
		assertAnnouncementPushMessage(t, lastBrowser.Title, lastBrowser.Body, lastBrowser.Data, announcementID, optedInRow.id, englishTitle)
		if got := fcmMessages(fcm, silentPhone); len(got) != 0 {
			t.Fatalf("phone messages for the reader who saved nothing = %d, want 0", len(got))
		}
		if got := webMessages(web, silentWeb); len(got) != 0 {
			t.Fatalf("browser messages for the reader who saved nothing = %d, want 0", len(got))
		}
	}

	deliver(AnnouncementDeliveryPreferred, "Maintenance tonight", "Maintenance tonight (default)", string(NotificationCategoryAnnouncements))
	deliver(AnnouncementDeliveryEveryone, "Terms updated", "Terms updated (default)", string(NotificationCategoryEveryone))
}

func insertAnnouncement(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID, defaultLocale, delivery, englishTitle, defaultTitle string) uuid.UUID {
	t.Helper()
	announcementID := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO announcements (id, tenant_id, announcement_type, delivery)
		VALUES ($1, $2, 'announcement', $3)
	`, announcementID, tenantID, delivery); err != nil {
		t.Fatalf("insert announcement: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
		VALUES (uuidv7(), $1, $2, $3, $4, 'Body'),
			(uuidv7(), $1, $2, 'en', $5, 'Body')
	`, announcementID, tenantID, defaultLocale, defaultTitle, englishTitle); err != nil {
		t.Fatalf("insert announcement translations: %v", err)
	}
	return announcementID
}

func registerAnnouncementPushDevice(t *testing.T, ctx context.Context, db *sql.DB, tenantID, userID uuid.UUID, name, platform string) string {
	t.Helper()
	params := dbmodels.UpsertUserPushDeviceParams{
		TenantID: tenantID,
		UserID:   userID,
		Token:    name,
		Platform: platform,
	}
	if platform == "web" {
		params.Token = "https://push.example.com/" + name
		params.Endpoint = sql.NullString{String: params.Token, Valid: true}
		params.P256dh = sql.NullString{String: "p256dh-" + name, Valid: true}
		params.Auth = sql.NullString{String: "auth-" + name, Valid: true}
	}
	if _, err := dbmodels.New(db).UpsertUserPushDevice(ctx, params); err != nil {
		t.Fatalf("UpsertUserPushDevice: %v", err)
	}
	return params.Token
}

type announcementNotificationRow struct {
	id       uuid.UUID
	category string
	title    string
}

func announcementNotificationRows(t *testing.T, ctx context.Context, db *sql.DB, subjectKey string) map[uuid.UUID]announcementNotificationRow {
	t.Helper()
	rows, err := db.QueryContext(ctx,
		"SELECT id, user_id, category, payload FROM notifications WHERE notification_type = $1 AND subject_key = $2",
		NotificationTypeAnnouncementPosted, subjectKey,
	)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	got := map[uuid.UUID]announcementNotificationRow{}
	for rows.Next() {
		var (
			row    announcementNotificationRow
			userID uuid.UUID
			body   json.RawMessage
		)
		if err := rows.Scan(&row.id, &userID, &row.category, &body); err != nil {
			t.Fatalf("scan notification: %v", err)
		}
		var decoded announcementNotificationBody
		if err := json.Unmarshal(body, &decoded); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		row.title = decoded.AnnouncementTitle
		got[userID] = row
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate notifications: %v", err)
	}
	return got
}

func assertAnnouncementPushMessage(t *testing.T, title, body string, data map[string]string, announcementID, notificationID uuid.UUID, wantTitle string) {
	t.Helper()
	if title != wantTitle || body != "" {
		t.Fatalf("title/body = %q / %q, want %q / empty", title, body, wantTitle)
	}
	want := map[string]string{
		"notification_id":   notificationID.String(),
		"notification_type": NotificationTypeAnnouncementPosted,
		"announcement_id":   announcementID.String(),
		"route":             "/announcements/" + announcementID.String(),
	}
	if len(data) != len(want) {
		t.Fatalf("data = %v, want %v", data, want)
	}
	for key, value := range want {
		if data[key] != value {
			t.Fatalf("data[%q] = %q, want %q", key, data[key], value)
		}
	}
}

func fcmMessages(sender *stubPushSender, token string) []push.Message {
	sender.mu.Lock()
	defer sender.mu.Unlock()
	var found []push.Message
	for _, message := range sender.sent {
		if message.Token == token {
			found = append(found, message)
		}
	}
	return found
}

func webMessages(sender *stubWebPushSender, endpoint string) []push.WebPushMessage {
	sender.mu.Lock()
	defer sender.mu.Unlock()
	var found []push.WebPushMessage
	for _, sent := range sender.sent {
		if sent.subscription.Endpoint == endpoint {
			found = append(found, sent.message)
		}
	}
	return found
}
