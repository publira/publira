package dbtest

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// announcement_translation_for picks the asked locale's translation, then the
// tenant default locale's, then the oldest, as page_translation_for does, so an
// announcement keeps its copy after its tenant moves to a default locale none
// of it is in.
func TestAnnouncementTranslationForFallsBackToTheDefaultThenTheOldest(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	announcementID := mustInsertUntranslatedAnnouncement(t, ctx, pg.DB, tenant.ID)
	// The default locale's translation is written first and the en one after
	// it, so the oldest is the ja one until it is deleted.
	mustExec(t, ctx, pg.DB, `
		INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body, created_at)
		VALUES (uuidv7(), $1, $2, 'ja', 'Maintenance tonight (ja)', 'The site closes at 2:00.', now() - interval '1 minute'),
			(uuidv7(), $1, $2, 'en', 'Maintenance tonight', 'The site closes at 2:00.', now())
	`, announcementID, tenant.ID)

	expect := func(step, locale, want string) {
		t.Helper()
		var title string
		err := pg.DB.QueryRowContext(ctx, `
			SELECT at.title FROM announcement_translation_for($1, $2) at
		`, announcementID, locale).Scan(&title)
		if err != nil {
			t.Fatalf("%s: announcement_translation_for(%q): %v", step, locale, err)
		}
		if title != want {
			t.Fatalf("%s: title for %q = %q, want %q", step, locale, title, want)
		}
	}

	expect("asked locale", "en", "Maintenance tonight")
	expect("default locale", "ko", "Maintenance tonight (ja)")
	expect("no locale", "", "Maintenance tonight (ja)")

	mustExec(t, ctx, pg.DB, `UPDATE tenants SET default_locale = 'ko' WHERE id = $1`, tenant.ID)
	expect("oldest after the default moved", "zh-Hans", "Maintenance tonight (ja)")

	mustExec(t, ctx, pg.DB, `DELETE FROM announcement_translations WHERE announcement_id = $1 AND locale = 'ja'`, announcementID)
	expect("oldest left", "zh-Hans", "Maintenance tonight")
}

// The announcement fan-out walks ListAnnouncementRecipients one page at a time
// and writes a notification per row, so a page that repeated or skipped a
// reader would leave someone told twice or not at all. Each row carries the
// title the reader's last locale picks: their own language where the
// announcement was written in it, and the tenant default locale's otherwise.
func TestListAnnouncementRecipientsWalksEveryUserOnceInTheirLocale(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "FANOUTTNT001", "fanout.example.com", "admin-fanout.example.com", "Fanout Tenant")
	otherTenantID := mustInsertTenant(t, ctx, pg.DB, "FANOUTTNT002", "other-fanout.example.com", "admin-other-fanout.example.com", "Other Fanout Tenant")
	mustExec(t, ctx, pg.DB, `UPDATE tenants SET default_locale = 'ja', supported_locales = '{ja,en}' WHERE id = $1`, tenantID)

	announcementID := mustInsertUntranslatedAnnouncement(t, ctx, pg.DB, tenantID)
	mustExec(t, ctx, pg.DB, `
		INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
		VALUES (uuidv7(), $1, $2, 'ja', 'Maintenance tonight (ja)', 'The site closes at 2:00.'),
			(uuidv7(), $1, $2, 'en', 'Maintenance tonight', 'The site closes at 2:00.')
	`, announcementID, tenantID)

	// Reader 0 last read in en, reader 1 in ko, which the announcement was not
	// written in, and the rest never named a locale.
	lastLocales := []string{"en", "ko", "", "", ""}
	want := make([]dbmodels.ListAnnouncementRecipientsRow, len(lastLocales))
	for index, lastLocale := range lastLocales {
		userID := mustInsertUser(
			t, ctx, pg.DB, tenantID,
			fmt.Sprintf("FANOUT%06d", index),
			fmt.Sprintf("fanout-%d@example.com", index),
			fmt.Sprintf("Reader %d", index),
		)
		title := "Maintenance tonight (ja)"
		if lastLocale != "" {
			mustExec(t, ctx, pg.DB, `UPDATE users SET last_locale = $2 WHERE id = $1`, userID, lastLocale)
		}
		if lastLocale == "en" {
			title = "Maintenance tonight"
		}
		want[index] = dbmodels.ListAnnouncementRecipientsRow{UserID: userID, Title: title}
	}
	slices.SortFunc(want, func(a, b dbmodels.ListAnnouncementRecipientsRow) int {
		return bytes.Compare(a.UserID[:], b.UserID[:])
	})
	mustInsertUser(t, ctx, pg.DB, otherTenantID, "OTHERFAN0001", "other-fanout@example.com", "Other Reader")

	queries := dbmodels.New(pg.DB)

	// The nil UUID sorts below every UUID, so it is what the first page asks
	// for and the walk needs no separate first-page query.
	var got []dbmodels.ListAnnouncementRecipientsRow
	after := uuid.Nil
	for {
		page, err := queries.ListAnnouncementRecipients(ctx, dbmodels.ListAnnouncementRecipientsParams{
			AnnouncementID: announcementID,
			TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
			AfterUserID:    after,
			Limit:          2,
		})
		if err != nil {
			t.Fatalf("ListAnnouncementRecipients after %s: %v", after, err)
		}
		if len(page) == 0 {
			break
		}
		got = append(got, page...)
		after = page[len(page)-1].UserID
	}

	if !slices.Equal(got, want) {
		t.Fatalf("recipients = %v, want every user of the tenant in id order with their locale's title %v", got, want)
	}
}

