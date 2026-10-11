package dbtest

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/testutil"
)

func episodeListing(t *testing.T, ctx context.Context, db *sql.DB, episodeID uuid.UUID) (publishedAt sql.NullTime, owed bool) {
	t.Helper()
	if err := db.QueryRowContext(ctx,
		"SELECT published_at, announcement_owed FROM episode_listings WHERE episode_id = $1", episodeID,
	).Scan(&publishedAt, &owed); err != nil {
		t.Fatalf("read episode listing: %v", err)
	}
	return publishedAt, owed
}

func oweAnnouncement(t *testing.T, ctx context.Context, db *sql.DB, episodeIDs ...uuid.UUID) {
	t.Helper()
	for _, episodeID := range episodeIDs {
		if _, err := db.ExecContext(ctx, "UPDATE episode_listings SET announcement_owed = true WHERE episode_id = $1", episodeID); err != nil {
			t.Fatalf("owe announcement: %v", err)
		}
	}
}

// The fan-out records an episode no reader can open as owing its announcement,
// so publishing its series later makes it, and one a reader can open as owing
// nothing.
func TestRecordEpisodeAnnouncementOwesItOnlyForAnEpisodeReadersCannotOpen(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	public := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Title: "Public", Published: true})
	hidden := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESHID001", Title: "Hidden"})
	open := pg.SeedEpisode(t, tenant.ID, public.ID, testutil.EpisodeSeed{PublicID: "EPISODEOPN01", Title: "Open", Status: testutil.EpisodeStatusPublished})
	held := pg.SeedEpisode(t, tenant.ID, hidden.ID, testutil.EpisodeSeed{PublicID: "EPISODEHLD01", Title: "Held", Status: testutil.EpisodeStatusPublished})

	record := func(episodeID uuid.UUID) {
		t.Helper()
		if err := q.RecordEpisodeAnnouncement(ctx, dbmodels.RecordEpisodeAnnouncementParams{TenantID: tenant.ID, EpisodeID: episodeID}); err != nil {
			t.Fatalf("RecordEpisodeAnnouncement: %v", err)
		}
	}
	record(open.ID)
	record(held.ID)

	if _, owed := episodeListing(t, ctx, pg.DB, open.ID); owed {
		t.Error("an episode readers can open owes its announcement")
	}
	if _, owed := episodeListing(t, ctx, pg.DB, held.ID); !owed {
		t.Error("an episode of a series that is not public owes no announcement")
	}

	// The fan-out over it once the series is public settles what it owed.
	if _, err := q.UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{
		ID: hidden.ID, PublishedAt: sql.NullTime{Time: time.Now().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatalf("UpdateSeriesPublication: %v", err)
	}
	record(held.ID)
	if _, owed := episodeListing(t, ctx, pg.DB, held.ID); owed {
		t.Error("an episode announced once its series was public still owes its announcement")
	}
}

