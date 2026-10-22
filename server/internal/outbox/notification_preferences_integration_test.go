package outbox

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// notificationPreferencesFixture is one tenant with a public series, an
// episode of it, and an episode of a second series that a creator is credited
// on alone, so a reader can be told about the first through the series and
// about the second through the creator.
type notificationPreferencesFixture struct {
	pg                *testutil.PostgresEnv
	tenant            testutil.Tenant
	series            testutil.Series
	seriesEpisode     testutil.Episode
	creator           testutil.Creator
	creatorEpisode    testutil.Episode
	creatorEpisodeKey string
	seriesEpisodeKey  string
}

func newNotificationPreferencesFixture(t *testing.T, prefix string) notificationPreferencesFixture {
	t.Helper()

	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	tenant := pg.SeedTenant(t, prefix+"TENANT01", prefix+"-prefs.example.com", "Preferences Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: prefix + "SERIES01", Title: "Followed Series", Published: true})
	otherSeries := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: prefix + "SERIES02", Title: "Other Series", Published: true})
	seriesEpisode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EPISOD01",
		Title:    "Series Episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	creatorEpisode := pg.SeedEpisode(t, tenant.ID, otherSeries.ID, testutil.EpisodeSeed{
		PublicID: prefix + "EPISOD02",
		Title:    "Creator Episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: prefix + "CREATR01", Name: "Followed Author"})
	pg.SeedEpisodeCreator(t, tenant.ID, seriesEpisode.ID, creator.ID, "")
	pg.SeedEpisodeCreator(t, tenant.ID, creatorEpisode.ID, creator.ID, "")

	return notificationPreferencesFixture{
		pg:                pg,
		tenant:            tenant,
		series:            series,
		seriesEpisode:     seriesEpisode,
		creator:           creator,
		creatorEpisode:    creatorEpisode,
		seriesEpisodeKey:  "episode:" + seriesEpisode.PublicID,
		creatorEpisodeKey: "episode:" + creatorEpisode.PublicID,
	}
}

func (f notificationPreferencesFixture) followSeries(t *testing.T, ctx context.Context, userID uuid.UUID) {
	t.Helper()
	if _, err := f.pg.DB.ExecContext(ctx, "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", f.tenant.ID, userID, f.series.ID); err != nil {
		t.Fatalf("follow series: %v", err)
	}
}

func (f notificationPreferencesFixture) followCreator(t *testing.T, ctx context.Context, userID uuid.UUID) {
	t.Helper()
	if _, err := f.pg.DB.ExecContext(ctx, "INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", f.tenant.ID, userID, f.creator.ID); err != nil {
		t.Fatalf("follow creator: %v", err)
	}
}

func (f notificationPreferencesFixture) savePreferences(t *testing.T, ctx context.Context, userID uuid.UUID, params dbmodels.UpsertUserNotificationSettingsParams) {
	t.Helper()
	params.TenantID = f.tenant.ID
	params.UserID = userID
	if _, err := dbmodels.New(f.pg.DB).UpsertUserNotificationSettings(ctx, params); err != nil {
		t.Fatalf("UpsertUserNotificationSettings: %v", err)
	}
}

