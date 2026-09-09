package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBSearchPublishedAuthorsMatchesPartOfTheName(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	matching := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID: "AUTHORMATCH",
		Name:     "Aoi Sakura",
	})
	// The name search must not answer with a creator whose biography happens
	// to mention the one being looked for.
	profileOnly := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{
		PublicID:    "AUTHORPROF1",
		Name:        "Kenji Mori",
		ProfileText: "Assisted by Aoi Sakura on an earlier work",
	})
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Title: "Published Story", Published: true})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, matching.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, profileOnly.ID, "artist")

	resp, err := env.catalogClient().SearchPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.SearchPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Query:  "saku",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedAuthors: %v", err)
	}
	if got := authorPublicIDs(resp.Msg.Authors); len(got) != 1 || got[0] != "AUTHORMATCH" {
		t.Fatalf("authors = %v, want only the name match", got)
	}
}

func TestDBSearchPublishedAuthorsMatchesNonASCIINameCaseInsensitively(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	// The query and the stored name are compared by PostgreSQL's ILIKE, so
	// this is the case where a multibyte name and an ASCII case change have to
	// survive the same '%q%' pattern.
	japanese := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORJP001", Name: "夏目 漱石"})
	recased := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORUP001", Name: "NATSUME Soseki"})
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Title: "Published Story", Published: true})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, japanese.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, recased.ID, "writer")

	client := env.catalogClient()
	japaneseHit, err := client.SearchPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.SearchPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Query:  "漱石",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedAuthors for a Japanese name: %v", err)
	}
	if got := authorPublicIDs(japaneseHit.Msg.Authors); len(got) != 1 || got[0] != "AUTHORJP001" {
		t.Fatalf("authors = %v, want the Japanese name found by part of it", got)
	}

	recasedHit, err := client.SearchPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.SearchPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Query:  "natsume",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedAuthors for a recased name: %v", err)
	}
	if got := authorPublicIDs(recasedHit.Msg.Authors); len(got) != 1 || got[0] != "AUTHORUP001" {
		t.Fatalf("authors = %v, want the uppercase name found by a lowercase query", got)
	}
}

func TestDBSearchPublishedAuthorsRequiresAPublishedSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	published := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORPUB01", Name: "Sakura Published"})
	onlyDraft := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORDRAFT", Name: "Sakura Draft"})
	onlyFuture := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORFUTUR", Name: "Sakura Tomorrow"})
	_ = env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORNONE1", Name: "Sakura Uncredited"})

	visible := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Title: "Published Story", Published: true})
	draft := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Still A Draft"})
	future := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESFUTUR1",
		Title:       "Published Tomorrow",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, tenant.ID, visible.ID, published.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, draft.ID, onlyDraft.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, future.ID, onlyFuture.ID, "writer")

	resp, err := env.catalogClient().SearchPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.SearchPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Query:  "Sakura",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedAuthors: %v", err)
	}
	if got := authorPublicIDs(resp.Msg.Authors); len(got) != 1 || got[0] != "AUTHORPUB01" {
		t.Fatalf("authors = %v, want only the author of a currently published series", got)
	}
}

func TestDBSearchPublishedAuthorsEscapesIlikeMetacharacters(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	literal := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORPCT01", Name: "100% Studio"})
	other := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHOROTH01", Name: "100 Studio"})
	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Title: "Published Story", Published: true})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, literal.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, other.ID, "artist")

	resp, err := env.catalogClient().SearchPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.SearchPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Query:  "100%",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedAuthors: %v", err)
	}
	if got := authorPublicIDs(resp.Msg.Authors); len(got) != 1 || got[0] != "AUTHORPCT01" {
		t.Fatalf("authors = %v, want only the literal 100%% name", got)
	}
}

func TestDBSearchPublishedAuthorsExcludesAnotherTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	mine := env.PG.SeedCreator(t, first.ID, testutil.CreatorSeed{PublicID: "AUTHORA0001", Name: "Shared Name Writer"})
	theirs := env.PG.SeedCreator(t, second.ID, testutil.CreatorSeed{PublicID: "AUTHORB0001", Name: "Shared Name Artist"})
	mineSeries := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true})
	theirSeries := env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true})
	env.PG.SeedSeriesCreator(t, first.ID, mineSeries.ID, mine.ID, "writer")
	env.PG.SeedSeriesCreator(t, second.ID, theirSeries.ID, theirs.ID, "writer")

	resp, err := env.catalogClient().SearchPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.SearchPublishedAuthorsRequest{
		Tenant: tenantContext(first),
		Query:  "Shared Name",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedAuthors: %v", err)
	}
	if got := authorPublicIDs(resp.Msg.Authors); len(got) != 1 || got[0] != "AUTHORA0001" {
		t.Fatalf("authors = %v, want only tenant A's hit", got)
	}
}

func TestDBSearchPublishedAuthorsPagesForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	series := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Title: "Published Story", Published: true})
	akira := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORAKIRA", Name: "Akira Ink"})
	mika := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORMIKA0", Name: "Mika Ink"})
	yuki := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "AUTHORYUKI0", Name: "Yuki Ink"})
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, akira.ID, "writer")
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, mika.ID, "artist")
	env.PG.SeedSeriesCreator(t, tenant.ID, series.ID, yuki.ID, "editor")

	client := env.catalogClient()
	firstPage, err := client.SearchPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.SearchPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Query:  "Ink",
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedAuthors page 1: %v", err)
	}
	if got := authorPublicIDs(firstPage.Msg.Authors); len(got) != 2 || got[0] != "AUTHORAKIRA" || got[1] != "AUTHORMIKA0" {
		t.Fatalf("page 1 = %v, want Akira then Mika", got)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("page 1 next_token is empty, want a token for the remaining author")
	}

	secondPage, err := client.SearchPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.SearchPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Query:  "Ink",
		Limit:  2,
		Token:  firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedAuthors page 2: %v", err)
	}
	if got := authorPublicIDs(secondPage.Msg.Authors); len(got) != 1 || got[0] != "AUTHORYUKI0" {
		t.Fatalf("page 2 = %v, want Yuki alone", got)
	}

	backAgain, err := client.SearchPublishedAuthors(context.Background(), connect.NewRequest(&publirav1.SearchPublishedAuthorsRequest{
		Tenant: tenantContext(tenant),
		Query:  "Ink",
		Limit:  2,
		Token:  secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedAuthors back to page 1: %v", err)
	}
	if got := authorPublicIDs(backAgain.Msg.Authors); len(got) != 2 || got[0] != "AUTHORAKIRA" || got[1] != "AUTHORMIKA0" {
		t.Fatalf("page 1 revisited = %v, want Akira then Mika again", got)
	}
}

func TestDBSearchPublishedLabelsMatchesPartOfTheName(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	matching := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELMATCH1", Name: "Moonlight Comics"})
	other := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELOTHER1", Name: "Daybreak Comics"})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESMOON01", Title: "Moon Story", Published: true, LabelID: matching.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDAY001", Title: "Day Story", Published: true, LabelID: other.ID})

	resp, err := env.catalogClient().SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: tenantContext(tenant),
		Query:  "moonl",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels: %v", err)
	}
	if got := labelPublicIDs(resp.Msg.Labels); len(got) != 1 || got[0] != "LABELMATCH1" {
		t.Fatalf("labels = %v, want only the name match", got)
	}
}

func TestDBSearchPublishedLabelsMatchesNonASCIINameCaseInsensitively(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	// A multibyte label name and an ASCII case change have to survive the same
	// '%q%' ILIKE pattern, as they do for the author search.
	japanese := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELJP0001", Name: "月刊コミック"})
	recased := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELUP0001", Name: "MONTHLY COMICS"})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESJP0001", Title: "Japanese Label Story", Published: true, LabelID: japanese.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESUP0001", Title: "Recased Label Story", Published: true, LabelID: recased.ID})

	client := env.catalogClient()
	japaneseHit, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: tenantContext(tenant),
		Query:  "コミック",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels for a Japanese name: %v", err)
	}
	if got := labelPublicIDs(japaneseHit.Msg.Labels); len(got) != 1 || got[0] != "LABELJP0001" {
		t.Fatalf("labels = %v, want the Japanese name found by part of it", got)
	}

	recasedHit, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: tenantContext(tenant),
		Query:  "monthly",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels for a recased name: %v", err)
	}
	if got := labelPublicIDs(recasedHit.Msg.Labels); len(got) != 1 || got[0] != "LABELUP0001" {
		t.Fatalf("labels = %v, want the uppercase name found by a lowercase query", got)
	}
}

