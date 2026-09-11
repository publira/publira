package publicapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/creatorroles"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// creditedNames names who each credit is on and in what role, in the order the
// storefront presents them.
func creditedNames(creators []*publirattypesv1.Creator) []string {
	names := make([]string, 0, len(creators))
	for _, creator := range creators {
		names = append(names, creator.Name+" / "+creator.GetRole().GetName())
	}
	return names
}

// A series whose artist changed part way through credits each episode with the
// team that episode shipped with, and the link to the next one names that
// episode's team rather than the one the reader is on.
func TestDBGetEpisodeDetailCreditsEachEpisodeWithItsOwnTeam(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Serialized Story",
		Published: true,
	})
	originalAuthor := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Aoi Sakura"})
	firstArtist := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0002", Name: "Ren Takahashi"})
	secondArtist := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0003", Name: "Hana Kubo"})

	early := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:   "EPISODEONE01",
		Title:      "Chapter One",
		OrderIndex: 1,
		Status:     testutil.EpisodeStatusPublished,
	})
	late := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:   "EPISODETWO02",
		Title:      "Chapter Two",
		OrderIndex: 2,
		Status:     testutil.EpisodeStatusPublished,
	})
	for _, episode := range []testutil.Episode{early, late} {
		env.PG.SeedEpisodeCreator(t, tenant.ID, episode.ID, originalAuthor.ID, creatorroles.Defaults[0].Name)
	}
	env.PG.SeedEpisodeCreator(t, tenant.ID, early.ID, firstArtist.ID, creatorroles.Defaults[1].Name)
	env.PG.SeedEpisodeCreator(t, tenant.ID, late.ID, secondArtist.ID, creatorroles.Defaults[1].Name)

	resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: early.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}

	want := []string{
		"Aoi Sakura / " + creatorroles.Defaults[0].Name,
		"Ren Takahashi / " + creatorroles.Defaults[1].Name,
	}
	if got := creditedNames(resp.Msg.Episode.GetCreators()); !slices.Equal(got, want) {
		t.Fatalf("episode credits = %v, want %v", got, want)
	}
	wantNext := []string{
		"Aoi Sakura / " + creatorroles.Defaults[0].Name,
		"Hana Kubo / " + creatorroles.Defaults[1].Name,
	}
	if got := creditedNames(resp.Msg.NextEpisode.GetCreators()); !slices.Equal(got, wantNext) {
		t.Fatalf("next episode credits = %v, want %v", got, wantNext)
	}
}

// An episode nobody is credited on answers with nothing rather than borrowing
// the credits of its series: the episode is the unit that is credited, and a
// fallback would hide the fact that a credit is missing.
func TestDBGetEpisodeDetailDoesNotFallBackToTheSeriesCredits(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Serialized Story",
		Published: true,
	})
	originalAuthor := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Aoi Sakura"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, originalAuthor.ID, creatorroles.Defaults[0].Name)
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:   "EPISODEONE01",
		Title:      "Chapter One",
		OrderIndex: 1,
		Status:     testutil.EpisodeStatusPublished,
	})

	resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if got := creditedNames(resp.Msg.Episode.GetCreators()); len(got) != 0 {
		t.Fatalf("episode credits = %v, want none", got)
	}
}
