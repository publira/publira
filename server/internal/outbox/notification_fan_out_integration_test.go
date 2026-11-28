package outbox

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

// onePagePerJob leaves every job room for its first page only, so a fan-out
// over more than one page resumes once per page before its last.
var onePagePerJob = fanOutPaging{pageSize: 2, reserve: time.Hour}

// An announcement to a readership that does not fit in one job is filed across
// as many jobs as it takes: every reader is told once, the event finishes
// without an attempt charged, and the push and the mail are queued.
func TestAnnouncementNotificationReachesEveryReaderAcrossJobsInTheDatabase(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "ANNJOBS00001", "announcement-jobs.example.com", "Announcement Jobs Tenant")
	for i := range 5 {
		pg.SeedEndUser(t, tenant.ID, fmt.Sprintf("ANNJOBSU%04d", i), fmt.Sprintf("reader%d@announcement-jobs.example.com", i), fmt.Sprintf("Reader %d", i))
	}
	announcementID := uuid.Must(uuid.NewV7())
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO announcements (id, tenant_id, announcement_type) VALUES ($1, $2, 'announcement')
	`, announcementID, tenant.ID); err != nil {
		t.Fatalf("insert announcement: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
		SELECT uuidv7(), $1, t.id, t.default_locale, 'Maintenance tonight', 'The site closes at 2:00.'
		FROM tenants t WHERE t.id = $2
	`, announcementID, tenant.ID); err != nil {
		t.Fatalf("insert announcement translation: %v", err)
	}
	queries := dbmodels.New(pg.DB)
	if err := QueueAnnouncementNotification(ctx, queries, tenant.ID, announcementID, false); err != nil {
		t.Fatalf("QueueAnnouncementNotification: %v", err)
	}

	handlers := NewRegistry()
	handlers.Register(EventTypeAnnouncementNotification,
		announcementNotificationHandler(AnnouncementNotificationHandlerConfig{DB: pg.DB}, queries, onePagePerJob))
	// Five readers, two to a page: two full pages, then the last.
	resumed := drainAcrossJobs(ctx, t, pg, handlers, AnnouncementIdempotencyKey(announcementID))
	if resumed != 2 {
		t.Fatalf("resumes = %d, want one per page before the last (2)", resumed)
	}

	assertEachTenantUserNotifiedOnce(ctx, t, pg, tenant.ID, NotificationTypeAnnouncementPosted, AnnouncementSubjectKey(announcementID))
	assertQueued(ctx, t, pg, AnnouncementPushIdempotencyKey(announcementID))
	assertQueued(ctx, t, pg, NotificationEmailIdempotencyKey(tenant.ID, NotificationTypeAnnouncementPosted, AnnouncementSubjectKey(announcementID)))
}

// An episode whose followers do not fit in one job is filed across as many
// jobs as it takes, through the followers of its series and then those of its
// credited creator: every follower is told once, the one who follows both
// under followed_episodes, and the push and the mail are queued.
func TestEpisodePublishedNotificationReachesEveryFollowerAcrossJobsInTheDatabase(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "EPJOBS000001", "episode-jobs.example.com", "Episode Jobs Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESJOBS01", Title: "Jobs Series", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEJOBS1",
		Title:    "Jobs Episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORJOBS1", Name: "Credited Creator"})
	pg.SeedEpisodeCreator(t, tenant.ID, episode.ID, creator.ID, "")

	want := map[uuid.UUID]NotificationCategory{}
	for i := range 5 {
		reader := pg.SeedEndUser(t, tenant.ID, fmt.Sprintf("EPJOBSU%05d", i), fmt.Sprintf("reader%d@episode-jobs.example.com", i), fmt.Sprintf("Reader %d", i))
		// Readers 0 to 2 follow the series, 2 to 4 the creator.
		if i <= 2 {
			if _, err := pg.DB.ExecContext(ctx, "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", tenant.ID, reader.ID, series.ID); err != nil {
				t.Fatalf("follow series: %v", err)
			}
			want[reader.ID] = NotificationCategoryFollowedEpisodes
		}
		if i >= 2 {
			if _, err := pg.DB.ExecContext(ctx, "INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", tenant.ID, reader.ID, creator.ID); err != nil {
				t.Fatalf("follow creator: %v", err)
			}
			if _, ok := want[reader.ID]; !ok {
				want[reader.ID] = NotificationCategoryFollowedCreators
			}
		}
	}
	queries := dbmodels.New(pg.DB)
	event := episodePublishedEvent(t, tenant.ID, episode.ID)
	if _, err := queries.InsertOutboxEvent(ctx, dbmodels.InsertOutboxEventParams{
		ID:             event.ID,
		TenantID:       event.TenantID,
		EventType:      event.EventType,
		Payload:        event.Payload,
		IdempotencyKey: event.IdempotencyKey,
		AvailableAt:    time.Now().UTC().Add(-time.Second),
	}); err != nil {
		t.Fatalf("InsertOutboxEvent: %v", err)
	}

	handlers := NewRegistry()
	handlers.Register(EventTypeEpisodePublishedNotification, episodePublishedNotificationHandler(
		EpisodePublishedNotificationHandlerConfig{DB: pg.DB},
		queries,
		holdEpisodeOn(pg.DB, func(q *dbmodels.Queries) episodeFollowerPageQuerier { return q }),
		onePagePerJob,
	))
	// Three followers of the series, two to a page, and two of the creator
	// alone: a full page of the series'; a short one, which goes on to a full
	// page of the creator's; and an empty one of the creator's.
	resumed := drainAcrossJobs(ctx, t, pg, handlers, event.IdempotencyKey)
	if resumed != 2 {
		t.Fatalf("resumes = %d, want one per full page (2)", resumed)
	}

	rows, err := pg.DB.QueryContext(ctx,
		"SELECT user_id, category FROM notifications WHERE notification_type = $1 AND subject_key = $2",
		NotificationTypeEpisodePublished, EpisodeSubjectKey("EPISODEJOBS1"),
	)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	got := map[uuid.UUID]NotificationCategory{}
	for rows.Next() {
		var (
			userID   uuid.UUID
			category string
		)
		if err := rows.Scan(&userID, &category); err != nil {
			t.Fatalf("scan notification: %v", err)
		}
		if _, twice := got[userID]; twice {
			t.Fatalf("follower %s was notified twice", userID)
		}
		got[userID] = NotificationCategory(category)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate notifications: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("notifications = %v, want one per follower %v", got, want)
	}
	for userID, category := range want {
		if got[userID] != category {
			t.Fatalf("notification for %s filed under %q, want %q", userID, got[userID], category)
		}
	}
	assertQueued(ctx, t, pg, "push:"+NotificationTypeEpisodePublished+":"+EpisodeSubjectKey("EPISODEJOBS1"))
	assertQueued(ctx, t, pg, NotificationEmailIdempotencyKey(tenant.ID, NotificationTypeEpisodePublished, EpisodeSubjectKey("EPISODEJOBS1")))
}