// registerDevice answers the token the device is stored under, which for a
// browser is its subscription's endpoint.
func (f notificationPreferencesFixture) registerDevice(t *testing.T, ctx context.Context, userID uuid.UUID, name, platform string) string {
	t.Helper()
	params := dbmodels.UpsertUserPushDeviceParams{
		TenantID: f.tenant.ID,
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
	if _, err := dbmodels.New(f.pg.DB).UpsertUserPushDevice(ctx, params); err != nil {
		t.Fatalf("UpsertUserPushDevice: %v", err)
	}
	return params.Token
}

// publish runs the fan-out the worker runs for an episode the console
// published.
func (f notificationPreferencesFixture) publish(t *testing.T, ctx context.Context, episodeID uuid.UUID) {
	t.Helper()
	handler := NewEpisodePublishedNotificationHandler(EpisodePublishedNotificationHandlerConfig{DB: f.pg.OpenOutboxDB(t)})
	if err := handler(ctx, episodePublishedEvent(t, f.tenant.ID, episodeID)); err != nil {
		t.Fatalf("handler for %s: %v", episodeID, err)
	}
}

// inbox answers the subject keys a reader's site inbox lists and the unread
// count beside it, through the queries ListNotifications and
// CountUnreadNotifications run.
func (f notificationPreferencesFixture) inbox(t *testing.T, ctx context.Context, userID uuid.UUID) (map[string]bool, int32) {
	t.Helper()
	queries := dbmodels.New(f.pg.DB)
	surface := sql.NullString{String: "web", Valid: true}
	rows, err := queries.ListNotificationsForUserDesc(ctx, dbmodels.ListNotificationsForUserDescParams{
		TenantID: f.tenant.ID,
		UserID:   userID,
		Surface:  surface,
		Limit:    50,
	})
	if err != nil {
		t.Fatalf("ListNotificationsForUserDesc: %v", err)
	}
	listed := map[string]bool{}
	for _, row := range rows {
		listed[row.SubjectKey] = true
	}
	unread, err := queries.CountUnreadNotificationsForUser(ctx, dbmodels.CountUnreadNotificationsForUserParams{
		TenantID: f.tenant.ID,
		UserID:   userID,
		Surface:  surface,
	})
	if err != nil {
		t.Fatalf("CountUnreadNotificationsForUser: %v", err)
	}
	return listed, unread
}

// pushedTokens answers the device tokens the push of one episode reaches,
// through the query the push handler pages with.
func (f notificationPreferencesFixture) pushedTokens(t *testing.T, ctx context.Context, subjectKey string) map[string]bool {
	t.Helper()
	devices, err := dbmodels.New(f.pg.DB).ListPushDevicesForNotification(ctx, dbmodels.ListPushDevicesForNotificationParams{
		TenantID:         f.tenant.ID,
		NotificationType: NotificationTypeEpisodePublished,
		SubjectKey:       subjectKey,
		AfterUserID:      uuid.Nil,
		AfterToken:       "",
		PageSize:         50,
	})
	if err != nil {
		t.Fatalf("ListPushDevicesForNotification: %v", err)
	}
	tokens := map[string]bool{}
	for _, device := range devices {
		tokens[device.Token] = true
	}
	return tokens
}

// An episode takes the category of the most direct follow that earned it, so
// a reader who turned the creators they follow out of their inbox still finds
// an episode of a series they follow there, and not one credited to that
// creator alone.
func TestNotificationPreferencesFileAnEpisodeUnderTheMostDirectFollow(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	f := newNotificationPreferencesFixture(t, "NPDR")

	reader := f.pg.SeedEndUser(t, f.tenant.ID, "NPDIRECTRD01", "reader@npdirect.example.com", "Reader")
	f.followSeries(t, ctx, reader.ID)
	f.followCreator(t, ctx, reader.ID)
	f.savePreferences(t, ctx, reader.ID, dbmodels.UpsertUserNotificationSettingsParams{
		FollowedCreatorsInboxEnabled: sql.NullBool{Bool: false, Valid: true},
	})

	f.publish(t, ctx, f.seriesEpisode.ID)
	f.publish(t, ctx, f.creatorEpisode.ID)

	categories := map[string]string{}
	rows, err := f.pg.DB.QueryContext(ctx, "SELECT subject_key, category FROM notifications WHERE user_id = $1", reader.ID)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	for rows.Next() {
		var subjectKey, category string
		if err := rows.Scan(&subjectKey, &category); err != nil {
			t.Fatalf("scan notification: %v", err)
		}
		categories[subjectKey] = category
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate notifications: %v", err)
	}
	want := map[string]string{
		f.seriesEpisodeKey:  string(NotificationCategoryFollowedEpisodes),
		f.creatorEpisodeKey: string(NotificationCategoryFollowedCreators),
	}
	if len(categories) != len(want) {
		t.Fatalf("categories = %v, want %v", categories, want)
	}
	for subjectKey, category := range want {
		if categories[subjectKey] != category {
			t.Fatalf("category of %s = %q, want %q", subjectKey, categories[subjectKey], category)
		}
	}

	listed, unread := f.inbox(t, ctx, reader.ID)
	if !listed[f.seriesEpisodeKey] {
		t.Fatalf("inbox = %v, want the episode of the followed series", listed)
	}
	if listed[f.creatorEpisodeKey] {
		t.Fatalf("inbox = %v, want no episode credited only to the followed creator", listed)
	}
	if unread != 1 {
		t.Fatalf("unread = %d, want 1", unread)
	}
}

// An inbox cell that is off keeps the episode out of the inbox, its unread
// count, and "mark all as read", and leaves its push alone; a push cell that
// is off stops the push to that kind of device and no other.
func TestNotificationPreferencesSeparateTheInboxFromEachPush(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	f := newNotificationPreferencesFixture(t, "NPCH")

	noInbox := f.pg.SeedEndUser(t, f.tenant.ID, "NPCHANNLRD01", "no-inbox@npchannl.example.com", "No Inbox")
	noPhone := f.pg.SeedEndUser(t, f.tenant.ID, "NPCHANNLRD02", "no-phone@npchannl.example.com", "No Phone")
	for _, reader := range []testutil.TenantUser{noInbox, noPhone} {
		f.followSeries(t, ctx, reader.ID)
	}
	f.savePreferences(t, ctx, noInbox.ID, dbmodels.UpsertUserNotificationSettingsParams{
		FollowedEpisodesInboxEnabled:   sql.NullBool{Bool: false, Valid: true},
		FollowedEpisodesWebPushEnabled: sql.NullBool{Bool: true, Valid: true},
	})
	f.savePreferences(t, ctx, noPhone.ID, dbmodels.UpsertUserNotificationSettingsParams{
		FollowedEpisodesMobilePushEnabled: sql.NullBool{Bool: false, Valid: true},
		FollowedEpisodesWebPushEnabled:    sql.NullBool{Bool: true, Valid: true},
	})
	noInboxBrowser := f.registerDevice(t, ctx, noInbox.ID, "no-inbox-browser", "web")
	noPhoneBrowser := f.registerDevice(t, ctx, noPhone.ID, "no-phone-browser", "web")
	f.registerDevice(t, ctx, noPhone.ID, "no-phone-android", "android")
	f.registerDevice(t, ctx, noPhone.ID, "no-phone-ios", "ios")

	f.publish(t, ctx, f.seriesEpisode.ID)

	listed, unread := f.inbox(t, ctx, noInbox.ID)
	if len(listed) != 0 || unread != 0 {
		t.Fatalf("inbox with the inbox cell off = %v (unread %d), want empty", listed, unread)
	}
	marked, err := dbmodels.New(f.pg.DB).MarkAllNotificationsAsRead(ctx, dbmodels.MarkAllNotificationsAsReadParams{
		TenantID: f.tenant.ID,
		UserID:   noInbox.ID,
		Surface:  sql.NullString{String: "web", Valid: true},
	})
	if err != nil {
		t.Fatalf("MarkAllNotificationsAsRead: %v", err)
	}
	if marked != 0 {
		t.Fatalf("marked as read with the inbox cell off = %d, want 0", marked)
	}
	if listed, unread := f.inbox(t, ctx, noPhone.ID); !listed[f.seriesEpisodeKey] || unread != 1 {
		t.Fatalf("inbox with the inbox cell on = %v (unread %d), want the episode", listed, unread)
	}

	pushed := f.pushedTokens(t, ctx, f.seriesEpisodeKey)
	want := map[string]bool{noInboxBrowser: true, noPhoneBrowser: true}
	if len(pushed) != len(want) {
		t.Fatalf("pushed devices = %v, want %v", pushed, want)
	}
	for token := range want {
		if !pushed[token] {
			t.Fatalf("pushed devices = %v, want %s among them", pushed, token)
		}
	}
}

// The two categories with an inbox cell alone — the reader's own comment and
// the tenant's announcement — are filed whatever the cell says and listed only
// while it is on.
func TestNotificationPreferencesKeepCommentsAndAnnouncementsOutOfTheInbox(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	f := newNotificationPreferencesFixture(t, "NPIB")
	outboxDB := f.pg.OpenOutboxDB(t)

	muted := f.pg.SeedEndUser(t, f.tenant.ID, "NPINBOXORD01", "muted@npinboxo.example.com", "Muted")
	listening := f.pg.SeedEndUser(t, f.tenant.ID, "NPINBOXORD02", "listening@npinboxo.example.com", "Listening")
	f.savePreferences(t, ctx, muted.ID, dbmodels.UpsertUserNotificationSettingsParams{
		CommentsInboxEnabled:      sql.NullBool{Bool: false, Valid: true},
		AnnouncementsInboxEnabled: sql.NullBool{Bool: false, Valid: true},
	})

	f.announce(t, ctx, outboxDB, AnnouncementDeliveryPreferred)

	approve := NewCommentApprovedNotificationHandler(CommentApprovedNotificationHandlerConfig{DB: outboxDB})
	for _, reader := range []testutil.TenantUser{muted, listening} {
		queued := &stubCommentApprovedQueuer{}
		if err := QueueCommentApprovedNotification(ctx, queued, CommentApprovedNotification{
			TenantID:        f.tenant.ID,
			UserID:          reader.ID,
			CommentPublicID: "CMT" + reader.PublicID,
		}); err != nil {
			t.Fatalf("QueueCommentApprovedNotification: %v", err)
		}
		event := queued.events[0]
		if err := approve(ctx, dbmodels.OutboxEvent{
			ID:        event.ID,
			TenantID:  event.TenantID,
			EventType: event.EventType,
			Payload:   event.Payload,
		}); err != nil {
			t.Fatalf("comment approved handler: %v", err)
		}
	}

	for _, tc := range []struct {
		reader testutil.TenantUser
		want   int32
	}{
		{reader: muted, want: 0},
		{reader: listening, want: 2},
	} {
		filed := 0
		if err := f.pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM notifications WHERE user_id = $1", tc.reader.ID).Scan(&filed); err != nil {
			t.Fatalf("count notifications: %v", err)
		}
		if filed != 2 {
			t.Fatalf("notifications filed for %s = %d, want 2", tc.reader.PublicID, filed)
		}
		if listed, unread := f.inbox(t, ctx, tc.reader.ID); int32(len(listed)) != tc.want || unread != tc.want {
			t.Fatalf("inbox of %s = %v (unread %d), want %d", tc.reader.PublicID, listed, unread, tc.want)
		}
	}
}