// Publishing a series dates the episodes added while it was hidden from its
// instant and names them for an announcement; an episode announced while the
// series was public before, one no reader can open, and a draft are left as
// they are.
func TestRedateEpisodesForSeriesPublication(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now().UTC().Truncate(time.Microsecond)
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRED001", Title: "Republished", Availability: "web"})

	// Announced while the series was public before, so it owes nothing.
	announced := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEANN01", Title: "Announced", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-3 * time.Hour),
	})
	added := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEADD01", Title: "Added while hidden", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-2 * time.Hour),
	})
	// The episode's own Shown on narrows its series' and never widens it, so
	// an app-only episode in a web-only series is shown nowhere.
	nowhere := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODENOW01", Title: "Shown nowhere", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-2 * time.Hour), Availability: "app",
	})
	draft := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEDRF01", Title: "Draft"})
	oweAnnouncement(t, ctx, pg.DB, added.ID, nowhere.ID)

	redate := func() []dbmodels.RedateEpisodesForSeriesPublicationRow {
		t.Helper()
		rows, err := q.RedateEpisodesForSeriesPublication(ctx, dbmodels.RedateEpisodesForSeriesPublicationParams{TenantID: tenant.ID, SeriesID: series.ID})
		if err != nil {
			t.Fatalf("RedateEpisodesForSeriesPublication: %v", err)
		}
		return rows
	}
	publish := func(publishedAt time.Time) {
		t.Helper()
		if _, err := q.UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{
			ID: series.ID, PublishedAt: sql.NullTime{Time: publishedAt, Valid: true},
		}); err != nil {
			t.Fatalf("UpdateSeriesPublication: %v", err)
		}
	}

	if rows := redate(); len(rows) != 0 {
		t.Fatalf("redated %v for a series that is not public, want none", rows)
	}

	publishedAt := now.Add(-time.Minute)
	publish(publishedAt)
	rows := redate()
	want := []dbmodels.RedateEpisodesForSeriesPublicationRow{{EpisodeID: added.ID, SeriesPublishedAt: publishedAt}}
	if !slices.EqualFunc(rows, want, func(a, b dbmodels.RedateEpisodesForSeriesPublicationRow) bool {
		return a.EpisodeID == b.EpisodeID && a.SeriesPublishedAt.Equal(b.SeriesPublishedAt)
	}) {
		t.Fatalf("redated %+v, want only the episode added while the series was hidden %+v", rows, want)
	}

	if got, _ := episodeListing(t, ctx, pg.DB, added.ID); !got.Valid || !got.Time.Equal(publishedAt) {
		t.Errorf("published_at of the episode added while hidden = %v, want the series' instant %v", got, publishedAt)
	}
	for _, untouched := range []struct {
		name string
		id   uuid.UUID
		want sql.NullTime
	}{
		{name: "announced", id: announced.ID, want: sql.NullTime{Time: now.Add(-3 * time.Hour), Valid: true}},
		{name: "shown nowhere", id: nowhere.ID, want: sql.NullTime{Time: now.Add(-2 * time.Hour), Valid: true}},
		{name: "draft", id: draft.ID},
	} {
		got, _ := episodeListing(t, ctx, pg.DB, untouched.id)
		if got.Valid != untouched.want.Valid || !got.Time.Equal(untouched.want.Time) {
			t.Errorf("published_at of the %s episode = %v, want it left at %v", untouched.name, got, untouched.want)
		}
	}
}

// A series saved with an instant in the past was still not public before the
// save, so an episode published after that instant keeps its own date rather
// than being dated before it was published.
func TestRedateEpisodesForSeriesPublicationKeepsALaterEpisodeDate(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now().UTC().Truncate(time.Microsecond)
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESBAK001", Title: "Backdated"})
	episodePublishedAt := now.Add(-time.Hour)
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEBAK01", Title: "Later", Status: testutil.EpisodeStatusPublished, PublishedAt: episodePublishedAt,
	})
	oweAnnouncement(t, ctx, pg.DB, episode.ID)

	if _, err := q.UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{
		ID: series.ID, PublishedAt: sql.NullTime{Time: now.Add(-24 * time.Hour), Valid: true},
	}); err != nil {
		t.Fatalf("UpdateSeriesPublication: %v", err)
	}
	rows, err := q.RedateEpisodesForSeriesPublication(ctx, dbmodels.RedateEpisodesForSeriesPublicationParams{TenantID: tenant.ID, SeriesID: series.ID})
	if err != nil {
		t.Fatalf("RedateEpisodesForSeriesPublication: %v", err)
	}
	if len(rows) != 1 || rows[0].EpisodeID != episode.ID {
		t.Fatalf("redated %+v, want the episode named for its announcement", rows)
	}
	if got, _ := episodeListing(t, ctx, pg.DB, episode.ID); !got.Time.Equal(episodePublishedAt) {
		t.Errorf("published_at = %v, want the episode's own %v", got.Time, episodePublishedAt)
	}
}
