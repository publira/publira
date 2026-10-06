package catalogindex_test

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/catalogsearch"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/freewindows"
	"github.com/publira/publira/server/internal/publishedseries"
	"github.com/publira/publira/server/internal/publishepisodes"
	"github.com/publira/publira/server/internal/testutil"
)

// assertSeries runs a narrowed or sorted series search for "seed" and compares
// the hits, in order.
func (i index) assertSeries(t *testing.T, tenantID uuid.UUID, surface string, order publishedseries.Order, filter publishedseries.Filter, want ...uuid.UUID) {
	t.Helper()
	page, err := i.backend.SearchSeries(context.Background(), catalogsearch.SeriesRequest{
		Request: catalogsearch.Request{TenantID: tenantID, Surface: surface, Query: "seed", Limit: 10},
		Order:   order,
		Filter:  filter,
	})
	if err != nil {
		t.Fatalf("search %s %+v on %s: %v", order.Name, filter, surface, err)
	}
	if !slices.Equal(page.IDs, want) {
		t.Fatalf("search %s %+v on %s = %v, want %v", order.Name, filter, surface, page.IDs, want)
	}
}

// A series document is written with what the published series list reads from
// the database, so the search keeps and orders the hits the list would.
func TestASeriesDocumentCarriesWhatTheListNarrowsAndSortsBy(t *testing.T) {
	testutil.EachSearchEngine(t, func(t *testing.T, engine testutil.SearchEngine) {
		pg := testutil.StartPostgres(t)
		pg.Reset(t)
		idx := newIndex(t, engine)
		ctx := context.Background()
		handler := syncHandler(t, pg, idx)
		now := time.Now()

		tenant := pg.SeedTenant(t, "INDEXFACTS01", "index-facts.example.com", "Index Facts Tenant")
		genre := pg.SeedGenre(t, tenant.ID, testutil.GenreSeed{Name: "Mystery"})
		tag := pg.SeedTag(t, tenant.ID, testutil.TagSeed{Name: "Found Family"})

		// Alpha has the genre, the tag, a weekday, and a free episode everywhere.
		alpha := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID: "INDEXFACTS02", Title: "Seed Alpha", Published: true, PublishedAt: now.Add(-3 * time.Hour),
			Status: "completed", ScheduleWeekdays: []int32{3},
		})
		pg.SeedSeriesGenre(t, tenant.ID, alpha.ID, genre.ID)
		pg.SeedSeriesTag(t, tenant.ID, alpha.ID, tag.ID)
		pg.SeedEpisode(t, tenant.ID, alpha.ID, testutil.EpisodeSeed{
			PublicID: "INDEXFACTS03", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-time.Hour),
		})
		// Bravo's newest episode is free and on the app alone, so on the web it is
		// neither free nor newer than the priced one before it.
		bravo := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID: "INDEXFACTS04", Title: "Seed Bravo", Published: true, PublishedAt: now.Add(-2 * time.Hour),
		})
		pg.SeedEpisode(t, tenant.ID, bravo.ID, testutil.EpisodeSeed{
			PublicID: "INDEXFACTS05", Price: 100, Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-30 * time.Minute),
		})
		pg.SeedEpisode(t, tenant.ID, bravo.ID, testutil.EpisodeSeed{
			PublicID: "INDEXFACTS06", Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-10 * time.Minute), Availability: "app",
		})
		// Charlie has no episode, so its latest episode is its own publication.
		charlie := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID: "INDEXFACTS07", Title: "Seed Charlie", Published: true, PublishedAt: now.Add(-4 * time.Hour),
		})

		if err := catalogindex.Queue(ctx, dbmodels.New(pg.DB), tenant.ID, catalogindex.SeriesRef(alpha.ID), catalogindex.SeriesRef(bravo.ID), catalogindex.SeriesRef(charlie.ID)); err != nil {
			t.Fatalf("Queue: %v", err)
		}
		drain(t, pg, handler)
		idx.refresh(t)

		title := publishedseries.TitleAsc
		idx.assertSeries(t, tenant.ID, testSurface, title, publishedseries.Filter{HasFreeEpisodes: true}, alpha.ID)
		idx.assertSeries(t, tenant.ID, "app", title, publishedseries.Filter{HasFreeEpisodes: true}, alpha.ID, bravo.ID)
		idx.assertSeries(t, tenant.ID, testSurface, title, publishedseries.Filter{GenrePublicID: sql.NullString{String: genre.PublicID, Valid: true}}, alpha.ID)
		idx.assertSeries(t, tenant.ID, testSurface, title, publishedseries.Filter{TagSlug: sql.NullString{String: tag.Slug, Valid: true}}, alpha.ID)
		idx.assertSeries(t, tenant.ID, testSurface, title, publishedseries.Filter{Status: sql.NullString{String: "completed", Valid: true}}, alpha.ID)
		idx.assertSeries(t, tenant.ID, testSurface, title, publishedseries.Filter{Status: sql.NullString{String: "ongoing", Valid: true}}, bravo.ID, charlie.ID)
		idx.assertSeries(t, tenant.ID, testSurface, title, publishedseries.Filter{Weekday: sql.NullInt16{Int16: 3, Valid: true}}, alpha.ID)

		idx.assertSeries(t, tenant.ID, testSurface, publishedseries.PublishedAtDesc, publishedseries.Filter{}, bravo.ID, alpha.ID, charlie.ID)
		idx.assertSeries(t, tenant.ID, testSurface, publishedseries.LatestEpisodeAtDesc, publishedseries.Filter{}, bravo.ID, alpha.ID, charlie.ID)
		idx.assertSeries(t, tenant.ID, "app", publishedseries.LatestEpisodeAtDesc, publishedseries.Filter{}, bravo.ID, alpha.ID, charlie.ID)

		// A change to what a filter reads reaches the index through the series'
		// event like any other edit.
		if _, err := pg.DB.ExecContext(ctx, "UPDATE series_listings SET status = 'completed' WHERE series_id = $1", charlie.ID); err != nil {
			t.Fatalf("complete charlie: %v", err)
		}
		if err := catalogindex.Queue(ctx, dbmodels.New(pg.DB), tenant.ID, catalogindex.SeriesRef(charlie.ID)); err != nil {
			t.Fatalf("Queue: %v", err)
		}
		drain(t, pg, handler)
		idx.refresh(t)
		idx.assertSeries(t, tenant.ID, testSurface, title, publishedseries.Filter{Status: sql.NullString{String: "completed", Valid: true}}, alpha.ID, charlie.ID)
	})
}

