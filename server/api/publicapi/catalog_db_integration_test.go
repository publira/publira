package publicapi

import (
	"context"
	"net/url"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auth"
	publirattypesv1 "github.com/publira/publira/server/internal/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The catalog is the one place where "unpublished" has to hold against a real
// database: every list and detail query filters on is_published, on a
// published_at that may still be in the future, and on the listing status of
// each episode. The sqlmock tests hand those queries their answers, so only
// these cases show that the SQL itself keeps unpublished work out of sight.

func seriesPublicIDs(items []*publirattypesv1.Series) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.PublicId)
	}
	return ids
}

func episodePublicIDs(items []*publirattypesv1.Episode) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.PublicId)
	}
	return ids
}

func TestDBListPublishedSeriesReturnsOnlyPublishedSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESOLD001",
		Title:       "Published Long Ago",
		Synopsis:    "The older of the two visible series.",
		Published:   true,
		PublishedAt: time.Now().Add(-48 * time.Hour),
	})
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESNEW001",
		Title:       "Published Recently",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESDRAFT1",
		Title:    "Still A Draft",
	})
	// is_published alone is not enough: a series whose publication time has not
	// arrived yet must stay out of the list.
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESFUTUR1",
		Title:       "Published Tomorrow",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})

	resp, err := env.catalogClient().ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}

	got := seriesPublicIDs(resp.Msg.Series)
	want := []string{"SERIESNEW001", "SERIESOLD001"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("series = %v, want %v (newest first, drafts and future publications excluded)", got, want)
	}
	if resp.Msg.Series[1].Synopsis != "The older of the two visible series." {
		t.Fatalf("synopsis = %q, want the seeded listing text", resp.Msg.Series[1].Synopsis)
	}
}

func TestDBListPublishedSeriesExcludesAnotherTenantsSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true})
	env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true})

	client := env.catalogClient()
	mine, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(first),
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries for tenant A: %v", err)
	}
	if got := seriesPublicIDs(mine.Msg.Series); len(got) != 1 || got[0] != "SERIESA00001" {
		t.Fatalf("tenant A series = %v, want only SERIESA00001", got)
	}

	// The detail lookup is a different query and has to draw the same line.
	_, err = client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(first),
		PublicId: "SERIESB00001",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetSeriesDetail across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

// The keyset queries only exist in SQL, so paging is meaningless to assert
// against canned rows: this walks a real index forward and back again.
func TestDBListPublishedSeriesPagesForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	for _, seed := range []testutil.SeriesSeed{
		{PublicID: "SERIESPAGE01", Title: "Page One", Published: true, PublishedAt: time.Now().Add(-72 * time.Hour)},
		{PublicID: "SERIESPAGE02", Title: "Page Two", Published: true, PublishedAt: time.Now().Add(-48 * time.Hour)},
		{PublicID: "SERIESPAGE03", Title: "Page Three", Published: true, PublishedAt: time.Now().Add(-24 * time.Hour)},
	} {
		env.PG.SeedSeries(t, tenant.ID, seed)
	}

	client := env.catalogClient()
	firstPage, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries page 1: %v", err)
	}
	if got := seriesPublicIDs(firstPage.Msg.Series); len(got) != 2 || got[0] != "SERIESPAGE03" || got[1] != "SERIESPAGE02" {
		t.Fatalf("page 1 = %v, want the two newest series", got)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("page 1 next_token is empty, want a token for the remaining series")
	}
	if firstPage.Msg.PreviousToken != "" {
		t.Fatalf("page 1 previous_token = %q, want empty on the first page", firstPage.Msg.PreviousToken)
	}

	secondPage, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
		Token:  firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries page 2: %v", err)
	}
	if got := seriesPublicIDs(secondPage.Msg.Series); len(got) != 1 || got[0] != "SERIESPAGE01" {
		t.Fatalf("page 2 = %v, want the oldest series alone", got)
	}
	if secondPage.Msg.NextToken != "" {
		t.Fatalf("page 2 next_token = %q, want empty at the end of the list", secondPage.Msg.NextToken)
	}
	// Without this the request below would be a plain first-page request, and the
	// assertion on it would hold whether or not paging backwards works.
	if secondPage.Msg.PreviousToken == "" {
		t.Fatal("page 2 previous_token is empty, want a token back to the first page")
	}

	backAgain, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
		Token:  secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries back to page 1: %v", err)
	}
	if got := seriesPublicIDs(backAgain.Msg.Series); len(got) != 2 || got[0] != "SERIESPAGE03" || got[1] != "SERIESPAGE02" {
		t.Fatalf("page 1 revisited = %v, want the two newest series again", got)
	}
}