// An announcement posted for everyone is listed in the inbox of a reader whose
// announcements cell is off, beside one whose cell is on, while a preferred one
// posted to the same readers reaches only the second.
func TestNotificationPreferencesListAnAnnouncementForEveryoneWhateverTheCell(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	f := newNotificationPreferencesFixture(t, "NPEV")
	outboxDB := f.pg.OpenOutboxDB(t)

	muted := f.pg.SeedEndUser(t, f.tenant.ID, "NPEVERYONE01", "muted@npeveryone.example.com", "Muted")
	listening := f.pg.SeedEndUser(t, f.tenant.ID, "NPEVERYONE02", "listening@npeveryone.example.com", "Listening")
	f.savePreferences(t, ctx, muted.ID, dbmodels.UpsertUserNotificationSettingsParams{
		AnnouncementsInboxEnabled: sql.NullBool{Bool: false, Valid: true},
	})

	everyone := f.announce(t, ctx, outboxDB, AnnouncementDeliveryEveryone)
	preferred := f.announce(t, ctx, outboxDB, AnnouncementDeliveryPreferred)

	for _, tc := range []struct {
		reader testutil.TenantUser
		want   []uuid.UUID
	}{
		{reader: muted, want: []uuid.UUID{everyone}},
		{reader: listening, want: []uuid.UUID{everyone, preferred}},
	} {
		listed, unread := f.inbox(t, ctx, tc.reader.ID)
		if len(listed) != len(tc.want) || unread != int32(len(tc.want)) {
			t.Fatalf("inbox of %s = %v (unread %d), want %d", tc.reader.PublicID, listed, unread, len(tc.want))
		}
		for _, announcementID := range tc.want {
			if !listed[AnnouncementSubjectKey(announcementID)] {
				t.Fatalf("inbox of %s = %v, want %s among them", tc.reader.PublicID, listed, AnnouncementSubjectKey(announcementID))
			}
		}
	}
}

// announce posts an announcement with the given delivery and runs its fan-out.
func (f notificationPreferencesFixture) announce(t *testing.T, ctx context.Context, outboxDB *sql.DB, delivery string) uuid.UUID {
	t.Helper()

	announcementID := uuid.Must(uuid.NewV7())
	if _, err := f.pg.DB.ExecContext(ctx, `
		INSERT INTO announcements (id, tenant_id, announcement_type, delivery) VALUES ($1, $2, 'announcement', $3)
	`, announcementID, f.tenant.ID, delivery); err != nil {
		t.Fatalf("insert announcement: %v", err)
	}
	if _, err := f.pg.DB.ExecContext(ctx, `
		INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
		SELECT uuidv7(), $1, $2, default_locale, 'Maintenance tonight', 'The site closes at 2:00.'
		FROM tenants WHERE id = $2
	`, announcementID, f.tenant.ID); err != nil {
		t.Fatalf("insert announcement translation: %v", err)
	}
	handler := NewAnnouncementNotificationHandler(AnnouncementNotificationHandlerConfig{DB: outboxDB})
	if err := handler(ctx, announcementEvent(t, f.tenant.ID, announcementID)); err != nil {
		t.Fatalf("announcement handler: %v", err)
	}
	return announcementID
}