// Whether a free episode is open and which episode is a series' latest change
// when an instant passes rather than when a row is written. The ticker jobs
// that act on those instants queue the series' sync, so the search follows
// within the drain's delay.
func TestTheTickerJobsCarryClockBoundariesIntoTheIndex(t *testing.T) {
	testutil.EachSearchEngine(t, func(t *testing.T, engine testutil.SearchEngine) {
		pg := testutil.StartPostgres(t)
		pg.Reset(t)
		idx := newIndex(t, engine)
		ctx := context.Background()
		handler := syncHandler(t, pg, idx)
		logger := slog.New(slog.NewTextHandler(io.Discard, nil))
		tickerDB := pg.OpenTickerDB(t)
		now := time.Now()

		tenant := pg.SeedTenant(t, "INDEXCLOCK01", "index-clock.example.com", "Index Clock Tenant")
		alpha := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXCLOCK02", Title: "Seed Alpha", Published: true, PublishedAt: now.Add(-3 * time.Hour)})
		pg.SeedEpisode(t, tenant.ID, alpha.ID, testutil.EpisodeSeed{
			PublicID: "INDEXCLOCK03", Price: 100, Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-2 * time.Hour),
		})
		pg.SeedEpisode(t, tenant.ID, alpha.ID, testutil.EpisodeSeed{
			PublicID: "INDEXCLOCK04", Price: 100, Status: testutil.EpisodeStatusScheduled, ScheduledAt: now.Add(-time.Second),
		})
		bravo := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "INDEXCLOCK05", Title: "Seed Bravo", Published: true, PublishedAt: now.Add(-3 * time.Hour)})
		priced := pg.SeedEpisode(t, tenant.ID, bravo.ID, testutil.EpisodeSeed{
			PublicID: "INDEXCLOCK06", Price: 100, Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(-time.Hour),
		})
		opens := now.Add(2 * time.Second)
		closes := opens.Add(2 * time.Second)
		pg.SeedEpisodeFreeWindow(t, tenant.ID, priced.ID, opens, closes)

		if err := catalogindex.Queue(ctx, dbmodels.New(pg.DB), tenant.ID, catalogindex.SeriesRef(alpha.ID), catalogindex.SeriesRef(bravo.ID)); err != nil {
			t.Fatalf("Queue: %v", err)
		}
		drain(t, pg, handler)
		idx.refresh(t)
		free := publishedseries.Filter{HasFreeEpisodes: true}
		idx.assertSeries(t, tenant.ID, testSurface, publishedseries.LatestEpisodeAtDesc, publishedseries.Filter{}, bravo.ID, alpha.ID)
		idx.assertSeries(t, tenant.ID, testSurface, publishedseries.TitleAsc, free)

		// Publishing the scheduled episode makes it Alpha's latest.
		publishepisodes.New(tickerDB, nil, nil, logger, 0).RunOnce(ctx)
		drain(t, pg, handler)
		idx.refresh(t)
		idx.assertSeries(t, tenant.ID, testSurface, publishedseries.LatestEpisodeAtDesc, publishedseries.Filter{}, alpha.ID, bravo.ID)

		windows := freewindows.New(dbmodels.New(tickerDB), nil, logger)
		time.Sleep(time.Until(opens) + 100*time.Millisecond)
		windows.RunOnce(ctx)
		drain(t, pg, handler)
		idx.refresh(t)
		idx.assertSeries(t, tenant.ID, testSurface, publishedseries.TitleAsc, free, bravo.ID)

		time.Sleep(time.Until(closes) + 100*time.Millisecond)
		windows.RunOnce(ctx)
		drain(t, pg, handler)
		idx.refresh(t)
		idx.assertSeries(t, tenant.ID, testSurface, publishedseries.TitleAsc, free)
	})
}
