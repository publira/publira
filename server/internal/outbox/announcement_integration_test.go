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
