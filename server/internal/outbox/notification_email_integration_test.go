package outbox

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/secretcrypto"
)

// notificationEmailFixture is the preferences fixture with the platform's SMTP
// settings to mail through.
type notificationEmailFixture struct {
	notificationPreferencesFixture
	encryptor *secretcrypto.Manager
}

func newNotificationEmailFixture(t *testing.T, ctx context.Context, prefix string) notificationEmailFixture {
	t.Helper()
	f := newNotificationPreferencesFixture(t, prefix)
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"test": make([]byte, 32)}, "test")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	password, err := encryptor.EncryptString("smtp-password")
	if err != nil {
		t.Fatalf("EncryptString: %v", err)
	}
	if _, err := dbmodels.New(f.pg.DB).InsertPlatformSMTPConfig(ctx, dbmodels.InsertPlatformSMTPConfigParams{
		Host: "smtp.example.com", Port: 587, Username: "mailer", PasswordEncrypted: password,
		Encryption: "starttls", FromAddress: "no-reply@example.com",
	}); err != nil {
		t.Fatalf("InsertPlatformSMTPConfig: %v", err)
	}
	return notificationEmailFixture{notificationPreferencesFixture: f, encryptor: encryptor}
}

// mail drains the mail event the fan-out queued for one notification and
// answers the addresses it reached.
func (f notificationEmailFixture) mail(t *testing.T, ctx context.Context, notificationType, subjectKey string) []string {
	t.Helper()
	var event dbmodels.OutboxEvent
	if err := f.pg.DB.QueryRowContext(ctx,
		"SELECT id, tenant_id, event_type, payload FROM outbox_events WHERE idempotency_key = $1",
		NotificationEmailIdempotencyKey(f.tenant.ID, notificationType, subjectKey),
	).Scan(&event.ID, &event.TenantID, &event.EventType, &event.Payload); err != nil {
		t.Fatalf("load the queued mail of %s: %v", subjectKey, err)
	}
	mailer := &failingRecipientMailer{}
	handler := NewNotificationEmailHandler(EmailHandlerConfig{DB: f.pg.OpenOutboxDB(t), Encryptor: f.encryptor, Mailer: mailer})
	if err := handler(ctx, event); err != nil {
		t.Fatalf("notification email handler: %v", err)
	}
	slices.Sort(mailer.sent)
	return mailer.sent
}

// An episode of a series a reader follows mails them while their
// followed_episodes email cell is on and not once it is off, and never mails a
// reader whose address is unconfirmed. Draining the same event again mails
// nobody a second time.
func TestNotificationEmailFollowsTheReadersEmailCell(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := newNotificationEmailFixture(t, ctx, "NEEP")

	on := f.pg.SeedEndUser(t, f.tenant.ID, "NEEPREADER01", "on@neep.example.com", "Email On")
	off := f.pg.SeedEndUser(t, f.tenant.ID, "NEEPREADER02", "off@neep.example.com", "Email Off")
	inboxOff := f.pg.SeedEndUser(t, f.tenant.ID, "NEEPREADER03", "inbox-off@neep.example.com", "Inbox Off")
	unconfirmed := f.pg.SeedUnverifiedEndUser(t, f.tenant.ID, "NEEPREADER04", "unconfirmed@neep.example.com", "Unconfirmed")
	for _, userID := range []uuid.UUID{on.ID, off.ID, inboxOff.ID, unconfirmed.ID} {
		f.followSeries(t, ctx, userID)
	}
	f.savePreferences(t, ctx, off.ID, dbmodels.UpsertUserNotificationSettingsParams{
		FollowedEpisodesEmailEnabled: sql.NullBool{Bool: false, Valid: true},
	})
	// The inbox cell is a channel of its own: a reader who keeps the episode
	// out of their inbox is still mailed about it.
	f.savePreferences(t, ctx, inboxOff.ID, dbmodels.UpsertUserNotificationSettingsParams{
		FollowedEpisodesInboxEnabled: sql.NullBool{Bool: false, Valid: true},
	})

	f.publish(t, ctx, f.seriesEpisode.ID)

	got := f.mail(t, ctx, NotificationTypeEpisodePublished, f.seriesEpisodeKey)
	if want := []string{"inbox-off@neep.example.com", "on@neep.example.com"}; !slices.Equal(got, want) {
		t.Fatalf("mailed %v, want %v", got, want)
	}
	if again := f.mail(t, ctx, NotificationTypeEpisodePublished, f.seriesEpisodeKey); len(again) != 0 {
		t.Fatalf("a second drain mailed %v, want nobody", again)
	}
}