func TestDBSearchPublishedLabelsRequireAPublishedSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	published := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELPUB001", Name: "Comics Published"})
	onlyDraft := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELDRAFT1", Name: "Comics Draft"})
	onlyFuture := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELFUTUR1", Name: "Comics Tomorrow"})
	_ = env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELEMPTY1", Name: "Comics Empty"})

	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPUB001", Title: "Published Story", Published: true, LabelID: published.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Still A Draft", LabelID: onlyDraft.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESFUTUR1",
		Title:       "Published Tomorrow",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
		LabelID:     onlyFuture.ID,
	})

	resp, err := env.catalogClient().SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: tenantContext(tenant),
		Query:  "Comics",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels: %v", err)
	}
	if got := labelPublicIDs(resp.Msg.Labels); len(got) != 1 || got[0] != "LABELPUB001" {
		t.Fatalf("labels = %v, want only the label holding a currently published series", got)
	}
}

func TestDBSearchPublishedLabelsEscapesIlikeMetacharacters(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	literal := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELPCT001", Name: "100% Comics"})
	other := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELOTH001", Name: "100 Comics"})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESPCT001", Title: "Literal Story", Published: true, LabelID: literal.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESOTH001", Title: "Other Story", Published: true, LabelID: other.ID})

	resp, err := env.catalogClient().SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: tenantContext(tenant),
		Query:  "100%",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels: %v", err)
	}
	if got := labelPublicIDs(resp.Msg.Labels); len(got) != 1 || got[0] != "LABELPCT001" {
		t.Fatalf("labels = %v, want only the literal 100%% name", got)
	}
}

func TestDBSearchPublishedLabelsExcludesAnotherTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	mine := env.PG.SeedLabel(t, first.ID, testutil.LabelSeed{PublicID: "LABELA00001", Name: "Shared Name Comics"})
	theirs := env.PG.SeedLabel(t, second.ID, testutil.LabelSeed{PublicID: "LABELB00001", Name: "Shared Name Books"})
	_ = env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true, LabelID: mine.ID})
	_ = env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true, LabelID: theirs.ID})

	resp, err := env.catalogClient().SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: tenantContext(first),
		Query:  "Shared Name",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels: %v", err)
	}
	if got := labelPublicIDs(resp.Msg.Labels); len(got) != 1 || got[0] != "LABELA00001" {
		t.Fatalf("labels = %v, want only tenant A's hit", got)
	}
}

func TestDBSearchPublishedLabelsPagesForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	alpha := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELALPHA1", Name: "Alpha Comics"})
	beta := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELBETA01", Name: "Beta Comics"})
	zeta := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELZETA01", Name: "Zeta Comics"})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESALPHA1", Title: "Alpha Story", Published: true, LabelID: alpha.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESBETA01", Title: "Beta Story", Published: true, LabelID: beta.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESZETA01", Title: "Zeta Story", Published: true, LabelID: zeta.ID})

	client := env.catalogClient()
	firstPage, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: tenantContext(tenant),
		Query:  "Comics",
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels page 1: %v", err)
	}
	if got := labelPublicIDs(firstPage.Msg.Labels); len(got) != 2 || got[0] != "LABELALPHA1" || got[1] != "LABELBETA01" {
		t.Fatalf("page 1 = %v, want Alpha then Beta", got)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("page 1 next_token is empty, want a token for the remaining label")
	}

	secondPage, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: tenantContext(tenant),
		Query:  "Comics",
		Limit:  2,
		Token:  firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels page 2: %v", err)
	}
	if got := labelPublicIDs(secondPage.Msg.Labels); len(got) != 1 || got[0] != "LABELZETA01" {
		t.Fatalf("page 2 = %v, want Zeta alone", got)
	}

	backAgain, err := client.SearchPublishedLabels(context.Background(), connect.NewRequest(&publirav1.SearchPublishedLabelsRequest{
		Tenant: tenantContext(tenant),
		Query:  "Comics",
		Limit:  2,
		Token:  secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedLabels back to page 1: %v", err)
	}
	if got := labelPublicIDs(backAgain.Msg.Labels); len(got) != 2 || got[0] != "LABELALPHA1" || got[1] != "LABELBETA01" {
		t.Fatalf("page 1 revisited = %v, want Alpha then Beta again", got)
	}
}