// drainAcrossJobs runs a worker over the event queued under idempotencyKey
// until it is done, and answers how many times it resumed. One attempt is all
// the worker allows, so an event that fails rather than resumes is dead.
func drainAcrossJobs(ctx context.Context, t *testing.T, pg *testutil.PostgresEnv, handlers *Registry, idempotencyKey string) int64 {
	t.Helper()

	var eventID uuid.UUID
	if err := pg.DB.QueryRowContext(ctx, "SELECT id FROM outbox_events WHERE idempotency_key = $1", idempotencyKey).Scan(&eventID); err != nil {
		t.Fatalf("find the queued event: %v", err)
	}
	w, err := Start(ctx, pg.DB, Config{
		Handlers:          handlers,
		MaxAttempts:       1,
		DrainInterval:     50 * time.Millisecond,
		FetchCooldown:     10 * time.Millisecond,
		FetchPollInterval: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("start worker: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer stopCancel()
		if err := w.Stop(stopCtx); err != nil {
			t.Errorf("stop worker: %v", err)
		}
	})

	queries := dbmodels.New(pg.DB)
	var got dbmodels.OutboxEvent
	for got.Status != StatusDone {
		if got.Status == StatusDead {
			t.Fatalf("event is dead: %s", got.LastError.String)
		}
		if ctx.Err() != nil {
			t.Fatalf("event status = %q after %d resumes, want %q", got.Status, w.Metrics().Resumed.Load(), StatusDone)
		}
		time.Sleep(20 * time.Millisecond)
		if got, err = queries.GetOutboxEvent(ctx, eventID); err != nil {
			t.Fatalf("GetOutboxEvent: %v", err)
		}
	}
	if got.Attempts != 0 {
		t.Fatalf("attempts = %d, want 0", got.Attempts)
	}
	return w.Metrics().Resumed.Load()
}

// assertEachTenantUserNotifiedOnce checks every user of the tenant holds
// exactly one row of the notification.
func assertEachTenantUserNotifiedOnce(ctx context.Context, t *testing.T, pg *testutil.PostgresEnv, tenantID uuid.UUID, notificationType, subjectKey string) {
	t.Helper()

	rows, err := pg.DB.QueryContext(ctx, `
		SELECT u.id, count(n.id)
		FROM users u
			LEFT JOIN notifications n ON n.user_id = u.id
				AND n.notification_type = $2
				AND n.subject_key = $3
		WHERE u.tenant_id = $1
		GROUP BY u.id
	`, tenantID, notificationType, subjectKey)
	if err != nil {
		t.Fatalf("count notifications per user: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	users := 0
	for rows.Next() {
		var (
			userID uuid.UUID
			count  int
		)
		if err := rows.Scan(&userID, &count); err != nil {
			t.Fatalf("scan count: %v", err)
		}
		if count != 1 {
			t.Fatalf("user %s holds %d notifications, want 1", userID, count)
		}
		users++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate counts: %v", err)
	}
	if users == 0 {
		t.Fatal("the tenant has no users to notify")
	}
}

// assertQueued checks an outbox event is queued under idempotencyKey.
func assertQueued(ctx context.Context, t *testing.T, pg *testutil.PostgresEnv, idempotencyKey string) {
	t.Helper()

	var queued int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM outbox_events WHERE idempotency_key = $1", idempotencyKey).Scan(&queued); err != nil {
		t.Fatalf("count outbox events: %v", err)
	}
	if queued != 1 {
		t.Fatalf("outbox events under %q = %d, want 1", idempotencyKey, queued)
	}
}
