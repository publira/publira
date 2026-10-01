package publicapi

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/ageverification"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// previewImageIDs lists the page ids a response previews, in the order it
// carries them, and fails on a preview URL that is not the token-free
// preview route.
func previewImageIDs(t *testing.T, previews []*publirattypesv1.EpisodeImage) []string {
	t.Helper()

	ids := make([]string, 0, len(previews))
	for _, preview := range previews {
		if want := "/images/episodes/" + preview.Id + "/preview"; preview.ImageUrl != want {
			t.Fatalf("preview image_url = %q, want %q", preview.ImageUrl, want)
		}
		ids = append(ids, preview.Id)
	}
	return ids
}

func TestDBGetEpisodeDetailOffersThePreviewOfALockedBody(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	// Seeded out of reading order, so the opening pages are found by
	// display_order rather than by which row came first.
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 3)
	first := env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
	second := env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 2)

	locked, err := env.catalogClient().GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail as a guest: %v", err)
	}
	if locked.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("access = %v, want locked", locked.Msg.Access)
	}
	if len(locked.Msg.Images) != 0 {
		t.Fatalf("images = %d, want no full-size page", len(locked.Msg.Images))
	}
	if got, want := previewImageIDs(t, locked.Msg.PreviewImages), []string{first.String(), second.String()}; !slices.Equal(got, want) {
		t.Fatalf("preview pages = %v, want the opening two %v", got, want)
	}

	// A reader who has bought the episode reads the body, and the preview
	// that stood in for it is not sent beside it.
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	env.PG.SeedPurchase(t, tenant.ID, reader.ID, episode.ID, 500)
	entitled, err := env.catalogClient().GetEpisodeDetail(context.Background(), newBearerRequest(
		&publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID},
		tokenFor(t, tenant, reader),
	))
	if err != nil {
		t.Fatalf("GetEpisodeDetail as the buyer: %v", err)
	}
	if entitled.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
		t.Fatalf("access = %v, want entitled", entitled.Msg.Access)
	}
	if len(entitled.Msg.Images) != 3 {
		t.Fatalf("images = %d, want the whole body", len(entitled.Msg.Images))
	}
	if len(entitled.Msg.PreviewImages) != 0 {
		t.Fatalf("preview images = %d, want none beside an open body", len(entitled.Msg.PreviewImages))
	}
}

// The tenant's rule withholds an R18 body from a guest whatever its price, and
// the preview stands in for it the way it does for a locked one.
func TestDBGetEpisodeDetailOffersThePreviewOfAnAgeRestrictedBody(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	setTenantAgeVerification(t, env, tenant.ID, ageverification.R18)
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Rated Series",
		Published: true,
		AgeRating: ageverification.RatingR18,
	})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEAGE01",
		Title:    "Rated Episode",
		Status:   testutil.EpisodeStatusPublished,
	})
	page := env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)

	resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if resp.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED {
		t.Fatalf("access = %v, want age restricted", resp.Msg.Access)
	}
	if len(resp.Msg.Images) != 0 {
		t.Fatalf("images = %d, want no full-size page", len(resp.Msg.Images))
	}
	// A body shorter than the preview is previewed whole.
	if got, want := previewImageIDs(t, resp.Msg.PreviewImages), []string{page.String()}; !slices.Equal(got, want) {
		t.Fatalf("preview pages = %v, want %v", got, want)
	}
}

func TestDBGetEpisodeDetailNamesTheNextFreeEpisode(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Series", Published: true})
	episode := func(publicID string, seed testutil.EpisodeSeed) testutil.Episode {
		seed.PublicID = publicID
		seed.Title = publicID
		return env.PG.SeedEpisode(t, tenant.ID, series.ID, seed)
	}

	now := time.Now()
	// Free, but before the episode being read: not where a reader goes next.
	episode("EPISODEPRV01", testutil.EpisodeSeed{Status: testutil.EpisodeStatusPublished})
	current := episode("EPISODECUR01", testutil.EpisodeSeed{Status: testutil.EpisodeStatusPublished, Price: 500})
	episode("EPISODEPAY02", testutil.EpisodeSeed{Status: testutil.EpisodeStatusPublished, Price: 500})
	// Free, but nobody may read it yet: a draft, and a listing whose
	// publication instant has not come.
	episode("EPISODEDRF01", testutil.EpisodeSeed{})
	episode("EPISODESCH01", testutil.EpisodeSeed{Status: testutil.EpisodeStatusPublished, PublishedAt: now.Add(time.Hour)})
	// A window that has closed leaves the episode at its price.
	closed := episode("EPISODECLS01", testutil.EpisodeSeed{Status: testutil.EpisodeStatusPublished, Price: 500})
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, closed.ID, now.Add(-2*time.Hour), now.Add(-time.Hour))
	// The first one free right now, through a window that is open.
	windowed := episode("EPISODEWIN01", testutil.EpisodeSeed{Status: testutil.EpisodeStatusPublished, Price: 300})
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, windowed.ID, now.Add(-time.Hour), now.Add(time.Hour))
	last := episode("EPISODEFRE01", testutil.EpisodeSeed{Status: testutil.EpisodeStatusPublished})

	read := func(publicID string) *publirav1.GetEpisodeDetailResponse {
		t.Helper()
		resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: publicID,
		}))
		if err != nil {
			t.Fatalf("GetEpisodeDetail %s: %v", publicID, err)
		}
		return resp.Msg
	}

	nextFree := read(current.PublicID).NextFreeEpisode
	if nextFree.GetPublicId() != windowed.PublicID {
		t.Fatalf("next_free_episode = %q, want %q", nextFree.GetPublicId(), windowed.PublicID)
	}
	if !nextFree.GetIsFree() || nextFree.GetPrice() != 300 {
		t.Fatalf("next_free_episode is_free = %t, price = %d, want free at a price of 300", nextFree.GetIsFree(), nextFree.GetPrice())
	}

	if got := read(windowed.PublicID).NextFreeEpisode.GetPublicId(); got != last.PublicID {
		t.Fatalf("next_free_episode after the window = %q, want %q", got, last.PublicID)
	}
	if got := read(last.PublicID).NextFreeEpisode; got != nil {
		t.Fatalf("next_free_episode at the end of the series = %+v, want unset", got)
	}
}

// A series none of whose later episodes is free answers with nothing rather
// than with the next episode, whatever it costs.
func TestDBGetEpisodeDetailLeavesTheNextFreeEpisodeUnsetWhenNoneIsLeft(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	first := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODEONE01", Title: "One", Status: testutil.EpisodeStatusPublished, Price: 500})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODETWO01", Title: "Two", Status: testutil.EpisodeStatusPublished, Price: 500})

	resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: first.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if resp.Msg.NextEpisode.GetPublicId() != "EPISODETWO01" {
		t.Fatalf("next_episode = %q, want EPISODETWO01", resp.Msg.NextEpisode.GetPublicId())
	}
	if resp.Msg.NextFreeEpisode != nil {
		t.Fatalf("next_free_episode = %+v, want unset", resp.Msg.NextFreeEpisode)
	}
}
