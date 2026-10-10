package seriespublications

import (
	"bytes"
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/testutil"
)

// A series taken private and given a new episode is published again by its
// scheduled instant arriving. The new episode is dated from that instant and
// announced, once, to the followers of the episode, the series, and its
// credited Author; the episode announced while the series was public before
// keeps its date and is not announced again.
func TestRunOnceAnnouncesTheEpisodesAddedWhileTheSeriesWasPrivate(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	now := time.Now().UTC().Truncate(time.Microsecond)
	tenant := pg.SeedTenant(t, "TENANTREPUB1", "republish.example.com", "Republish Tenant")
	publishedAt := now.Add(-time.Minute)
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREPUB1", Title: "Republished Series", Published: true, PublishedAt: publishedAt})
	earlier := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEREP01", Title: "Announced Before", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-48 * time.Hour),
	})
	if _, err := pg.DB.ExecContext(ctx, "UPDATE episode_listings SET announced_at = published_at WHERE episode_id = $1", earlier.ID); err != nil {
		t.Fatalf("mark announced: %v", err)
	}
	added := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEREP02", Title: "Added While Private", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-2 * time.Hour),
	})
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORREP01", Name: "Credited Author"})
	pg.SeedEpisodeCreator(t, tenant.ID, earlier.ID, creator.ID, "")
	pg.SeedEpisodeCreator(t, tenant.ID, added.ID, creator.ID, "")

	seriesFollower := pg.SeedEndUser(t, tenant.ID, "READERREP001", "series@republish.example.com", "Series Follower")
	creatorFollower := pg.SeedEndUser(t, tenant.ID, "READERREP002", "creator@republish.example.com", "Author Follower")
	episodeFollower := pg.SeedEndUser(t, tenant.ID, "READERREP003", "episode@republish.example.com", "Episode Follower")
	for _, follow := range []struct {
		statement string
		userID    uuid.UUID
		targetID  uuid.UUID
	}{
		{"INSERT INTO series_follows (tenant_id, user_id, series_id) VALUES ($1, $2, $3)", seriesFollower.ID, series.ID},
		{"INSERT INTO creator_follows (tenant_id, user_id, creator_id) VALUES ($1, $2, $3)", creatorFollower.ID, creator.ID},
		{"INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)", episodeFollower.ID, added.ID},
		{"INSERT INTO episode_follows (tenant_id, user_id, episode_id) VALUES ($1, $2, $3)", episodeFollower.ID, earlier.ID},
	} {
		if _, err := pg.DB.ExecContext(ctx, follow.statement, tenant.ID, follow.userID, follow.targetID); err != nil {
			t.Fatalf("follow: %v", err)
		}
	}

	// The logins the job and the handler run as in production, so a statement
	// either one was never granted fails here.
	ticker := dbmodels.New(pg.OpenTickerDB(t))
	runner := New(ticker, nil, nil)
	runner.RunOnce(ctx)

	addedPublishedAt := listingPublishedAt(t, ctx, pg, added.ID)
	if !addedPublishedAt.Equal(publishedAt) {
		t.Errorf("published_at of the episode added while private = %v, want the series' instant %v", addedPublishedAt, publishedAt)
	}
	if got, want := listingPublishedAt(t, ctx, pg, earlier.ID), now.Add(-48*time.Hour); !got.Equal(want) {
		t.Errorf("published_at of the episode announced before = %v, want it kept at %v", got, want)
	}

	adminQueries := dbmodels.New(pg.DB)
	event, err := adminQueries.GetOutboxEventByIdempotencyKey(ctx, outbox.SeriesPublicationIdempotencyKey(added.ID, publishedAt))
	if err != nil {
		t.Fatalf("announcement event of the episode added while private: %v", err)
	}
	var announcements, syncs int
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT count(*) FILTER (WHERE event_type = $1), count(*) FILTER (WHERE event_type = $2) FROM outbox_events",
		outbox.EventTypeEpisodePublishedNotification, outbox.EventTypeCatalogIndexSync,
	).Scan(&announcements, &syncs); err != nil {
		t.Fatalf("count outbox events: %v", err)
	}
	if announcements != 1 {
		t.Errorf("announcement events = %d, want one, for the episode added while private", announcements)
	}
	if syncs != 1 {
		t.Errorf("catalog index sync events = %d, want one for the series' new latest episode", syncs)
	}

	handler := outbox.NewEpisodePublishedNotificationHandler(outbox.EpisodePublishedNotificationHandlerConfig{DB: pg.OpenOutboxDB(t)})
	if err := handler(ctx, event); err != nil {
		t.Fatalf("announcement handler: %v", err)
	}

	rows, err := pg.DB.QueryContext(ctx, "SELECT user_id, subject_key FROM notifications WHERE notification_type = $1", outbox.NotificationTypeEpisodePublished)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var recipients []uuid.UUID
	for rows.Next() {
		var (
			userID     uuid.UUID
			subjectKey string
		)
		if err := rows.Scan(&userID, &subjectKey); err != nil {
			t.Fatalf("scan notification: %v", err)
		}
		if subjectKey != "episode:"+added.PublicID {
			t.Errorf("notification about %q, want only the episode added while private", subjectKey)
		}
		recipients = append(recipients, userID)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate notifications: %v", err)
	}
	want := []uuid.UUID{seriesFollower.ID, creatorFollower.ID, episodeFollower.ID}
	byBytes := func(a, b uuid.UUID) int { return bytes.Compare(a[:], b[:]) }
	slices.SortFunc(recipients, byBytes)
	slices.SortFunc(want, byBytes)
	if !slices.Equal(recipients, want) {
		t.Errorf("recipients = %v, want the series, Author, and episode followers %v", recipients, want)
	}

	// The publication is applied, and the episode announced, so neither the
	// next pass nor another publication of the series announces it again.
	runner.RunOnce(ctx)
	again, err := outbox.QueueSeriesPublicationAnnouncements(ctx, ticker, tenant.ID, series.ID)
	if err != nil {
		t.Fatalf("QueueSeriesPublicationAnnouncements: %v", err)
	}
	if again != 0 {
		t.Errorf("announcements queued after the episode was announced = %d, want 0", again)
	}
}

func listingPublishedAt(t *testing.T, ctx context.Context, pg *testutil.PostgresEnv, episodeID uuid.UUID) time.Time {
	t.Helper()
	var publishedAt sql.NullTime
	if err := pg.DB.QueryRowContext(ctx, "SELECT published_at FROM episode_listings WHERE episode_id = $1", episodeID).Scan(&publishedAt); err != nil {
		t.Fatalf("read episode listing: %v", err)
	}
	return publishedAt.Time
}
