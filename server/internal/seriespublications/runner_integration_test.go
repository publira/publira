package seriespublications

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/outbox"
	"github.com/publira/publira/server/internal/tenantwebhooks"
	"github.com/publira/publira/server/internal/testutil"
)

// A series taken private and given a new episode is published again by its
// scheduled instant arriving, before the event the console queued for the
// episode has drained. The publication recorded the announcement the episode
// owes, so the job still finds it: the episode is dated from the series'
// instant and announced, once, to the followers of the episode, the series,
// and its credited Author, however the two events interleave. The episode
// announced while the series was public before owes nothing, as does any
// listing written outside a publication, so it keeps its date and is not
// announced again.
func TestRunOnceAnnouncesTheEpisodesAddedWhileTheSeriesWasPrivate(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	now := time.Now().UTC().Truncate(time.Microsecond)
	tenant := pg.SeedTenant(t, "TENANTREPUB1", "republish.example.com", "Republish Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESREPUB1", Title: "Republished Series"})
	earlier := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEREP01", Title: "Announced Before", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-48 * time.Hour),
	})
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

	// The console publishes the new episode while the series is private, and
	// records in that transaction the announcement it owes.
	if err := dbmodels.New(pg.DB).OweEpisodeAnnouncementWhileSeriesHidden(ctx, dbmodels.OweEpisodeAnnouncementWhileSeriesHiddenParams{
		TenantID: tenant.ID, EpisodeID: added.ID,
	}); err != nil {
		t.Fatalf("OweEpisodeAnnouncementWhileSeriesHidden: %v", err)
	}

	// A delivery of the console's event while the series is private reaches
	// nobody, and leaves what the episode owes where the publication put it.
	handler := outbox.NewEpisodePublishedNotificationHandler(outbox.EpisodePublishedNotificationHandlerConfig{DB: pg.OpenOutboxDB(t)})
	if err := handler(ctx, consolePublicationEvent(t, tenant.ID, added.ID)); err != nil {
		t.Fatalf("console publication handler: %v", err)
	}
	var notifications int
	if err := pg.DB.QueryRowContext(ctx, "SELECT count(*) FROM notifications").Scan(&notifications); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if notifications != 0 {
		t.Fatalf("notifications while the series is private = %d, want 0", notifications)
	}

	// The series' scheduled instant passes.
	publishedAt := now.Add(-time.Minute)
	if _, err := pg.DB.ExecContext(ctx, "UPDATE series SET is_published = true, published_at = $2 WHERE id = $1", series.ID, publishedAt); err != nil {
		t.Fatalf("publish series: %v", err)
	}

	// The job and the handler run as the logins they run as in production, so
	// a statement either was never granted fails here.
	tickerDB := pg.OpenTickerDB(t)
	ticker := dbmodels.New(tickerDB)
	runner := New(tickerDB, ticker, nil, nil)
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

	// The console's own event drains again after the series' announcement, as
	// a redelivery would: every follower is told once.
	for _, drained := range []dbmodels.OutboxEvent{event, consolePublicationEvent(t, tenant.ID, added.ID), consolePublicationEvent(t, tenant.ID, added.ID)} {
		if err := handler(ctx, drained); err != nil {
			t.Fatalf("announcement handler for %s: %v", drained.IdempotencyKey, err)
		}
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

	var owed bool
	if err := pg.DB.QueryRowContext(ctx, "SELECT announcement_owed FROM episode_listings WHERE episode_id = $1", added.ID).Scan(&owed); err != nil {
		t.Fatalf("read episode listing: %v", err)
	}
	if owed {
		t.Error("the episode still owes its announcement once it is queued")
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

func consolePublicationEvent(t *testing.T, tenantID, episodeID uuid.UUID) dbmodels.OutboxEvent {
	t.Helper()
	payload, err := json.Marshal(outbox.EpisodePublishedNotificationPayload{TenantID: tenantID.String(), EpisodeID: episodeID.String()})
	if err != nil {
		t.Fatalf("encode payload: %v", err)
	}
	return dbmodels.OutboxEvent{
		ID:             uuid.Must(uuid.NewV7()),
		TenantID:       uuid.NullUUID{UUID: tenantID, Valid: true},
		EventType:      outbox.EventTypeEpisodePublishedNotification,
		Payload:        payload,
		IdempotencyKey: outbox.EpisodePublishedIdempotencyKey(episodeID),
	}
}

// A series made public by its scheduled instant arriving owes episode.published
// to the endpoints that subscribed to it, once for each episode published in
// it, saying the series put it back on the site, and neither for a draft nor
// to an endpoint that did not subscribe. A pass that stopped before marking
// the publication applied is repeated in full by the next, which owes nothing
// twice.
func TestRunOnceOwesTheWebhooksEveryEpisodePublishedInTheSeries(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	now := time.Now().UTC().Truncate(time.Microsecond)
	tenant := pg.SeedTenant(t, "TENANTHOOK01", "hooks.example.com", "Hook Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESHOOK01", Title: "Returning Series"})
	first := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEHOOK1", Title: "First", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-48 * time.Hour),
	})
	second := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEHOOK2", Title: "Second", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-24 * time.Hour),
	})
	pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEHOOK3", Title: "Draft"})
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $3, 'https://cms.example.com/publira', 'sealed', 'whsec_••••', ARRAY['episode.published']),
			($2, $3, 'https://crm.example.com/publira', 'sealed', 'whsec_••••', ARRAY['purchase.completed'])
	`, uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), tenant.ID); err != nil {
		t.Fatalf("insert webhook endpoints: %v", err)
	}

	// The series' scheduled instant passes.
	if _, err := pg.DB.ExecContext(ctx, "UPDATE series SET is_published = true, published_at = $2 WHERE id = $1", series.ID, now.Add(-time.Minute)); err != nil {
		t.Fatalf("publish series: %v", err)
	}

	// The job runs as the login it runs as in production, so a statement it
	// was never granted fails here.
	ticker := pg.OpenTickerDB(t)
	runner := New(ticker, dbmodels.New(ticker), nil, nil)
	runner.RunOnce(ctx)
	if _, err := pg.DB.ExecContext(ctx, "UPDATE series SET publication_revalidated_at = NULL WHERE id = $1", series.ID); err != nil {
		t.Fatalf("leave the publication unapplied: %v", err)
	}
	runner.RunOnce(ctx)

	got := episodePublishedDeliveries(t, ctx, pg, tenant.ID)
	want := []tenantwebhooks.Episode{
		{EpisodePublicID: first.PublicID, SeriesPublicID: series.PublicID, Title: "First", PublishedAt: listingPublishedAt(t, ctx, pg, first.ID).UTC().Format(time.RFC3339), Published: tenantwebhooks.PublishedSeries},
		{EpisodePublicID: second.PublicID, SeriesPublicID: series.PublicID, Title: "Second", PublishedAt: listingPublishedAt(t, ctx, pg, second.ID).UTC().Format(time.RFC3339), Published: tenantwebhooks.PublishedSeries},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("deliveries = %+v, want %+v", got, want)
	}
}

// A series hidden after the listing read it, before the pass reached it, owes
// no webhook: the hide took its episodes off the site, and an event saying
// they came back would follow the hide's own.
func TestRunOnceOwesNoWebhookForASeriesHiddenSinceTheListing(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	now := time.Now().UTC().Truncate(time.Microsecond)
	tenant := pg.SeedTenant(t, "TENANTHOOK02", "hooks-hidden.example.com", "Hook Hidden Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESHOOK02", Title: "Hidden Again"})
	pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEHOOK4", Title: "Published", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-24 * time.Hour),
	})
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $2, 'https://cms.example.com/publira', 'sealed', 'whsec_••••', ARRAY['episode.published'])
	`, uuid.Must(uuid.NewV7()), tenant.ID); err != nil {
		t.Fatalf("insert webhook endpoint: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, "UPDATE series SET is_published = true, published_at = $2 WHERE id = $1", series.ID, now.Add(-time.Minute)); err != nil {
		t.Fatalf("publish series: %v", err)
	}

	ticker := pg.OpenTickerDB(t)
	queries := dbmodels.New(ticker)
	due, err := queries.ListSeriesPublicationsDue(ctx)
	if err != nil || len(due) != 1 {
		t.Fatalf("ListSeriesPublicationsDue = %+v, %v, want the series", due, err)
	}
	if _, err := pg.DB.ExecContext(ctx, "UPDATE series SET is_published = false, published_at = NULL WHERE id = $1", series.ID); err != nil {
		t.Fatalf("hide series: %v", err)
	}

	if err := New(ticker, queries, nil, nil).announceEpisodes(ctx, tenant.ID, due[0]); err != nil {
		t.Fatalf("announceEpisodes: %v", err)
	}
	if got := episodePublishedDeliveries(t, ctx, pg, tenant.ID); len(got) != 0 {
		t.Fatalf("deliveries = %+v, want none for a series hidden since the listing", got)
	}
}

