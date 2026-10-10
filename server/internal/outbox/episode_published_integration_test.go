package outbox

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/testutil"
)

// The episode a console published at once reaches the readers following its
// series and its credited creator, and an episode taken back before the event
// drains reaches nobody.
func TestEpisodePublishedNotificationReachesTheFollowersInTheDatabase(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "EPPUBNOW0001", "publish-now.example.com", "Publish Now Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESNOW001", Title: "Now Series", Published: true})
	published := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODENOW01",
		Title:    "Now Episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	draft := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODENOW02",
		Title:    "Draft Episode",
		Status:   testutil.EpisodeStatusDraft,
	})
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORNOW01", Name: "Credited Creator"})
	pg.SeedEpisodeCreator(t, tenant.ID, published.ID, creator.ID, "")
	pg.SeedEpisodeCreator(t, tenant.ID, draft.ID, creator.ID, "")

	seriesFollower := pg.SeedEndUser(t, tenant.ID, "READERNOW001", "series@publish-now.example.com", "Series Follower")
	creatorFollower := pg.SeedEndUser(t, tenant.ID, "READERNOW002", "creator@publish-now.example.com", "Creator Follower")
	if _, err := pg.DB.ExecContext(ctx, "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", tenant.ID, seriesFollower.ID, series.ID); err != nil {
		t.Fatalf("follow series: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, "INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", tenant.ID, creatorFollower.ID, creator.ID); err != nil {
		t.Fatalf("follow creator: %v", err)
	}

	handler := NewEpisodePublishedNotificationHandler(EpisodePublishedNotificationHandlerConfig{DB: pg.DB})
	for _, episodeID := range []uuid.UUID{published.ID, draft.ID} {
		if err := handler(ctx, episodePublishedEvent(t, tenant.ID, episodeID)); err != nil {
			t.Fatalf("handler for %s: %v", episodeID, err)
		}
	}

	rows, err := pg.DB.QueryContext(ctx,
		"SELECT user_id, subject_key, payload FROM notifications WHERE notification_type = $1 ORDER BY user_id",
		NotificationTypeEpisodePublished,
	)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	recipients := map[uuid.UUID]bool{}
	for rows.Next() {
		var (
			userID     uuid.UUID
			subjectKey string
			payload    json.RawMessage
		)
		if err := rows.Scan(&userID, &subjectKey, &payload); err != nil {
			t.Fatalf("scan notification: %v", err)
		}
		if subjectKey != "episode:EPISODENOW01" {
			t.Fatalf("subject_key = %q, want the published episode's", subjectKey)
		}
		var body EpisodePublishedNotificationBody
		if err := json.Unmarshal(payload, &body); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if body.SeriesTitle != "Now Series" || body.EpisodeTitle != "Now Episode" {
			t.Fatalf("payload = %+v, want the published episode and its series", body)
		}
		recipients[userID] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate notifications: %v", err)
	}
	if len(recipients) != 2 || !recipients[seriesFollower.ID] || !recipients[creatorFollower.ID] {
		t.Fatalf("recipients = %v, want the series follower and the creator follower", recipients)
	}

	var pushes int
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT count(*) FROM outbox_events WHERE event_type = $1 AND idempotency_key = $2",
		EventTypeMemberPushNotification, "push:episode_published:episode:EPISODENOW01",
	).Scan(&pushes); err != nil {
		t.Fatalf("count pushes: %v", err)
	}
	if pushes != 1 {
		t.Fatalf("member push events = %d, want 1", pushes)
	}

	// A redelivered event writes nothing a second time.
	if err := handler(ctx, episodePublishedEvent(t, tenant.ID, published.ID)); err != nil {
		t.Fatalf("redelivered handler: %v", err)
	}
	var notifications int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM notifications").Scan(&notifications); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if notifications != 2 {
		t.Fatalf("notifications after redelivery = %d, want 2", notifications)
	}
}

