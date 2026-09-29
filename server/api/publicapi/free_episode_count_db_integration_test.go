package publicapi

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// free_episode_count and the has_free_episodes filter are one rule the database
// evaluates per read — a published episode priced at 0, or a priced one a free
// window covers at that instant. Canned rows cannot show it change as prices
// and windows do, so these cases run against a real PostgreSQL.

// seedSeriesWithEpisodes seeds a published series and its episodes, and returns
// the series together with the episodes by their seeded order.
func seedSeriesWithEpisodes(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, series testutil.SeriesSeed, episodes ...testutil.EpisodeSeed) (testutil.Series, []testutil.Episode) {
	t.Helper()

	seeded := env.PG.SeedSeries(t, tenant.ID, series)
	created := make([]testutil.Episode, 0, len(episodes))
	for _, episode := range episodes {
		created = append(created, env.PG.SeedEpisode(t, tenant.ID, seeded.ID, episode))
	}
	return seeded, created
}

func freeEpisodeCountOfListedSeries(t *testing.T, env *publicDBEnv, tenant testutil.Tenant, publicID string) int32 {
	t.Helper()

	resp, err := env.catalogClient().ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries: %v", err)
	}
	for _, series := range resp.Msg.Series {
		if series.PublicId == publicID {
			return series.FreeEpisodeCount
		}
	}
	t.Fatalf("series %s = %v, want it listed", publicID, seriesPublicIDs(resp.Msg.Series))
	return 0
}

func TestDBPublishedSeriesCountsTheEpisodesAReaderCanOpenForNothing(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	series, episodes := seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESFREE01", Title: "Mixed Prices", Published: true},
		testutil.EpisodeSeed{PublicID: "EPISODEFREE1", Title: "Free Opener", Status: testutil.EpisodeStatusPublished},
		testutil.EpisodeSeed{PublicID: "EPISODEPAID1", Title: "Paid One", Status: testutil.EpisodeStatusPublished, Price: 500},
		testutil.EpisodeSeed{PublicID: "EPISODEPAID2", Title: "Paid Two", Status: testutil.EpisodeStatusPublished, Price: 300},
		// Neither of these is a published episode a reader can open, so a price
		// of 0 on them counts for nothing.
		testutil.EpisodeSeed{PublicID: "EPISODEDRFT1", Title: "Still A Draft"},
		testutil.EpisodeSeed{PublicID: "EPISODELATE1", Title: "Published Tomorrow", Status: testutil.EpisodeStatusPublished, PublishedAt: time.Now().Add(24 * time.Hour)},
	)

	if got := freeEpisodeCountOfListedSeries(t, env, tenant, series.PublicID); got != 1 {
		t.Fatalf("free_episode_count with one free episode = %d, want 1", got)
	}

	// The detail page counts by the same rule as the list, so a card and the
	// page it leads to cannot disagree about how much is free.
	detail, err := env.catalogClient().GetSeriesDetail(context.Background(), connect.NewRequest(&publirav1.GetSeriesDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: series.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetSeriesDetail: %v", err)
	}
	if detail.Msg.Series.FreeEpisodeCount != 1 {
		t.Fatalf("detail free_episode_count = %d, want 1", detail.Msg.Series.FreeEpisodeCount)
	}

	// A priced episode inside an open window is free right now, so it counts
	// for as long as the window lasts.
	now := time.Now()
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, episodes[1].ID, now.Add(-time.Hour), now.Add(time.Hour))
	if got := freeEpisodeCountOfListedSeries(t, env, tenant, series.PublicID); got != 2 {
		t.Fatalf("free_episode_count with a window open = %d, want 2", got)
	}

	// A window that is over leaves the episode priced again.
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, episodes[2].ID, now.Add(-48*time.Hour), now.Add(-24*time.Hour))
	if got := freeEpisodeCountOfListedSeries(t, env, tenant, series.PublicID); got != 2 {
		t.Fatalf("free_episode_count with a closed window = %d, want 2", got)
	}

	// Dropping an episode's price to 0 is the editorial change the count exists
	// to report, and it needs nothing but the next read.
	if _, err := env.PG.DB.ExecContext(context.Background(),
		"UPDATE episode_listings SET price = 0 WHERE episode_id = $1", episodes[2].ID,
	); err != nil {
		t.Fatalf("update episode price: %v", err)
	}
	if got := freeEpisodeCountOfListedSeries(t, env, tenant, series.PublicID); got != 3 {
		t.Fatalf("free_episode_count after the price change = %d, want 3", got)
	}
}

