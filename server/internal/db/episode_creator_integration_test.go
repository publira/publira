package dbtest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/creatorroles"
	"github.com/publira/publira/server/internal/testutil"
)

// The two migration versions this test steps between. The back-fill under test
// is the tail of the `up` of episodeCreatorsVersion, and it only acts on
// episodes that are already there — which the shared container has none of by
// the time it has been migrated to the head.
const (
	creatorRolesVersion    = 20260909162333
	episodeCreatorsVersion = 20260909231510
)

// episodeCreditNames reads back who an episode is credited to and in what
// role, in the order the storefront presents them.
func episodeCreditNames(t *testing.T, pg *testutil.PostgresEnv, episodeID uuid.UUID) [][2]string {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	rows, err := pg.DB.QueryContext(ctx, `
		SELECT c.name, cr.name, ec.source
		FROM episode_creators ec
			JOIN creators c ON c.id = ec.creator_id
			JOIN creator_roles cr ON cr.id = ec.role_id
		WHERE ec.episode_id = $1
		ORDER BY cr.display_priority ASC,
			ec.display_order ASC,
			c.name ASC
	`, episodeID)
	if err != nil {
		t.Fatalf("read episode credits: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	credits := make([][2]string, 0)
	for rows.Next() {
		var creatorName, roleName, source string
		if err := rows.Scan(&creatorName, &roleName, &source); err != nil {
			t.Fatalf("scan episode credit: %v", err)
		}
		if source != "series" {
			t.Fatalf("credit %q source = %q, want every back-filled row to say it came from the series", creatorName, source)
		}
		credits = append(credits, [2]string{creatorName, roleName})
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read episode credits: %v", err)
	}
	return credits
}

// An episode that existed before episodes carried credits is credited the way
// its series is. Without the back-fill it would answer with nothing at all,
// because the storefront reads the episode's own rows and never falls back to
// the series.
func TestEpisodeCreatorsMigrationBackFillsFromTheSeries(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)

	// Behind the migration under test, so the episodes seeded below are rows
	// it finds rather than rows written through it.
	pg.MigrateTo(t, creatorRolesVersion)

	tenant := pg.SeedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	credited := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Credited Series", Published: true})
	uncredited := pg.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00002", Title: "Uncredited Series", Published: true})
	author := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Aoi Sakura"})
	artist := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0002", Name: "Ren Takahashi"})
	pg.SeedSeriesCreator(t, tenant.ID, credited.ID, author.ID, creatorroles.Defaults[0].Name)
	pg.SeedSeriesCreator(t, tenant.ID, credited.ID, artist.ID, creatorroles.Defaults[1].Name)

	first := pg.SeedEpisode(t, tenant.ID, credited.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEA0001",
		Title:    "Chapter One",
		Status:   testutil.EpisodeStatusPublished,
	})
	second := pg.SeedEpisode(t, tenant.ID, credited.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEA0002",
		Title:    "Chapter Two",
		Status:   testutil.EpisodeStatusPublished,
	})
	orphan := pg.SeedEpisode(t, tenant.ID, uncredited.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEA0003",
		Title:    "Nobody's Chapter",
		Status:   testutil.EpisodeStatusPublished,
	})

	// Exactly the migration under test, so what the assertions below see is its
	// back-fill and nothing a later migration did.
	pg.MigrateTo(t, episodeCreatorsVersion)
	// And back to the head, so this test leaves the schema where the rest of
	// the suite expects it.
	t.Cleanup(func() { pg.MigrateUp(t) })

	want := [][2]string{
		{author.Name, creatorroles.Defaults[0].Name},
		{artist.Name, creatorroles.Defaults[1].Name},
	}
	for _, episode := range []testutil.Episode{first, second} {
		got := episodeCreditNames(t, pg, episode.ID)
		if len(got) != len(want) {
			t.Fatalf("%s credits = %v, want the two its series carries", episode.PublicID, got)
		}
		for index := range want {
			if got[index] != want[index] {
				t.Fatalf("%s credits = %v, want %v", episode.PublicID, got, want)
			}
		}
	}
	// A series nobody is credited on hands its episodes nothing, rather than a
	// row naming no one.
	if got := episodeCreditNames(t, pg, orphan.ID); len(got) != 0 {
		t.Fatalf("credits of an episode of an uncredited series = %v, want none", got)
	}
}
