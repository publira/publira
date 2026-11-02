package publicapi

import (
	"context"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/ageverification"
	"github.com/publira/publira/server/internal/auth"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// previewPageTokens lists the page ids a response opens as its preview, in the
// order it carries them, beside the media token each URL carries, and fails on
// a URL that is not the body route.
func previewPageTokens(t *testing.T, pages []*publirattypesv1.EpisodeImage) ([]string, []string) {
	t.Helper()

	ids := make([]string, 0, len(pages))
	tokens := make([]string, 0, len(pages))
	for _, page := range pages {
		path, rawQuery, _ := strings.Cut(page.ImageUrl, "?")
		if want := "/images/episodes/" + page.Id; path != want {
			t.Fatalf("preview page image_url = %q, want the body route %q", page.ImageUrl, want)
		}
		query, err := url.ParseQuery(rawQuery)
		if err != nil {
			t.Fatalf("parse preview page query %q: %v", rawQuery, err)
		}
		ids = append(ids, page.Id)
		tokens = append(tokens, query.Get(auth.MediaTokenQueryParam))
	}
	return ids, tokens
}

func TestDBGetEpisodeDetailOpensThePreviewPagesOfALockedEpisode(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:         "EPISODEPAY01",
		Title:            "Paid",
		Status:           testutil.EpisodeStatusPublished,
		Price:            500,
		PreviewPageCount: 3,
	})
	// Seeded out of reading order, so the open pages are found by
	// display_order rather than by which row came first.
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 4)
	first := env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
	second := env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 2)
	third := env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 3)

	locked, err := env.catalogClient().GetEpisodeDetail(context.Background(), &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail as a guest: %v", err)
	}
	if locked.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("access = %v, want locked", locked.Access)
	}
	if len(locked.Images) != 0 {
		t.Fatalf("images = %d, want none for a locked body", len(locked.Images))
	}
	if got := locked.Episode.PreviewPageCount; got != 3 {
		t.Fatalf("episode.preview_page_count = %d, want 3", got)
	}
	ids, tokens := previewPageTokens(t, locked.PreviewPages)
	if want := []string{first.String(), second.String(), third.String()}; !slices.Equal(ids, want) {
		t.Fatalf("preview pages = %v, want the opening three %v", ids, want)
	}
	// The token a free body's pages carry, which names nobody, so the answer
	// is the same for every guest.
	for _, token := range tokens {
		claims, verifyErr := testutil.TokenManager().Verify(token, auth.AudienceMedia)
		if verifyErr != nil {
			t.Fatalf("verify preview page token: %v", verifyErr)
		}
		if claims.Subject != auth.FreeEpisodeMediaSubject || claims.EpisodeID != episode.ID.String() {
			t.Fatalf("preview page token subject = %q, episode = %q, want the free token of %s", claims.Subject, claims.EpisodeID, episode.ID)
		}
	}
	if len(locked.PreviewImages) == 0 {
		t.Fatal("preview_images = none, want the blurred teaser beside the open pages")
	}

	// A reader who has bought the episode reads the whole body, and nothing
	// stands in for it.
	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "member@tenant-a.example.com", "Member")
	env.PG.SeedPurchase(t, tenant.ID, reader.ID, episode.ID, 500)
	entitled, err := env.catalogClient().GetEpisodeDetail(testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader)), &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID})
	if err != nil {
		t.Fatalf("GetEpisodeDetail as the buyer: %v", err)
	}
	if entitled.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
		t.Fatalf("access = %v, want entitled", entitled.Access)
	}
	if len(entitled.Images) != 4 {
		t.Fatalf("images = %d, want the whole body", len(entitled.Images))
	}
	if len(entitled.PreviewPages) != 0 {
		t.Fatalf("preview pages = %d, want none beside an open body", len(entitled.PreviewPages))
	}
}

func TestDBGetEpisodeDetailOpensNoPageOfAnEpisodeWithNoPreview(t *testing.T) {
	t.Parallel()

	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)

	resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if resp.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("access = %v, want locked", resp.Access)
	}
	if len(resp.PreviewPages) != 0 {
		t.Fatalf("preview pages = %d, want none", len(resp.PreviewPages))
	}
}

// On a series the tenant's age rule covers, a guest is shown no page, and a
// reader who clears the rule is given the open pages on their own token, the
// one the image route serves such a page on.
func TestDBGetEpisodeDetailHoldsThePreviewPagesToTheAgeRule(t *testing.T) {
	t.Parallel()

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
		PublicID:         "EPISODEAGE01",
		Title:            "Rated Episode",
		Status:           testutil.EpisodeStatusPublished,
		Price:            500,
		PreviewPageCount: 1,
	})
	page := env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 2)

	guest, err := env.catalogClient().GetEpisodeDetail(context.Background(), &publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
	})
	if err != nil {
		t.Fatalf("GetEpisodeDetail as a guest: %v", err)
	}
	if guest.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_AGE_RESTRICTED {
		t.Fatalf("access = %v, want age restricted", guest.Access)
	}
	if len(guest.PreviewPages) != 0 {
		t.Fatalf("preview pages = %d, want none for a reader the rule stops", len(guest.PreviewPages))
	}

	reader := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERA0001", "adult@tenant-a.example.com", "Adult")
	setBirthDate(t, env, reader.ID, time.Now().AddDate(-30, 0, 0))
	adult, err := env.catalogClient().GetEpisodeDetail(testutil.WithBearer(context.Background(), tokenFor(t, tenant, reader)), &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID})
	if err != nil {
		t.Fatalf("GetEpisodeDetail as an adult: %v", err)
	}
	if adult.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("access = %v, want locked", adult.Access)
	}
	ids, tokens := previewPageTokens(t, adult.PreviewPages)
	if want := []string{page.String()}; !slices.Equal(ids, want) {
		t.Fatalf("preview pages = %v, want %v", ids, want)
	}
	claims, err := testutil.TokenManager().Verify(tokens[0], auth.AudienceMedia)
	if err != nil {
		t.Fatalf("verify preview page token: %v", err)
	}
	if claims.Subject != reader.PublicID {
		t.Fatalf("preview page token subject = %q, want the reader %q", claims.Subject, reader.PublicID)
	}
}