func TestDBGetSeriesDetailListsOnlyPublishedEpisodes(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESA00001",
		Title:     "Serialized Story",
		Published: true,
	})

	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPUB01",
		Title:    "Chapter One",
		Status:   testutil.EpisodeStatusPublished,
		Price:    0,
	})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPUB02",
		Title:    "Chapter Two",
		Status:   testutil.EpisodeStatusPublished,
		Price:    300,
	})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEDRF01",
		Title:    "Chapter Three (draft)",
	})
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "EPISODESCH01",
		Title:       "Chapter Four (scheduled)",
		Status:      testutil.EpisodeStatusScheduled,
		ScheduledAt: time.Now().Add(24 * time.Hour),
	})
	// Published, but not until tomorrow: the listing row exists and still must
	// not appear.
	env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID:    "EPISODEFUT01",
		Title:       "Chapter Five (embargoed)",
		Status:      testutil.EpisodeStatusPublished,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})

	resp, err := env.catalogClient().GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	got := episodePublicIDs(resp.Msg.Episodes)
	if len(got) != 2 || got[0] != "EPISODEPUB01" || got[1] != "EPISODEPUB02" {
		t.Fatalf("episodes = %v, want only the two published ones in order", got)
	}
	if resp.Msg.Episodes[1].Price != 300 {
		t.Fatalf("second episode price = %d, want 300", resp.Msg.Episodes[1].Price)
	}
}

func TestDBGetSeriesDetailRefusesUnpublishedSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	draft := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Still A Draft"})
	embargoed := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESFUTUR1",
		Title:       "Published Tomorrow",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})

	client := env.catalogClient()
	for _, publicID := range []string{draft.PublicID, embargoed.PublicID} {
		_, err := client.GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: publicID,
		}))
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("GetSeriesDetail %s code = %v, want permission_denied (err=%v)", publicID, connect.CodeOf(err), err)
		}
	}
}

func TestDBGetEpisodeDetailHidesEpisodesThatAreNotPubliclyReadable(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	published := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Published Series", Published: true})
	draftSeries := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft Series"})

	draftEpisode := env.PG.SeedEpisode(t, tenant.ID, published.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEDRF01",
		Title:    "Unpublished Chapter",
	})
	// A published episode is still unreachable while its series is not public.
	hiddenBySeries := env.PG.SeedEpisode(t, tenant.ID, draftSeries.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEHID01",
		Title:    "Published Chapter Of A Draft Series",
		Status:   testutil.EpisodeStatusPublished,
	})

	client := env.catalogClient()
	for _, publicID := range []string{draftEpisode.PublicID, hiddenBySeries.PublicID} {
		_, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: publicID,
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("GetEpisodeDetail %s code = %v, want not_found (err=%v)", publicID, connect.CodeOf(err), err)
		}
	}
}

