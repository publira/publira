package publicapi

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/contentranking"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// Which series a genre tile shows is decided in SQL: the newest weekly
// leaderboard of the genre, cut to what may be shown now, filled up with the
// genre's newest published series.

func featuredSeriesPublicIDs(genre *publirav1.PublishedGenre) []string {
	ids := make([]string, 0, len(genre.FeaturedSeries))
	for _, series := range genre.FeaturedSeries {
		ids = append(ids, series.PublicId)
	}
	return ids
}

func TestDBListPublishedGenresFeaturesTheLeaderboardThenTheNewestSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now()

	fantasy := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREFANTA01", Name: "Fantasy", DisplayOrder: 1})
	mystery := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREMYSTE01", Name: "Mystery", DisplayOrder: 2})
	empty := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREEMPTY01", Name: "Empty", DisplayOrder: 3})

	seed := func(genre testutil.Genre, publicID string, daysAgo int, seed testutil.SeriesSeed) testutil.Series {
		seed.PublicID = publicID
		seed.Title = publicID
		seed.PublishedAt = now.Add(-time.Duration(daysAgo) * 24 * time.Hour)
		series := env.PG.SeedSeries(t, tenant.ID, seed)
		env.PG.SeedSeriesGenre(t, tenant.ID, series.ID, genre.ID)
		return series
	}
	published := testutil.SeriesSeed{Published: true}

	fantasyA := seed(fantasy, "FANTASYA0001", 9, published)
	fantasyB := seed(fantasy, "FANTASYB0001", 8, published)
	fantasyC := seed(fantasy, "FANTASYC0001", 7, published)
	fantasyD := seed(fantasy, "FANTASYD0001", 3, published)
	seed(fantasy, "FANTASYE0001", 2, published)
	// Each of these was ranked by the batch and has since become something a
	// tile must not show.
	webOnly := seed(fantasy, "FANTASYWEB01", 6, testutil.SeriesSeed{Published: true, Availability: "web"})
	rated := seed(fantasy, "FANTASYR1501", 1, testutil.SeriesSeed{Published: true, AgeRating: "r15"})
	takenDown := seed(fantasy, "FANTASYDOWN1", 1, testutil.SeriesSeed{})

	var mysteryIDs []uuid.UUID
	for i, publicID := range []string{"MYSTERY00001", "MYSTERY00002", "MYSTERY00003", "MYSTERY00004", "MYSTERY00005"} {
		mysteryIDs = append(mysteryIDs, seed(mystery, publicID, 10-i, published).ID)
	}
	seed(empty, "EMPTYDRAFT01", 1, testutil.SeriesSeed{})

	// The current weekly leaderboard, which also still names a series that is
	// no longer in the genre.
	env.seedGenrePeriodRankingSnapshot(t, tenant.ID, uuid.NullUUID{UUID: fantasy.ID, Valid: true},
		contentranking.WeeklyRankingKey, rankingPeriodDate(0),
		fantasyC.ID, takenDown.ID, webOnly.ID, rated.ID, mysteryIDs[0], fantasyA.ID)
	// None of these is the ranking a tile reads.
	env.seedGenrePeriodRankingSnapshot(t, tenant.ID, uuid.NullUUID{UUID: fantasy.ID, Valid: true},
		contentranking.WeeklyRankingKey, rankingPeriodDate(1), fantasyB.ID)
	env.seedGenrePeriodRankingSnapshot(t, tenant.ID, uuid.NullUUID{UUID: fantasy.ID, Valid: true},
		contentranking.DailyRankingKey, rankingPeriodDate(0), fantasyD.ID)
	env.seedPeriodRankingSnapshot(t, tenant.ID, contentranking.WeeklyRankingKey, rankingPeriodDate(0), fantasyB.ID)

	for _, tc := range []struct {
		name    string
		surface publirattypesv1.ClientSurface
		fantasy []string
	}{
		{
			name:    "web",
			surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_WEB,
			fantasy: []string{"FANTASYC0001", "FANTASYWEB01", "FANTASYA0001", "FANTASYE0001"},
		},
		{
			name:    "app",
			surface: publirattypesv1.ClientSurface_CLIENT_SURFACE_APP,
			fantasy: []string{"FANTASYC0001", "FANTASYA0001", "FANTASYE0001", "FANTASYD0001"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := env.catalogClient().ListPublishedGenres(context.Background(), connect.NewRequest(&publirav1.ListPublishedGenresRequest{
				Tenant:  tenantContext(tenant),
				Surface: tc.surface,
			}))
			if err != nil {
				t.Fatalf("ListPublishedGenres: %v", err)
			}
			if len(resp.Msg.Genres) != 3 {
				t.Fatalf("genres = %v, want three", resp.Msg.Genres)
			}
			if got := featuredSeriesPublicIDs(resp.Msg.Genres[0]); !slices.Equal(got, tc.fantasy) {
				t.Fatalf("Fantasy featured_series = %v, want %v", got, tc.fantasy)
			}
			// Unscored, so the four newest.
			wantMystery := []string{"MYSTERY00005", "MYSTERY00004", "MYSTERY00003", "MYSTERY00002"}
			if got := featuredSeriesPublicIDs(resp.Msg.Genres[1]); !slices.Equal(got, wantMystery) {
				t.Fatalf("Mystery featured_series = %v, want %v", got, wantMystery)
			}
			if got := resp.Msg.Genres[2]; got.Name != "Empty" || len(got.FeaturedSeries) != 0 {
				t.Fatalf("Empty genre = %v, want its row with no featured series", got)
			}
		})
	}
}