// An episode taken back to a draft while the publication of its series waits
// on its listing is left out of the publication's events: the save that takes
// it off the site holds the listing, and owes its own episode.unpublished, so
// an episode.published owed after it would tell a mirror to restore a draft.
func TestRunOnceOwesNoWebhookForAnEpisodeWithdrawnWhileTheSeriesIsPublished(t *testing.T) {
	t.Parallel()
	pg := testutil.StartIsolatedPostgres(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	now := time.Now().UTC().Truncate(time.Microsecond)
	tenant := pg.SeedTenant(t, "TENANTHOOK03", "hooks-withdrawn.example.com", "Hook Withdrawn Tenant")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESHOOK03", Title: "Returning Series"})
	kept := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEHOOK5", Title: "Kept", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-48 * time.Hour),
	})
	withdrawn := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEHOOK6", Title: "Withdrawn", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-24 * time.Hour),
	})
	if _, err := pg.DB.ExecContext(ctx, `
		INSERT INTO tenant_webhook_endpoints (id, tenant_id, url, secret_encrypted, secret_hint, event_types)
		VALUES ($1, $2, 'https://cms.example.com/publira', 'sealed', 'whsec_••••', ARRAY['episode.published'])
	`, uuid.Must(uuid.NewV7()), tenant.ID); err != nil {
		t.Fatalf("insert webhook endpoint: %v", err)
	}
	if _, err := pg.DB.ExecContext(ctx, "UPDATE series SET is_published = true, published_at = $2 WHERE id = $1", series.ID, now.Add(-time.Minute)); err != nil {
		t.Fatalf("publish series: %v", err)
	}

	ticker := pg.OpenTickerDB(t)
	queries := dbmodels.New(ticker)
	due, err := queries.ListSeriesPublicationsDue(ctx)
	if err != nil || len(due) != 1 {
		t.Fatalf("ListSeriesPublicationsDue = %+v, %v, want the series", due, err)
	}

	// The save takes the episode back to a draft, as UpdateEpisodePublishSchedule
	// does, and has not committed yet.
	save, err := pg.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin the save: %v", err)
	}
	defer save.Rollback() //nolint:errcheck
	saveQueries := dbmodels.New(save)
	if err := saveQueries.LockEpisodeListingForScheduleSave(ctx, dbmodels.LockEpisodeListingForScheduleSaveParams{TenantID: tenant.ID, EpisodeID: withdrawn.ID}); err != nil {
		t.Fatalf("LockEpisodeListingForScheduleSave: %v", err)
	}
	saved, err := saveQueries.UpdateEpisodePublishScheduleByIDForTenant(ctx, dbmodels.UpdateEpisodePublishScheduleByIDForTenantParams{TenantID: tenant.ID, ID: withdrawn.ID})
	if err != nil || !saved.WithdrawsPublication {
		t.Fatalf("UpdateEpisodePublishScheduleByIDForTenant = %+v, %v, want the publication taken back", saved, err)
	}

	passed := make(chan error, 1)
	go func() {
		passed <- New(ticker, queries, nil, nil).announceEpisodes(ctx, tenant.ID, due[0])
	}()
	// The pass waits on the listing the save holds before the save commits.
	for {
		var waiting int
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
		).Scan(&waiting); err != nil {
			t.Fatalf("read the waiting backends: %v", err)
		}
		if waiting > 0 {
			break
		}
		select {
		case err := <-passed:
			t.Fatalf("announceEpisodes returned %v without waiting on the listing the save holds", err)
		case <-ctx.Done():
			t.Fatal("the pass never waited on the listing the save holds")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if err := save.Commit(); err != nil {
		t.Fatalf("commit the save: %v", err)
	}
	if err := <-passed; err != nil {
		t.Fatalf("announceEpisodes: %v", err)
	}

	got := episodePublishedDeliveries(t, ctx, pg, tenant.ID)
	if len(got) != 1 || got[0].EpisodePublicID != kept.PublicID {
		t.Fatalf("deliveries = %+v, want only %s, which is still published", got, kept.PublicID)
	}
}

