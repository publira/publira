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

func dueSeriesIDs(t *testing.T, ctx context.Context, q *dbmodels.Queries) []uuid.UUID {
	t.Helper()
	due, err := q.ListSeriesPublicationsDue(ctx)
	if err != nil {
		t.Fatalf("ListSeriesPublicationsDue: %v", err)
	}
	ids := make([]uuid.UUID, 0, len(due))
	for _, row := range due {
		ids = append(ids, row.ID)
	}
	return ids
}

func TestListSeriesPublicationsDue(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now().UTC()

	passed := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPAS001", Title: "Passed", Published: true, PublishedAt: now.Add(-time.Minute)})
	pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESUPC001", Title: "Upcoming", Published: true, PublishedAt: now.Add(time.Hour)})
	pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRF001", Title: "Draft"})

	if got, want := dueSeriesIDs(t, ctx, q), []uuid.UUID{passed.ID}; !slices.Equal(got, want) {
		t.Fatalf("due series = %v, want only the one whose instant has passed %v", got, want)
	}

	if err := q.MarkSeriesPublicationRevalidated(ctx, passed.ID); err != nil {
		t.Fatalf("MarkSeriesPublicationRevalidated: %v", err)
	}
	if got := dueSeriesIDs(t, ctx, q); len(got) != 0 {
		t.Fatalf("due series after marking = %v, want none until the upcoming one is published", got)
	}
}

// Saving a series is what publishes it, so the save decides whether the drop
// is still owed: an instant already passed was dropped by the save itself, and
// one still ahead is left for the batch. The save that makes the series public
// says so, and a save that leaves it public does not.
func TestUpdateSeriesPublicationOwesTheDropOnlyForAnInstantAhead(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESSAV001", Title: "Saved"})
	now := time.Now().UTC()

	revalidatedAt := func() sql.NullTime {
		t.Helper()
		var value sql.NullTime
		if err := pg.DB.QueryRowContext(ctx,
			"SELECT publication_revalidated_at FROM series WHERE id = $1", series.ID,
		).Scan(&value); err != nil {
			t.Fatalf("read series: %v", err)
		}
		return value
	}
	publish := func(publishedAt sql.NullTime) bool {
		t.Helper()
		applies, err := q.UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{ID: series.ID, PublishedAt: publishedAt})
		if err != nil {
			t.Fatalf("UpdateSeriesPublication: %v", err)
		}
		return applies
	}

	if !publish(sql.NullTime{Time: now.Add(-time.Minute), Valid: true}) {
		t.Error("the save that published a draft series does not say it applied the publication")
	}
	if !revalidatedAt().Valid {
		t.Fatal("a series published at an instant already passed still owes its drop")
	}

	if publish(sql.NullTime{Time: now.Add(-2 * time.Minute), Valid: true}) {
		t.Error("a save of a series that was already public says it applied the publication")
	}

	if publish(sql.NullTime{Time: now.Add(time.Hour), Valid: true}) {
		t.Error("a save rescheduling the series ahead says it applied the publication")
	}
	if revalidatedAt().Valid {
		t.Fatal("a series rescheduled to an instant ahead owes no drop, want one owed for that instant")
	}

	if !publish(sql.NullTime{Time: now.Add(-time.Minute), Valid: true}) {
		t.Error("the save that published a scheduled series at once does not say it applied the publication")
	}

	if publish(sql.NullTime{}) {
		t.Error("the save that unpublished the series says it applied the publication")
	}
	if revalidatedAt().Valid {
		t.Fatal("an unpublished series is marked as dropped")
	}
	if got := dueSeriesIDs(t, ctx, q); len(got) != 0 {
		t.Fatalf("due series = %v, want an unpublished series left out", got)
	}
}

// The batch lists and then marks. A series rescheduled into the future between
// the two keeps its drop owed, or it would become public at the new instant
// with nothing left to drop the caches.
func TestMarkSeriesPublicationRevalidatedSkipsASeriesRescheduledAhead(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	q := dbmodels.New(pg.DB)
	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now().UTC()
	series := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESRES001", Title: "Rescheduled", Published: true, PublishedAt: now.Add(-time.Minute)})

	if got, want := dueSeriesIDs(t, ctx, q), []uuid.UUID{series.ID}; !slices.Equal(got, want) {
		t.Fatalf("due series = %v, want %v", got, want)
	}
	if _, err := q.UpdateSeriesPublication(ctx, dbmodels.UpdateSeriesPublicationParams{
		ID:          series.ID,
		PublishedAt: sql.NullTime{Time: now.Add(time.Hour), Valid: true},
	}); err != nil {
		t.Fatalf("UpdateSeriesPublication: %v", err)
	}
	if err := q.MarkSeriesPublicationRevalidated(ctx, series.ID); err != nil {
		t.Fatalf("MarkSeriesPublicationRevalidated: %v", err)
	}

	var revalidatedAt sql.NullTime
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT publication_revalidated_at FROM series WHERE id = $1", series.ID,
	).Scan(&revalidatedAt); err != nil {
		t.Fatalf("read series: %v", err)
	}
	if revalidatedAt.Valid {
		t.Fatal("a series rescheduled ahead was marked as dropped, want its drop still owed")
	}
}
