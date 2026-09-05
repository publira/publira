package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func TestDBGetPublishedLabelDetailListsPublishedSeriesByTitle(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	label := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{
		PublicID: "LABELPUB001",
		Name:     "Jump",
	})

	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESZETA01", Title: "Zeta", Published: true, LabelID: label.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESALPHA1", Title: "Alpha", Published: true, LabelID: label.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft Only", LabelID: label.ID})

	resp, err := env.catalogClient().GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: label.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail: %v", err)
	}
	if resp.Msg.Label.Name != "Jump" {
		t.Fatalf("label name = %q, want Jump", resp.Msg.Label.Name)
	}
	if resp.Msg.Label.PublishedSeriesCount != 2 {
		t.Fatalf("published_series_count = %d, want 2 (draft excluded)", resp.Msg.Label.PublishedSeriesCount)
	}
	got := seriesPublicIDs(resp.Msg.Series)
	if len(got) != 2 || got[0] != "SERIESALPHA1" || got[1] != "SERIESZETA01" {
		t.Fatalf("series = %v, want Alpha then Zeta", got)
	}
}

func TestDBGetPublishedLabelDetailPagesForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	label := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELPUB001", Name: "Jump"})

	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESALPHA1", Title: "Alpha", Published: true, LabelID: label.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESBETA01", Title: "Beta", Published: true, LabelID: label.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESZETA01", Title: "Zeta", Published: true, LabelID: label.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft Only", LabelID: label.ID})

	client := env.catalogClient()
	firstPage, err := client.GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: label.PublicID,
		Limit:    2,
	}))
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail page 1: %v", err)
	}
	if got := seriesPublicIDs(firstPage.Msg.Series); len(got) != 2 || got[0] != "SERIESALPHA1" || got[1] != "SERIESBETA01" {
		t.Fatalf("page 1 = %v, want Alpha then Beta", got)
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("page 1 next_token is empty, want a token for the remaining series")
	}

	secondPage, err := client.GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: label.PublicID,
		Limit:    2,
		Token:    firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail page 2: %v", err)
	}
	if got := seriesPublicIDs(secondPage.Msg.Series); len(got) != 1 || got[0] != "SERIESZETA01" {
		t.Fatalf("page 2 = %v, want Zeta alone", got)
	}

	backAgain, err := client.GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: label.PublicID,
		Limit:    2,
		Token:    secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail back to page 1: %v", err)
	}
	if got := seriesPublicIDs(backAgain.Msg.Series); len(got) != 2 || got[0] != "SERIESALPHA1" || got[1] != "SERIESBETA01" {
		t.Fatalf("page 1 revisited = %v, want Alpha then Beta again", got)
	}
}

func TestDBGetPublishedLabelDetailExcludesAnotherTenantsLabel(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	mine := env.PG.SeedLabel(t, first.ID, testutil.LabelSeed{PublicID: "LABELA00001", Name: "Tenant A Label"})
	theirs := env.PG.SeedLabel(t, second.ID, testutil.LabelSeed{PublicID: "LABELB00001", Name: "Tenant B Label"})
	_ = env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Tenant A Series", Published: true, LabelID: mine.ID})
	_ = env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Tenant B Series", Published: true, LabelID: theirs.ID})

	client := env.catalogClient()
	_, err := client.GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   tenantContext(first),
		PublicId: theirs.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetPublishedLabelDetail across tenants code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBGetPublishedLabelDetailKeepsLabelWithOnlyDraftSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	label := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELDRAFT1", Name: "Draft Label"})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESDRAFT1", Title: "Draft", LabelID: label.ID})

	resp, err := env.catalogClient().GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: label.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail: %v", err)
	}
	if resp.Msg.Label.PublishedSeriesCount != 0 {
		t.Fatalf("published_series_count = %d, want 0", resp.Msg.Label.PublishedSeriesCount)
	}
	if len(resp.Msg.Series) != 0 {
		t.Fatalf("series = %v, want empty", seriesPublicIDs(resp.Msg.Series))
	}
}

func TestDBGetPublishedLabelDetailHidesMissingLabel(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_, err := env.catalogClient().GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: "MISSING00001",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetPublishedLabelDetail missing code = %v, want not_found (err=%v)", connect.CodeOf(err), err)
	}
}