func TestDBGetEpisodeDetailServesFreeEpisodeImages(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Free Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEFRE01",
		Title:    "Free Chapter",
		Status:   testutil.EpisodeStatusPublished,
		Price:    0,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 2)

	resp, err := env.catalogClient().GetEpisodeDetail(context.Background(), connect.NewRequest(&publirav1.GetEpisodeDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: episode.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetEpisodeDetail: %v", err)
	}
	if resp.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_FREE {
		t.Fatalf("access = %v, want free", resp.Msg.Access)
	}
	if len(resp.Msg.Images) != 2 {
		t.Fatalf("images = %d, want both pages of a free episode", len(resp.Msg.Images))
	}
	if resp.Msg.Series.PublicId != series.PublicID {
		t.Fatalf("series public_id = %q, want %q", resp.Msg.Series.PublicId, series.PublicID)
	}

	// The reader of a free body may hold no credential at all, so the key
	// material for its pages travels in the URL. Both pages carry the same one:
	// it is scoped to the episode, not to the reader or the page.
	tokens := make([]string, 0, len(resp.Msg.Images))
	for _, image := range resp.Msg.Images {
		parsed, parseErr := url.Parse(image.ImageUrl)
		if parseErr != nil {
			t.Fatalf("image url %q: %v", image.ImageUrl, parseErr)
		}
		token := parsed.Query().Get(auth.MediaTokenQueryParam)
		if token == "" {
			t.Fatalf("image url %q carries no key material", image.ImageUrl)
		}
		claims, verifyErr := testutil.TokenManager().Verify(token, auth.AudienceMedia)
		if verifyErr != nil {
			t.Fatalf("Verify free episode media token: %v", verifyErr)
		}
		if claims.Subject != auth.FreeEpisodeMediaSubject {
			t.Errorf("subject = %q, want the synthetic %q", claims.Subject, auth.FreeEpisodeMediaSubject)
		}
		if claims.TenantID != tenant.ID.String() {
			t.Errorf("tenant = %q, want %q", claims.TenantID, tenant.ID)
		}
		if claims.EpisodeID != episode.ID.String() {
			t.Errorf("episode = %q, want %q", claims.EpisodeID, episode.ID)
		}
		tokens = append(tokens, token)
	}
	if tokens[0] != tokens[1] {
		t.Errorf("the two pages carry different key material:\n%s\n%s", tokens[0], tokens[1])
	}
}

// Paid pages are the asset the public API must not hand out by accident, so the
// locked and entitled shapes are checked against the real entitlement tables.
func TestDBGetEpisodeDetailWithholdsPaidPagesUntilEntitled(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Paid Series", Published: true})
	episode := env.PG.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{
		PublicID: "EPISODEPAY01",
		Title:    "Paid Chapter",
		Status:   testutil.EpisodeStatusPublished,
		Price:    500,
	})
	env.PG.SeedEpisodeImage(t, tenant.ID, episode.ID, 1)

	buyer := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERBUY01", "buyer@tenant-a.example.com", "Buyer")
	browser := env.PG.SeedEndUser(t, tenant.ID, "ENDUSERBRW01", "browser@tenant-a.example.com", "Browser")

	client := env.catalogClient()
	request := func() *publirav1.GetEpisodeDetailRequest {
		return &publirav1.GetEpisodeDetailRequest{Tenant: tenantContext(tenant), PublicId: episode.PublicID}
	}

	anonymous, err := client.GetEpisodeDetail(context.Background(), connect.NewRequest(request()))
	if err != nil {
		t.Fatalf("GetEpisodeDetail anonymous: %v", err)
	}
	if anonymous.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("anonymous access = %v, want locked", anonymous.Msg.Access)
	}
	if len(anonymous.Msg.Images) != 0 {
		t.Fatalf("anonymous images = %d, want none", len(anonymous.Msg.Images))
	}

	signedIn, err := client.GetEpisodeDetail(context.Background(), newBearerRequest(request(), tokenFor(t, tenant, browser)))
	if err != nil {
		t.Fatalf("GetEpisodeDetail as a signed-in non-buyer: %v", err)
	}
	if signedIn.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_LOCKED {
		t.Fatalf("non-buyer access = %v, want locked", signedIn.Msg.Access)
	}
	if len(signedIn.Msg.Images) != 0 {
		t.Fatalf("non-buyer images = %d, want none", len(signedIn.Msg.Images))
	}

	env.PG.SeedPurchase(t, tenant.ID, buyer.ID, episode.ID, episode.Price)

	entitled, err := client.GetEpisodeDetail(context.Background(), newBearerRequest(request(), tokenFor(t, tenant, buyer)))
	if err != nil {
		t.Fatalf("GetEpisodeDetail as the buyer: %v", err)
	}
	if entitled.Msg.Access != publirav1.EpisodeAccess_EPISODE_ACCESS_ENTITLED {
		t.Fatalf("buyer access = %v, want entitled", entitled.Msg.Access)
	}
	if len(entitled.Msg.Images) != 1 {
		t.Fatalf("buyer images = %d, want the page they paid for", len(entitled.Msg.Images))
	}
}
