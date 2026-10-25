package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/testutil"
)

// The migration versions this test steps between: the last one before the
// email cells, and the one that added them.
const (
	beforeNotificationEmailPreferencesVersion = 20261021202403
	notificationEmailPreferencesVersion       = 20261022064419
)

// A reader who had turned email notifications off comes out of the migration
// with every email cell off, so they receive no notification mail without
// touching their settings, and every other reader with every email cell on.
func TestNotificationEmailPreferencesMigrationKeepsEmailOffForReadersWhoTurnedItOff(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Behind the migration under test, so the rows seeded below are rows it
	// finds rather than rows written through it.
	pg.MigrateTo(t, beforeNotificationEmailPreferencesVersion)
	t.Cleanup(func() { pg.MigrateUp(t) })

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := pg.DB

	tenant := pg.SeedTenantOnOlderSchema(t, "TENANTM", "tenant-m.example.com", "Tenant M")
	declined := pg.SeedEndUser(t, tenant.ID, "READEROFF01", "off@example.com", "Reader Off")
	accepted := pg.SeedEndUser(t, tenant.ID, "READERON001", "on@example.com", "Reader On")
	mustExec(t, ctx, db, `
		INSERT INTO user_notification_settings (tenant_id, user_id, email_notifications_enabled)
		VALUES ($1, $2, false), ($1, $3, true)
	`, tenant.ID, declined.ID, accepted.ID)

	pg.MigrateTo(t, notificationEmailPreferencesVersion)

	for _, tc := range []struct {
		name   string
		userID any
		want   bool
	}{
		{name: "turned email off", userID: declined.ID, want: false},
		{name: "left email on", userID: accepted.ID, want: true},
	} {
		var episodes, creators, comments, announcements bool
		if err := db.QueryRowContext(ctx, `
			SELECT followed_episodes_email_enabled, followed_creators_email_enabled,
				comments_email_enabled, announcements_email_enabled
			FROM user_notification_settings WHERE user_id = $1
		`, tc.userID).Scan(&episodes, &creators, &comments, &announcements); err != nil {
			t.Fatalf("%s: read email cells: %v", tc.name, err)
		}
		for _, cell := range []bool{episodes, creators, comments, announcements} {
			if cell != tc.want {
				t.Fatalf("%s: email cells = %v %v %v %v, want all %v", tc.name, episodes, creators, comments, announcements, tc.want)
			}
		}
	}
}
