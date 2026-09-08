package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	"github.com/publira/publira/server/internal/testutil"
)

// insertFreeWindow writes one window directly, so a test can assert on the
// error the database answers with rather than on a handler's translation of it.
func insertFreeWindow(
	ctx context.Context,
	pg *testutil.PostgresEnv,
	tenantID, episodeID uuid.UUID,
	publicID string,
	startsAt, endsAt time.Time,
) error {
	_, err := pg.DB.ExecContext(ctx, `
		INSERT INTO episode_free_windows (id, tenant_id, public_id, episode_id, starts_at, ends_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, uuid.Must(uuid.NewV7()), tenantID, publicID, episodeID, startsAt, endsAt)
	return err
}

// The non-overlap rule is the reason "free until" can be answered with a single
// instant, so it is enforced by the database rather than by whichever handler
// writes the row.
func TestEpisodeFreeWindowsCannotOverlapOnOneEpisode(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series A", Published: true})
	first := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEONE01", Title: "One", Status: testutil.EpisodeStatusPublished, Price: 500})
	second := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODETWO01", Title: "Two", Status: testutil.EpisodeStatusPublished, Price: 500})

	base := time.Now().UTC().Truncate(time.Hour)
	if err := insertFreeWindow(ctx, pg, tenant.ID, first.ID, "FREEWINDOW01", base, base.Add(2*time.Hour)); err != nil {
		t.Fatalf("insert the first window: %v", err)
	}

	overlapping := insertFreeWindow(ctx, pg, tenant.ID, first.ID, "FREEWINDOW02", base.Add(time.Hour), base.Add(3*time.Hour))
	if !dberr.IsExclusionViolation(overlapping) {
		t.Fatalf("insert of an overlapping window = %v, want an exclusion violation", overlapping)
	}

	// The period is half-open, so a window may start where another ends.
	if err := insertFreeWindow(ctx, pg, tenant.ID, first.ID, "FREEWINDOW03", base.Add(2*time.Hour), base.Add(3*time.Hour)); err != nil {
		t.Fatalf("insert a window starting where the first ends: %v", err)
	}

	// The rule is per episode: the same period on another one is a separate
	// campaign, not a conflict.
	if err := insertFreeWindow(ctx, pg, tenant.ID, second.ID, "FREEWINDOW04", base, base.Add(2*time.Hour)); err != nil {
		t.Fatalf("insert the same period on another episode: %v", err)
	}

	empty := insertFreeWindow(ctx, pg, tenant.ID, second.ID, "FREEWINDOW05", base.Add(5*time.Hour), base.Add(5*time.Hour))
	if empty == nil {
		t.Fatal("insert of a window that ends when it starts succeeded, want a check violation")
	}
}

// image-server decides a free body from this query alone, so an episode inside
// a window has to read as public here or its pages stay unreadable while the
// catalog says they are free.
func TestEpisodeFreeWindowOpensPublicImageAccess(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series A", Published: true})
	episode := pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEPAY01", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500})
	imageID := pg.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)

	publicAccess := func() bool {
		t.Helper()
		row, err := q.GetEpisodeImagePublicAccessByIDForTenant(ctx, dbmodels.GetEpisodeImagePublicAccessByIDForTenantParams{
			ID:       imageID,
			TenantID: tenant.ID,
		})
		if err != nil {
			t.Fatalf("GetEpisodeImagePublicAccessByIDForTenant: %v", err)
		}
		return row.HasPublicAccess.Valid && row.HasPublicAccess.Bool
	}

	if publicAccess() {
		t.Fatal("a priced episode with no window reads as public")
	}

	now := time.Now().UTC()
	pg.SeedEpisodeFreeWindow(t, tenant.ID, episode.ID, now.Add(-time.Hour), now.Add(time.Hour))

	if !publicAccess() {
		t.Fatal("a priced episode inside its free window does not read as public")
	}
}

func TestListEpisodeFreeWindowBoundariesDue(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series A", Published: true})
	newEpisode := func(publicID, title string) testutil.Episode {
		return pg.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: publicID, Title: title, Status: testutil.EpisodeStatusPublished, Price: 500})
	}

	now := time.Now().UTC()
	upcoming := newEpisode("EPISODEUPC01", "Free Tomorrow")
	pg.SeedEpisodeFreeWindow(t, tenant.ID, upcoming.ID, now.Add(time.Hour), now.Add(2*time.Hour))

	open := newEpisode("EPISODEOPN01", "Free Now")
	openWindowID := pg.SeedEpisodeFreeWindow(t, tenant.ID, open.ID, now.Add(-time.Hour), now.Add(time.Hour))

	over := newEpisode("EPISODEOVR01", "Was Free")
	overWindowID := pg.SeedEpisodeFreeWindow(t, tenant.ID, over.ID, now.Add(-2*time.Hour), now.Add(-time.Hour))

	due, err := q.ListEpisodeFreeWindowBoundariesDue(ctx)
	if err != nil {
		t.Fatalf("ListEpisodeFreeWindowBoundariesDue: %v", err)
	}
	byID := make(map[uuid.UUID]dbmodels.ListEpisodeFreeWindowBoundariesDueRow, len(due))
	for _, row := range due {
		byID[row.ID] = row
	}
	if len(byID) != 2 {
		t.Fatalf("due windows = %d, want the open one and the one that ended", len(byID))
	}

	openRow, ok := byID[openWindowID]
	if !ok {
		t.Fatal("the open window is not due, but nothing has dropped the caches its start changed")
	}
	if !openRow.StartDue.Bool || openRow.EndDue.Bool {
		t.Errorf("open window due flags = (start %v, end %v), want (true, false)", openRow.StartDue.Bool, openRow.EndDue.Bool)
	}

	// A window the batch never saw open before it closed owes both boundaries,
	// and one revalidation answers for both.
	overRow, ok := byID[overWindowID]
	if !ok {
		t.Fatal("the window that ended is not due")
	}
	if !overRow.StartDue.Bool || !overRow.EndDue.Bool {
		t.Errorf("closed window due flags = (start %v, end %v), want both true", overRow.StartDue.Bool, overRow.EndDue.Bool)
	}

	if err := q.MarkEpisodeFreeWindowStartRevalidated(ctx, openWindowID); err != nil {
		t.Fatalf("MarkEpisodeFreeWindowStartRevalidated: %v", err)
	}
	if err := q.MarkEpisodeFreeWindowStartRevalidated(ctx, overWindowID); err != nil {
		t.Fatalf("MarkEpisodeFreeWindowStartRevalidated: %v", err)
	}
	if err := q.MarkEpisodeFreeWindowEndRevalidated(ctx, overWindowID); err != nil {
		t.Fatalf("MarkEpisodeFreeWindowEndRevalidated: %v", err)
	}

	remaining, err := q.ListEpisodeFreeWindowBoundariesDue(ctx)
	if err != nil {
		t.Fatalf("ListEpisodeFreeWindowBoundariesDue after marking: %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("due windows after marking = %d, want none until the open one ends", len(remaining))
	}
}
