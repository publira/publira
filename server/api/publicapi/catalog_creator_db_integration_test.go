package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func creatorPublicIDs(items []*publirav1.PublishedCreator) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.PublicId)
	}
	return ids
}

func TestDBListPublishedCreatorsReturnsOnlyCreatorsWithPublishedSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	published := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID:    "CREATORPUB01",
		Name:        "Mika",
		ProfileText: "Writes published work",
	})
	onlyDraft := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID: "CREATORDRAFT",
		Name:     "Akira",
	})
	onlyFuture := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID: "CREATORFUTUR",
		Name:     "Yuki",
	})
	uncredited := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID: "CREATORNONE1",
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
	env.PG.SeedSeriesCreator(t, tenant.ID, visible.ID, published.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, draft.ID, onlyDraft.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, future.ID, onlyFuture.ID, "")

	resp, err := env.catalogClient().ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: tenantContext(tenant),
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators: %v", err)
	}
	got := creatorPublicIDs(resp.Msg.Creators)
	if len(got) != 1 || got[0] != "CREATORPUB01" {
		t.Fatalf("creators = %v, want only CREATORPUB01", got)
	}
	if resp.Msg.Creators[0].PublishedSeriesCount != 1 {
		t.Fatalf("published_series_count = %d, want 1", resp.Msg.Creators[0].PublishedSeriesCount)
	}
	if resp.Msg.Creators[0].ProfileText != "Writes published work" {
		t.Fatalf("profile_text = %q, want the seeded profile", resp.Msg.Creators[0].ProfileText)
	}
}

func TestDBListPublishedCreatorsExcludesAnotherTenantsCreators(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	mine := env.PG.SeedCreator(t, first.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Tenant A Creator"})
	theirs := env.PG.SeedCreator(t, second.ID, testutil.CreatorSeed{PublicID: "CREATORB0001", Name: "Tenant B Creator"})
	mineSeries := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true})
	theirSeries := env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true})
	env.PG.SeedSeriesCreator(t, first.ID, mineSeries.ID, mine.ID, "")
	env.PG.SeedSeriesCreator(t, second.ID, theirSeries.ID, theirs.ID, "")

	client := env.catalogClient()
	listed, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: tenantContext(first),
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators for tenant A: %v", err)
	}
	if got := creatorPublicIDs(listed.Msg.Creators); len(got) != 1 || got[0] != "CREATORA0001" {
		t.Fatalf("tenant A creators = %v, want only CREATORA0001", got)
	}

	_, err = client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   tenantContext(first),
		PublicId: theirs.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetPublishedCreatorDetail across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBListPublishedCreatorsPagesForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	akira := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORAKIRA", Name: "Akira"})
	mika := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORMIKA0", Name: "Mika"})
	yuki := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORYUKI0", Name: "Yuki"})
	for i, creator := range []testutil.Creator{akira, mika, yuki} {
		series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
			PublicID:  []string{"SERIESAKIRA", "SERIESMIKA0", "SERIESYUKI0"}[i],
			Title:     creator.Name + " Story",
			Published: true,
		})
		env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, creator.ID, "")
	}

	client := env.catalogClient()
	firstPage, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators page 1: %v", err)
	}
	if got := creatorPublicIDs(firstPage.Msg.Creators); len(got) != 2 || got[0] != "CREATORAKIRA" || got[1] != "CREATORMIKA0" {
		t.Fatalf("page 1 = %v, want Akira then Mika", got)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("page 1 next_token is empty, want a token for the remaining creator")
	}
	if firstPage.Msg.PreviousToken != "" {
		t.Fatalf("page 1 previous_token = %q, want empty on the first page", firstPage.Msg.PreviousToken)
	}

	secondPage, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
		Token:  firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators page 2: %v", err)
	}
	if got := creatorPublicIDs(secondPage.Msg.Creators); len(got) != 1 || got[0] != "CREATORYUKI0" {
		t.Fatalf("page 2 = %v, want Yuki alone", got)
	}
	if secondPage.Msg.NextToken != "" {
		t.Fatalf("page 2 next_token = %q, want empty at the end of the list", secondPage.Msg.NextToken)
	}
	if secondPage.Msg.PreviousToken == "" {
		t.Fatal("page 2 previous_token is empty, want a token back to the first page")
	}

	backAgain, err := client.ListPublishedCreators(context.Background(), connect.NewRequest(&publirav1.ListPublishedCreatorsRequest{
		Tenant: tenantContext(tenant),
		Limit:  2,
		Token:  secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("ListPublishedCreators back to page 1: %v", err)
	}
	if got := creatorPublicIDs(backAgain.Msg.Creators); len(got) != 2 || got[0] != "CREATORAKIRA" || got[1] != "CREATORMIKA0" {
		t.Fatalf("page 1 revisited = %v, want Akira then Mika again", got)
	}
}

func TestDBGetPublishedCreatorDetailListsPublishedSeriesByTitle(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID:    "CREATORPUB01",
		Name:        "Mika",
		ProfileText: "Writes two stories",
	})

	zeta := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESZETA01", Title: "Zeta", Published: true})
	alpha := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESALPHA1", Title: "Alpha", Published: true})
	draft := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft Only"})
	env.PG.SeedSeriesCreator(t, tenant.ID, zeta.ID, creator.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, alpha.ID, creator.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, draft.ID, creator.ID, "")

	resp, err := env.catalogClient().GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: creator.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail: %v", err)
	}
	if resp.Msg.Creator.Name != "Mika" || resp.Msg.Creator.ProfileText != "Writes two stories" {
		t.Fatalf("creator = %+v, want Mika with the seeded profile", resp.Msg.Creator)
	}
	if resp.Msg.Creator.PublishedSeriesCount != 2 {
		t.Fatalf("published_series_count = %d, want 2 (draft excluded)", resp.Msg.Creator.PublishedSeriesCount)
	}
	got := seriesPublicIDs(resp.Msg.Series)
	if len(got) != 2 || got[0] != "SERIESALPHA1" || got[1] != "SERIESZETA01" {
		t.Fatalf("series = %v, want Alpha then Zeta", got)
	}
	if resp.Msg.PreviousToken != "" || resp.Msg.NextToken != "" {
		t.Fatalf("tokens = (%q, %q), want both empty when every series fits in one page", resp.Msg.PreviousToken, resp.Msg.NextToken)
	}
}