func TestDBListPublishedSeriesKeepsOnlyTheSeriesWithAFreeEpisode(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now()

	seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESFREE01", Title: "Free Opener", Published: true, PublishedAt: now.Add(-72 * time.Hour)},
		testutil.EpisodeSeed{PublicID: "EPISODEFREE1", Title: "Free", Status: testutil.EpisodeStatusPublished},
	)
	_, windowed := seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESWIND01", Title: "Free This Week", Published: true, PublishedAt: now.Add(-48 * time.Hour)},
		testutil.EpisodeSeed{PublicID: "EPISODEWIND1", Title: "Priced", Status: testutil.EpisodeStatusPublished, Price: 400},
	)
	env.PG.SeedEpisodeFreeWindow(t, tenant.ID, windowed[0].ID, now.Add(-time.Hour), now.Add(time.Hour))
	seedSeriesWithEpisodes(t, env, tenant,
		testutil.SeriesSeed{PublicID: "SERIESPAID01", Title: "Paid Throughout", Published: true, PublishedAt: now.Add(-24 * time.Hour)},
		testutil.EpisodeSeed{PublicID: "EPISODEPAID1", Title: "Paid", Status: testutil.EpisodeStatusPublished, Price: 500},
		// A free episode nobody can open yet does not make the series free to start.
		testutil.EpisodeSeed{PublicID: "EPISODEDRFT1", Title: "Free Once Published"},
	)

	client := env.catalogClient()
	unfiltered, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries without the filter: %v", err)
	}
	if got := len(unfiltered.Msg.Series); got != 3 {
		t.Fatalf("series without the filter = %v, want all three", seriesPublicIDs(unfiltered.Msg.Series))
	}
	// The filter and the count answer the same question, so the series the
	// filter drops is the one the count reports nothing for.
	for _, series := range unfiltered.Msg.Series {
		if series.PublicId == "SERIESPAID01" && series.FreeEpisodeCount != 0 {
			t.Fatalf("SERIESPAID01 free_episode_count = %d, want 0", series.FreeEpisodeCount)
		}
	}

	filtered, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:          tenantContext(tenant),
		HasFreeEpisodes: true,
	}))
	if err != nil {
		t.Fatalf("ListPublishedSeries with the filter: %v", err)
	}
	got := seriesPublicIDs(filtered.Msg.Series)
	want := []string{"SERIESWIND01", "SERIESFREE01"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("filtered series = %v, want %v (newest first)", got, want)
	}
}

// The filtered list pages by the same keyset as the unfiltered one, so its
// tokens have to walk it in both directions without repeating a series.
func TestDBListPublishedSeriesPagesTheFilteredListForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	now := time.Now()

	for i, seed := range []testutil.SeriesSeed{
		{PublicID: "SERIESFREE01", Title: "Free One", Published: true, PublishedAt: now.Add(-72 * time.Hour)},
		{PublicID: "SERIESPAID01", Title: "Paid One", Published: true, PublishedAt: now.Add(-60 * time.Hour)},
		{PublicID: "SERIESFREE02", Title: "Free Two", Published: true, PublishedAt: now.Add(-48 * time.Hour)},
		{PublicID: "SERIESFREE03", Title: "Free Three", Published: true, PublishedAt: now.Add(-24 * time.Hour)},
	} {
		price := int32(0)
		if seed.PublicID == "SERIESPAID01" {
			price = 500
		}
		seedSeriesWithEpisodes(t, env, tenant, seed, testutil.EpisodeSeed{
			PublicID: fmt.Sprintf("EPISODE0000%d", i+1),
			Title:    "Episode",
			Status:   testutil.EpisodeStatusPublished,
			Price:    price,
		})
	}

	client := env.catalogClient()
	firstPage, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:          tenantContext(tenant),
		HasFreeEpisodes: true,
		Limit:           2,
	}))
	if err != nil {
		t.Fatalf("filtered page 1: %v", err)
	}
	if got := seriesPublicIDs(firstPage.Msg.Series); len(got) != 2 || got[0] != "SERIESFREE03" || got[1] != "SERIESFREE02" {
		t.Fatalf("filtered page 1 = %v, want the two newest free series", got)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("filtered page 1 next_token is empty, want a token for the remaining series")
	}

	secondPage, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:          tenantContext(tenant),
		HasFreeEpisodes: true,
		Limit:           2,
		Token:           firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("filtered page 2: %v", err)
	}
	if got := seriesPublicIDs(secondPage.Msg.Series); len(got) != 1 || got[0] != "SERIESFREE01" {
		t.Fatalf("filtered page 2 = %v, want the oldest free series alone (the paid series is filtered out)", got)
	}
	if secondPage.Msg.PreviousToken == "" {
		t.Fatal("filtered page 2 previous_token is empty, want a token back to the first page")
	}

	backAgain, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant:          tenantContext(tenant),
		HasFreeEpisodes: true,
		Limit:           2,
		Token:           secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("filtered page 1 revisited: %v", err)
	}
	if got := seriesPublicIDs(backAgain.Msg.Series); len(got) != 2 || got[0] != "SERIESFREE03" || got[1] != "SERIESFREE02" {
		t.Fatalf("filtered page 1 revisited = %v, want the two newest free series again", got)
	}

	// The same token in the unfiltered list points at a page that list does not
	// have: the series between the boundary and the next free one are back.
	if _, err := client.ListPublishedSeries(context.Background(), connect.NewRequest(&publirav1.ListPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
		Token:  firstPage.Msg.NextToken,
	})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("filtered token in the unfiltered list code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
}
