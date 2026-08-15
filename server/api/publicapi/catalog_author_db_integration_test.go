package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func authorPublicIDs(items []*publirav1.PublishedAuthor) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.PublicId)
	}
	return ids
}

func TestDBListPublishedAuthorsReturnsOnlyAuthorsWithPublishedSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	published := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID:    "AUTHORPUB01",
		Name:        "Mika",
		ProfileText: "Writes published work",
	})
	onlyDraft := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID: "AUTHORDRAFT",
		Name:     "Akira",
	})
	onlyFuture := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID: "AUTHORFUTUR",
		Name:     "Yuki",
	})
	uncredited := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID: "AUTHORNONE1",
		Name:     "No Series",
	})
	_ = uncredited

	visible := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESPUB01",
		Title:       "Published Story",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})
	draft := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESDRAFT",
		Title:    "Still A Draft",
	})
	future := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESFUTUR",
		Title:       "Published Tomorrow",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, tenant.ID, visible.ID, published.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, draft.ID, onlyDraft.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, future.ID, onlyFuture.ID, "writer")

	resp, err := env.catalogClient().ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors: %v", err)
	}
	got := authorPublicIDs(resp.Msg.Authors)
	if len(got) != 1 || got[0] != "AUTHORPUB01" {
		t.Fatalf("authors = %v, want only AUTHORPUB01", got)
	}
	if resp.Msg.Authors[0].PublishedSeriesCount != 1 {
		t.Fatalf("published_series_count = %d, want 1", resp.Msg.Authors[0].PublishedSeriesCount)
	}
	if resp.Msg.Authors[0].ProfileText != "Writes published work" {
		t.Fatalf("profile_text = %q, want the seeded profile", resp.Msg.Authors[0].ProfileText)
	}
}

func TestDBListPublishedAuthorsExcludesAnotherTenantsAuthors(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	mine := env.PG.SeedCreator(t, first.ID, testutil.CreatorSeed{PublicID: "AUTHORA0001", Name: "Tenant A Author"})
	theirs := env.PG.SeedCreator(t, second.ID, testutil.CreatorSeed{PublicID: "AUTHORB0001", Name: "Tenant B Author"})
	mineSeries := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true})
	theirSeries := env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true})
	env.PG.SeedSeriesCreator(t, first.ID, mineSeries.ID, mine.ID, "writer")
	env.PG.SeedSeriesCreator(t, second.ID, theirSeries.ID, theirs.ID, "writer")

	client := env.catalogClient()
	listed, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: tenantContext(first),
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors for tenant A: %v", err)
	}
	if got := authorPublicIDs(listed.Msg.Authors); len(got) != 1 || got[0] != "AUTHORA0001" {
		t.Fatalf("tenant A authors = %v, want only AUTHORA0001", got)
	}

	_, err = client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   tenantContext(first),
		PublicId: theirs.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetPublishedAuthorDetail across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBListPublishedAuthorsPagesForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	akira := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORAKIRA", Name: "Akira"})
	mika := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORMIKA0", Name: "Mika"})
	yuki := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORYUKI0", Name: "Yuki"})
	for i, creator := range []testutil.Creator{akira, mika, yuki} {
		series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:  []string{"SERIESAKIRA", "SERIESMIKA0", "SERIESYUKI0"}[i],
			Title:     creator.Name + " Story",
			Published: true,
		})
		env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "writer")
	}

	client := env.catalogClient()
	firstPage, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors page 1: %v", err)
	}
	if got := authorPublicIDs(firstPage.Msg.Authors); len(got) != 2 || got[0] != "AUTHORAKIRA" || got[1] != "AUTHORMIKA0" {
		t.Fatalf("page 1 = %v, want Akira then Mika", got)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("page 1 next_token is empty, want a token for the remaining author")
	}
	if firstPage.Msg.PreviousToken != "" {
		t.Fatalf("page 1 previous_token = %q, want empty on the first page", firstPage.Msg.PreviousToken)
	}

	secondPage, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
		Token:  firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors page 2: %v", err)
	}
	if got := authorPublicIDs(secondPage.Msg.Authors); len(got) != 1 || got[0] != "AUTHORYUKI0" {
		t.Fatalf("page 2 = %v, want Yuki alone", got)
	}
	if secondPage.Msg.NextToken != "" {
		t.Fatalf("page 2 next_token = %q, want empty at the end of the list", secondPage.Msg.NextToken)
	}
	if secondPage.Msg.PreviousToken == "" {
		t.Fatal("page 2 previous_token is empty, want a token back to the first page")
	}

	backAgain, err := client.ListPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.ListPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
		Token:  secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("ListPublishedAuthors back to page 1: %v", err)
	}
	if got := authorPublicIDs(backAgain.Msg.Authors); len(got) != 2 || got[0] != "AUTHORAKIRA" || got[1] != "AUTHORMIKA0" {
		t.Fatalf("page 1 revisited = %v, want Akira then Mika again", got)
	}
}

func TestDBGetPublishedAuthorDetailListsPublishedSeriesByTitle(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	author := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID:    "AUTHORPUB01",
		Name:        "Mika",
		ProfileText: "Writes two stories",
	})

	zeta := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESZETA01", Title: "Zeta", Published: true})
	alpha := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESALPHA1", Title: "Alpha", Published: true})
	draft := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft Only"})
	env.PG.SeedSeriesCreator(t, tenant.ID, zeta.ID, author.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, alpha.ID, author.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, draft.ID, author.ID, "writer")

	resp, err := env.catalogClient().GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: author.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetPublishedAuthorDetail: %v", err)
	}
	if resp.Msg.Author.Name != "Mika" || resp.Msg.Author.ProfileText != "Writes two stories" {
		t.Fatalf("author = %+v, want Mika with the seeded profile", resp.Msg.Author)
	}
	if resp.Msg.Author.PublishedSeriesCount != 2 {
		t.Fatalf("published_series_count = %d, want 2 (draft excluded)", resp.Msg.Author.PublishedSeriesCount)
	}
	got := seriesPublicIDs(resp.Msg.Series)
	if len(got) != 2 || got[0] != "SERIESALPHA1" || got[1] != "SERIESZETA01" {
		t.Fatalf("series = %v, want Alpha then Zeta", got)
	}
}

func TestDBGetPublishedAuthorDetailHidesAuthorsWithoutPublishedSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	draftOnly := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORDRAFT", Name: "Draft Author"})
	futureOnly := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORFUTUR", Name: "Future Author"})
	draft := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft"})
	future := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESFUTUR1",
		Title:       "Tomorrow",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, tenant.ID, draft.ID, draftOnly.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, future.ID, futureOnly.ID, "writer")

	client := env.catalogClient()
	for _, publicID := range []string{draftOnly.PublicID, futureOnly.PublicID, "MISSING00001"} {
		_, err := client.GetPublishedAuthorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedAuthorDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: publicID,
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("GetPublishedAuthorDetail %s code = %v, want not_found (err=%v)", publicID, connect.CodeOf(err), err)
		}
	}
}