func TestDBGetPublishedCreatorDetailPagesForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID: "CREATORPUB01",
		Name:     "Mika",
	})

	alpha := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESALPHA1", Title: "Alpha", Published: true})
	beta := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESBETA01", Title: "Beta", Published: true})
	zeta := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESZETA01", Title: "Zeta", Published: true})
	draft := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft Only"})
	env.PG.SeedSeriesCreator(t, tenant.ID, alpha.ID, creator.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, beta.ID, creator.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, zeta.ID, creator.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, draft.ID, creator.ID, "")

	client := env.catalogClient()
	firstPage, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: creator.PublicID,
		Limit:    2,
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail page 1: %v", err)
	}
	if got := seriesPublicIDs(firstPage.Msg.Series); len(got) != 2 || got[0] != "SERIESALPHA1" || got[1] != "SERIESBETA01" {
		t.Fatalf("page 1 = %v, want Alpha then Beta", got)
	}
	if firstPage.Msg.Creator.PublishedSeriesCount != 3 {
		t.Fatalf("published_series_count = %d, want 3 (draft excluded)", firstPage.Msg.Creator.PublishedSeriesCount)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("page 1 next_token is empty, want a token for the remaining series")
	}
	if firstPage.Msg.PreviousToken != "" {
		t.Fatalf("page 1 previous_token = %q, want empty on the first page", firstPage.Msg.PreviousToken)
	}

	secondPage, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: creator.PublicID,
		Limit:    2,
		Token:    firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail page 2: %v", err)
	}
	if got := seriesPublicIDs(secondPage.Msg.Series); len(got) != 1 || got[0] != "SERIESZETA01" {
		t.Fatalf("page 2 = %v, want Zeta alone", got)
	}
	if secondPage.Msg.NextToken != "" {
		t.Fatalf("page 2 next_token = %q, want empty at the end of the list", secondPage.Msg.NextToken)
	}
	if secondPage.Msg.PreviousToken == "" {
		t.Fatal("page 2 previous_token is empty, want a token back to the first page")
	}

	backAgain, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: creator.PublicID,
		Limit:    2,
		Token:    secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("GetPublishedCreatorDetail back to page 1: %v", err)
	}
	if got := seriesPublicIDs(backAgain.Msg.Series); len(got) != 2 || got[0] != "SERIESALPHA1" || got[1] != "SERIESBETA01" {
		t.Fatalf("page 1 revisited = %v, want Alpha then Beta again", got)
	}
}

func TestDBGetPublishedCreatorDetailHidesCreatorsWithoutPublishedSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	draftOnly := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORDRAFT", Name: "Draft Creator"})
	futureOnly := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORFUTUR", Name: "Future Creator"})
	draft := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft"})
	future := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESFUTUR1",
		Title:       "Tomorrow",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, tenant.ID, draft.ID, draftOnly.ID, "")
	env.PG.SeedSeriesCreator(t, tenant.ID, future.ID, futureOnly.ID, "")

	client := env.catalogClient()
	for _, publicID := range []string{draftOnly.PublicID, futureOnly.PublicID, "MISSING00001"} {
		_, err := client.GetPublishedCreatorDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedCreatorDetailRequest{
			Tenant:   tenantContext(tenant),
			PublicId: publicID,
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("GetPublishedCreatorDetail %s code = %v, want not_found (err=%v)", publicID, connect.CodeOf(err), err)
		}
	}
}
