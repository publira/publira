package publicapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The episode read answers the layout already resolved: the episode's own value
// where it states one, its series' where it does not, and the layout both
// viewers hard-coded for a series nobody has set.
func TestDBGetEpisodeDetailResolvesTheReadingLayout(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	untouched := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDEF001", Title: "Never Edited", Published: true})
	env.PG.SeedEpisode(t, tenant.ID, untouched.ID, testutil.EpisodeSeed{PublicID: "EPISODEDEF01", Status: testutil.EpisodeStatusPublished})

	leftToRight := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESLTR001", Title: "Left To Right", Published: true})
	following := env.PG.SeedEpisode(t, tenant.ID, leftToRight.ID, testutil.EpisodeSeed{PublicID: "EPISODEFOL01", Status: testutil.EpisodeStatusPublished})
	overriding := env.PG.SeedEpisode(t, tenant.ID, leftToRight.ID, testutil.EpisodeSeed{PublicID: "EPISODEOVR01", Status: testutil.EpisodeStatusPublished})

	ctx := context.Background()
	if _, err := env.PG.DB.ExecContext(ctx,
		"UPDATE series_listings SET reading_direction = 'ltr', spread_start_index = 0 WHERE series_id = $1", leftToRight.ID,
	); err != nil {
		t.Fatalf("set series layout: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(ctx,
		"UPDATE episodes SET spread_start_index = 1 WHERE id = $1", overriding.ID,
	); err != nil {
		t.Fatalf("set episode layout: %v", err)
	}

	tests := []struct {
		name          string
		publicID      string
		wantDirection publirattypesv1.ReadingDirection
		wantIndex     int32
	}{
		{name: "never-edited-series", publicID: "EPISODEDEF01", wantDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_RIGHT_TO_LEFT, wantIndex: 1},
		{name: "follows-the-series", publicID: following.PublicID, wantDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT, wantIndex: 0},
		{name: "overrides-the-series", publicID: overriding.PublicID, wantDirection: publirattypesv1.ReadingDirection_READING_DIRECTION_LEFT_TO_RIGHT, wantIndex: 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := env.catalogClient().GetEpisodeDetail(ctx, connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
				Tenant:   tenantContext(tenant),
				PublicId: tc.publicID,
			}))
			if err != nil {
				t.Fatalf("GetEpisodeDetail: %v", err)
			}
			episode := resp.Msg.Episode
			if episode.ReadingDirection != tc.wantDirection || episode.SpreadStartIndex != tc.wantIndex {
				t.Fatalf("layout = %s from %d, want %s from %d", episode.ReadingDirection, episode.SpreadStartIndex, tc.wantDirection, tc.wantIndex)
			}
		})
	}
}