func TestDBGetPublishedLabelDetailDoesNotListAnotherLabelsSeries(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")
	mine := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELMINE001", Name: "Mine"})
	other := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELOTHER01", Name: "Other"})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESMINE01", Title: "Mine Story", Published: true, LabelID: mine.ID})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESOTHER1", Title: "Other Story", Published: true, LabelID: other.ID})

	resp, err := env.catalogClient().GetPublishedLabelDetail(context.Background(), connect.NewRequest(&publirav1.GetPublishedLabelDetailRequest{
		Tenant:   tenantContext(tenant),
		PublicId: mine.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetPublishedLabelDetail: %v", err)
	}
	got := seriesPublicIDs(resp.Msg.Series)
	if len(got) != 1 || got[0] != "SERIESMINE01" {
		t.Fatalf("series = %v, want only SERIESMINE01", got)
	}
}

func TestDBSearchPublishedSeriesMatchesTitleAndSynopsis(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESTITLE1",
		Title:     "Moonlight Chronicle",
		Synopsis:  "A quiet town",
		Published: true,
	})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESSYN01",
		Title:     "Daybreak",
		Synopsis:  "The moonlight returns",
		Published: true,
	})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESMISS01",
		Title:     "Unrelated",
		Synopsis:  "Nothing to see",
		Published: true,
	})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID: "SERIESDRAFT1",
		Title:    "Moonlight Draft",
		Synopsis: "Moonlight but unpublished",
	})

	resp, err := env.catalogClient().SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Query:  "moonlight",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	got := seriesPublicIDs(resp.Msg.Series)
	if len(got) != 2 || got[0] != "SERIESSYN01" || got[1] != "SERIESTITLE1" {
		t.Fatalf("series = %v, want Daybreak then Moonlight Chronicle (title asc)", got)
	}
}

func TestDBSearchPublishedSeriesEscapesIlikeMetacharacters(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESPCT001",
		Title:     "100% Magical",
		Published: true,
	})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:  "SERIESOTH001",
		Title:     "100 Magical",
		Published: true,
	})

	resp, err := env.catalogClient().SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Query:  "100%",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	got := seriesPublicIDs(resp.Msg.Series)
	if len(got) != 1 || got[0] != "SERIESPCT001" {
		t.Fatalf("series = %v, want only the literal 100%% title", got)
	}
}

func TestDBSearchPublishedSeriesExcludesAnotherTenant(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	_ = env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Shared Keyword Story", Published: true})
	_ = env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Shared Keyword Tale", Published: true})

	resp, err := env.catalogClient().SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: tenantContext(first),
		Query:  "Shared Keyword",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	got := seriesPublicIDs(resp.Msg.Series)
	if len(got) != 1 || got[0] != "SERIESA00001" {
		t.Fatalf("series = %v, want only tenant A's hit", got)
	}
}

func TestDBSearchPublishedSeriesPagesForwardAndBack(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESALPHA1", Title: "Alpha Seed", Published: true})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESBETA01", Title: "Beta Seed", Published: true})
	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIESZETA01", Title: "Zeta Seed", Published: true})

	client := env.catalogClient()
	firstPage, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Query:  "Seed",
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries page 1: %v", err)
	}
	if got := seriesPublicIDs(firstPage.Msg.Series); len(got) != 2 || got[0] != "SERIESALPHA1" || got[1] != "SERIESBETA01" {
		t.Fatalf("page 1 = %v, want Alpha then Beta", got)
	}

	secondPage, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Query:  "Seed",
		Limit:  2,
		Token:  firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries page 2: %v", err)
	}
	if got := seriesPublicIDs(secondPage.Msg.Series); len(got) != 1 || got[0] != "SERIESZETA01" {
		t.Fatalf("page 2 = %v, want Zeta alone", got)
	}

	backAgain, err := client.SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Query:  "Seed",
		Limit:  2,
		Token:  secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries back to page 1: %v", err)
	}
	if got := seriesPublicIDs(backAgain.Msg.Series); len(got) != 2 || got[0] != "SERIESALPHA1" || got[1] != "SERIESBETA01" {
		t.Fatalf("page 1 revisited = %v, want Alpha then Beta again", got)
	}
}

func TestDBSearchPublishedSeriesHidesFuturePublication(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	_ = env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESFUTUR1",
		Title:       "Moonlight Tomorrow",
		Published:   true,
		PublishedAt: time.Now().Add(24 * time.Hour),
	})

	resp, err := env.catalogClient().SearchPublishedSeries(context.Background(), connect.NewRequest(&publirav1.SearchPublishedSeriesRequest{
		Tenant: tenantContext(tenant),
		Query:  "Moonlight",
	}))
	if err != nil {
		t.Fatalf("SearchPublishedSeries: %v", err)
	}
	if got := seriesPublicIDs(resp.Msg.Series); len(got) != 0 {
		t.Fatalf("series = %v, want none (future publication)", got)
	}
}