// An episode a reader hears about through an author they follow answers to
// the followed_creators email cell, not to followed_episodes.
func TestNotificationEmailAsksTheCellOfTheFollowThatEarnedTheRow(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := newNotificationEmailFixture(t, ctx, "NECR")

	creatorsOff := f.pg.SeedEndUser(t, f.tenant.ID, "NECRREADER01", "creators-off@necr.example.com", "Creators Off")
	episodesOff := f.pg.SeedEndUser(t, f.tenant.ID, "NECRREADER02", "episodes-off@necr.example.com", "Episodes Off")
	f.followCreator(t, ctx, creatorsOff.ID)
	f.followCreator(t, ctx, episodesOff.ID)
	f.savePreferences(t, ctx, creatorsOff.ID, dbmodels.UpsertUserNotificationSettingsParams{
		FollowedCreatorsEmailEnabled: sql.NullBool{Bool: false, Valid: true},
	})
	f.savePreferences(t, ctx, episodesOff.ID, dbmodels.UpsertUserNotificationSettingsParams{
		FollowedEpisodesEmailEnabled: sql.NullBool{Bool: false, Valid: true},
	})

	f.publish(t, ctx, f.creatorEpisode.ID)

	got := f.mail(t, ctx, NotificationTypeEpisodePublished, f.creatorEpisodeKey)
	if want := []string{"episodes-off@necr.example.com"}; !slices.Equal(got, want) {
		t.Fatalf("mailed %v, want %v", got, want)
	}
}

// An announcement for everyone mails every reader with a confirmed address,
// whatever their announcements email cell says, while one that answers to the
// readers' preferences mails only those whose cell is on.
func TestNotificationEmailOfAnAnnouncementForEveryoneIgnoresTheCell(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := newNotificationEmailFixture(t, ctx, "NEAN")

	f.pg.SeedEndUser(t, f.tenant.ID, "NEANREADER01", "on@nean.example.com", "Email On")
	off := f.pg.SeedEndUser(t, f.tenant.ID, "NEANREADER02", "off@nean.example.com", "Email Off")
	f.pg.SeedUnverifiedEndUser(t, f.tenant.ID, "NEANREADER03", "unconfirmed@nean.example.com", "Unconfirmed")
	f.savePreferences(t, ctx, off.ID, dbmodels.UpsertUserNotificationSettingsParams{
		AnnouncementsEmailEnabled: sql.NullBool{Bool: false, Valid: true},
	})

	for _, tc := range []struct {
		delivery string
		want     []string
	}{
		{delivery: AnnouncementDeliveryPreferred, want: []string{"on@nean.example.com"}},
		{delivery: AnnouncementDeliveryEveryone, want: []string{"off@nean.example.com", "on@nean.example.com"}},
	} {
		t.Run(tc.delivery, func(t *testing.T) {
			announcementID := uuid.Must(uuid.NewV7())
			if _, err := f.pg.DB.ExecContext(ctx, `
				INSERT INTO announcements (id, tenant_id, announcement_type, delivery) VALUES ($1, $2, 'announcement', $3)
			`, announcementID, f.tenant.ID, tc.delivery); err != nil {
				t.Fatalf("insert announcement: %v", err)
			}
			if _, err := f.pg.DB.ExecContext(ctx, `
				INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
				SELECT uuidv7(), $1, $2, default_locale, 'New terms of use', 'The terms change next month.'
				FROM tenants WHERE id = $2
			`, announcementID, f.tenant.ID); err != nil {
				t.Fatalf("insert announcement translation: %v", err)
			}
			handler := NewAnnouncementNotificationHandler(AnnouncementNotificationHandlerConfig{DB: f.pg.OpenOutboxDB(t)})
			if err := handler(ctx, announcementEvent(t, f.tenant.ID, announcementID)); err != nil {
				t.Fatalf("announcement handler: %v", err)
			}

			got := f.mail(t, ctx, NotificationTypeAnnouncementPosted, AnnouncementSubjectKey(announcementID))
			if !slices.Equal(got, tc.want) {
				t.Fatalf("mailed %v, want %v", got, tc.want)
			}
		})
	}
}

// The approval of a comment mails its author while their comments email cell
// is on.
func TestNotificationEmailTellsTheAuthorTheirCommentWasApproved(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	f := newNotificationEmailFixture(t, ctx, "NECM")

	author := f.pg.SeedEndUser(t, f.tenant.ID, "NECMREADER01", "author@necm.example.com", "Author")
	quiet := f.pg.SeedEndUser(t, f.tenant.ID, "NECMREADER02", "quiet@necm.example.com", "Quiet Author")
	f.savePreferences(t, ctx, quiet.ID, dbmodels.UpsertUserNotificationSettingsParams{
		CommentsEmailEnabled: sql.NullBool{Bool: false, Valid: true},
	})

	queries := dbmodels.New(f.pg.OpenOutboxDB(t))
	for _, tc := range []struct {
		commentID string
		userID    uuid.UUID
		want      []string
	}{
		{commentID: "NECMCOMMENT1", userID: author.ID, want: []string{"author@necm.example.com"}},
		{commentID: "NECMCOMMENT2", userID: quiet.ID, want: nil},
	} {
		if err := notifyCommentApproved(ctx, queries, CommentApprovedNotification{
			TenantID:        f.tenant.ID,
			UserID:          tc.userID,
			CommentPublicID: tc.commentID,
			EpisodePublicID: f.seriesEpisode.PublicID,
			EpisodeTitle:    "Series Episode",
			SeriesPublicID:  f.series.PublicID,
			SeriesTitle:     "Followed Series",
		}); err != nil {
			t.Fatalf("notifyCommentApproved: %v", err)
		}
		got := f.mail(t, ctx, NotificationTypeCommentApproved, CommentAuthorSubjectKey(tc.commentID))
		if !slices.Equal(got, tc.want) {
			t.Fatalf("%s mailed %v, want %v", tc.commentID, got, tc.want)
		}
	}
}