// A credited creator can be followed through another series that is public,
// so the console can publish an episode that reaches a follower before any
// reader can open it. Nobody is told about it, and no push is queued.
func TestEpisodePublishedNotificationReachesNobodyWhileReadersCannotOpenTheEpisode(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "EPPUBHIDE001", "publish-hidden.example.com", "Publish Hidden Tenant")
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORHIDE1", Name: "Credited Creator"})
	public := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESHIDE01", Title: "Public Series", Published: true})
	pg.SeedSeriesCreator(t, tenant.ID, public.ID, creator.ID, "")

	unpublished := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESHIDE02", Title: "Unpublished Series"})
	upcoming := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESHIDE03",
		Title:       "Upcoming Series",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})
	webOnly := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:     "SERIESHIDE04",
		Title:        "Web Series",
		Published:    true,
		Availability: "web",
	})
	episodes := []uuid.UUID{
		pg.SeedEpisode(t, tenant.ID, unpublished.ID, testutil.EpisodeSeed{
			PublicID: "EPISODEHIDE1",
			Title:    "Episode of an unpublished series",
			Status:   testutil.EpisodeStatusPublished,
		}).ID,
		pg.SeedEpisode(t, tenant.ID, upcoming.ID, testutil.EpisodeSeed{
			PublicID: "EPISODEHIDE2",
			Title:    "Episode of an upcoming series",
			Status:   testutil.EpisodeStatusPublished,
		}).ID,
		// The episode's own Shown on narrows its series' and never widens it,
		// so an app-only episode in a web-only series is shown nowhere.
		pg.SeedEpisode(t, tenant.ID, webOnly.ID, testutil.EpisodeSeed{
			PublicID:     "EPISODEHIDE3",
			Title:        "Episode shown nowhere",
			Status:       testutil.EpisodeStatusPublished,
			Availability: "app",
		}).ID,
	}

	creatorFollower := pg.SeedEndUser(t, tenant.ID, "READERHIDE01", "creator@publish-hidden.example.com", "Creator Follower")
	if _, err := pg.DB.ExecContext(ctx, "INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", tenant.ID, creatorFollower.ID, creator.ID); err != nil {
		t.Fatalf("follow creator: %v", err)
	}
	// A series follow outlives the series being taken down, and an episode
	// follow the episode, so both are seeded straight into the tables.
	seriesFollower := pg.SeedEndUser(t, tenant.ID, "READERHIDE02", "series@publish-hidden.example.com", "Series Follower")
	episodeFollower := pg.SeedEndUser(t, tenant.ID, "READERHIDE03", "episode@publish-hidden.example.com", "Episode Follower")
	for _, seriesID := range []uuid.UUID{unpublished.ID, upcoming.ID, webOnly.ID} {
		if _, err := pg.DB.ExecContext(ctx, "INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", tenant.ID, seriesFollower.ID, seriesID); err != nil {
			t.Fatalf("follow series: %v", err)
		}
	}
	handler := NewEpisodePublishedNotificationHandler(EpisodePublishedNotificationHandlerConfig{DB: pg.DB})
	for _, episodeID := range episodes {
		pg.SeedEpisodeCreator(t, tenant.ID, episodeID, creator.ID, "")
		if _, err := pg.DB.ExecContext(ctx, "INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)", tenant.ID, episodeFollower.ID, episodeID); err != nil {
			t.Fatalf("follow episode: %v", err)
		}
		if err := handler(ctx, episodePublishedEvent(t, tenant.ID, episodeID)); err != nil {
			t.Fatalf("handler for %s: %v", episodeID, err)
		}
	}

	var notifications, pushes int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM notifications").Scan(&notifications); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if notifications != 0 {
		t.Fatalf("notifications = %d, want 0", notifications)
	}
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT count(*) FROM outbox_events WHERE event_type = $1", EventTypeMemberPushNotification,
	).Scan(&pushes); err != nil {
		t.Fatalf("count pushes: %v", err)
	}
	if pushes != 0 {
		t.Fatalf("member push events = %d, want 0", pushes)
	}
}