// episodePublishedDeliveries answers the data of every episode.published
// delivery owed on the tenant, by episode, failing the test on one owed to an
// endpoint other than the one that subscribed to it.
func episodePublishedDeliveries(t *testing.T, ctx context.Context, pg *testutil.PostgresEnv, tenantID uuid.UUID) []tenantwebhooks.Episode {
	t.Helper()
	rows, err := pg.DB.QueryContext(ctx, `
		SELECT e.url, d.payload->'data'
		FROM webhook_deliveries d
			JOIN tenant_webhook_endpoints e ON e.id = d.endpoint_id
		WHERE d.tenant_id = $1 AND d.event_type = 'episode.published'
		ORDER BY d.payload->'data'->>'episode_public_id'
	`, tenantID)
	if err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	var got []tenantwebhooks.Episode
	for rows.Next() {
		var (
			url  string
			data []byte
		)
		if err := rows.Scan(&url, &data); err != nil {
			t.Fatalf("scan a delivery: %v", err)
		}
		if url != "https://cms.example.com/publira" {
			t.Errorf("delivery to %s, want only the subscribed endpoint", url)
		}
		var episode tenantwebhooks.Episode
		if err := json.Unmarshal(data, &episode); err != nil {
			t.Fatalf("decode a delivery's data %s: %v", data, err)
		}
		got = append(got, episode)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list the deliveries: %v", err)
	}
	return got
}