// A reader's last locale is a locale or nothing: a blank one would pick no
// translation and read as a locale all the same.
func TestUsersRefuseABlankLastLocale(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "LOCALETNT001", "locale.example.com", "admin-locale.example.com", "Locale Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "LOCALEUSR001", "locale@example.com", "Reader")

	_, err := pg.DB.ExecContext(ctx, `UPDATE users SET last_locale = ' ' WHERE id = $1`, userID)
	if !isCheckViolation(err) || checkName(err) != "users_last_locale_not_blank_check" {
		t.Fatalf("blank last_locale: err = %v, want users_last_locale_not_blank_check", err)
	}
}

// SetUserLastLocale records the locale on the reader a still-good token names,
// and a request in the locale already recorded leaves the row as it was. A
// token issued before the reader's credentials moved names nobody any more.
func TestSetUserLastLocaleWritesOnlyAChange(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenantID := mustInsertTenant(t, ctx, pg.DB, "LOCALETNT002", "locale-2.example.com", "admin-locale-2.example.com", "Locale Tenant")
	userID := mustInsertUser(t, ctx, pg.DB, tenantID, "LOCALEUSR002", "locale-2@example.com", "Reader")
	var credentialsVersion int32
	mustQueryRow(t, ctx, pg.DB, `SELECT credentials_version FROM users WHERE id = $1`, &credentialsVersion, userID)
	queries := dbmodels.New(pg.DB)

	var xmin string
	set := func(locale string, version int32) string {
		t.Helper()
		if err := queries.SetUserLastLocale(ctx, dbmodels.SetUserLastLocaleParams{
			LastLocale:         locale,
			TenantID:           uuid.NullUUID{UUID: tenantID, Valid: true},
			PublicID:           "LOCALEUSR002",
			CredentialsVersion: version,
		}); err != nil {
			t.Fatalf("SetUserLastLocale(%q): %v", locale, err)
		}
		var stored sql.NullString
		if err := pg.DB.QueryRowContext(ctx, `SELECT last_locale, xmin::text FROM users WHERE id = $1`, userID).Scan(&stored, &xmin); err != nil {
			t.Fatalf("read last_locale: %v", err)
		}
		return stored.String
	}

	if got := set("en", credentialsVersion); got != "en" {
		t.Fatalf("last_locale = %q, want en", got)
	}
	written := xmin
	if got := set("en", credentialsVersion); got != "en" || xmin != written {
		t.Fatalf("same locale again: last_locale = %q, row version %s -> %s, want en and no write", got, written, xmin)
	}
	if got := set("ko", credentialsVersion+1); got != "en" || xmin != written {
		t.Fatalf("stale token: last_locale = %q, row version %s -> %s, want en and no write", got, written, xmin)
	}
	if got := set("ja", credentialsVersion); got != "ja" || xmin == written {
		t.Fatalf("new locale: last_locale = %q, row version %s -> %s, want ja and a write", got, written, xmin)
	}
}

// mustInsertUntranslatedAnnouncement writes an announcement with no translation, for the
// test to give it the ones it is about.
func mustInsertUntranslatedAnnouncement(t *testing.T, ctx context.Context, db *sql.DB, tenantID uuid.UUID) uuid.UUID {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("uuid: %v", err)
	}
	mustExec(t, ctx, db, `
		INSERT INTO announcements (id, tenant_id, announcement_type)
		VALUES ($1, $2, 'announcement')
	`, id, tenantID)
	return id
}
