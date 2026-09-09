package publicapi

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// The related list is the one catalogue read whose order is computed per row
// out of four other tables. The sqlmock tests hand the scored ids straight to
// the handler, so only these cases show that the SQL scores and pages the way
// the RPC promises, and that RLS keeps one tenant's catalogue out of another's
// strip.

func (e *publicDBEnv) listRelatedSeries(
	t *testing.T,
	req *publirav1.ListRelatedSeriesRequest,
) *publirav1.ListRelatedSeriesResponse {
	t.Helper()

	resp, err := e.catalogClient().ListRelatedSeries(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("ListRelatedSeries: %v", err)
	}
	return resp.Msg
}

func TestDBListRelatedSeriesRanksSharedCreatorsAboveLabelsAndGenres(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	label := env.PG.SeedLabel(t, first.ID, testutil.LabelSeed{PublicID: "LABELA000001", Name: "Label A"})
	creator := env.PG.SeedCreator(t, first.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Creator A"})
	genre := env.PG.SeedGenre(t, first.ID, testutil.GenreSeed{PublicID: "GENREA000001", Name: "Adventure"})

	// Every candidate is published in the exact reverse of the order it should
	// come back in, so publication date — the last tie-break — would produce
	// the opposite list. Only the scoring can produce the asserted one, at
	// every step of it.
	subject := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID:    "SERIESASUB01",
		Title:       "The Series Being Read",
		LabelID:     label.ID,
		Published:   true,
		PublishedAt: time.Now().Add(-1 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, first.ID, subject.ID, creator.ID, "writer")
	env.PG.SeedSeriesGenre(t, first.ID, subject.ID, genre.ID)

	sameCreator := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID:    "SERIESACRE01",
		Title:       "By The Same Creator",
		Published:   true,
		PublishedAt: time.Now().Add(-5 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, first.ID, sameCreator.ID, creator.ID, "writer")

	env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID:    "SERIESALAB01",
		Title:       "On The Same Label",
		LabelID:     label.ID,
		Published:   true,
		PublishedAt: time.Now().Add(-4 * time.Hour),
	})

	sameGenre := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAGEN01",
		Title:       "In The Same Genre",
		Published:   true,
		PublishedAt: time.Now().Add(-3 * time.Hour),
	})
	env.PG.SeedSeriesGenre(t, first.ID, sameGenre.ID, genre.ID)

	env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID:    "SERIESANON01",
		Title:       "Sharing Nothing",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})

	// The other tenant's series carries the same kind of relation and must
	// still stay out: the scoring reaches four tables, and every one of them is
	// a way across the boundary.
	otherLabel := env.PG.SeedLabel(t, second.ID, testutil.LabelSeed{PublicID: "LABELB000001", Name: "Label B"})
	env.PG.SeedSeries(t, second.ID, testutil.SeriesSeed{
		PublicID:    "SERIESBLAB01",
		Title:       "Another Tenant's Series",
		LabelID:     otherLabel.ID,
		Published:   true,
		PublishedAt: time.Now().Add(-1 * time.Hour),
	})

	// A draft shares the creator and still has nothing to offer a reader.
	draft := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID: "SERIESADRF01",
		Title:    "Still A Draft",
	})
	env.PG.SeedSeriesCreator(t, first.ID, draft.ID, creator.ID, "writer")

	resp := env.listRelatedSeries(t, &publirav1.ListRelatedSeriesRequest{
		SeriesPublicId: subject.PublicID,
		Tenant:         tenantContext(first),
	})
	assertSeriesPublicIDs(t, resp.Series, "SERIESACRE01", "SERIESALAB01", "SERIESAGEN01", "SERIESANON01")
}

// Genres and tags count one each and add up, so a series sharing more of them
// outranks one sharing fewer.
func TestDBListRelatedSeriesAddsUpGenresAndTags(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	genre := env.PG.SeedGenre(t, tenant.ID, testutil.GenreSeed{PublicID: "GENREA000001", Name: "Adventure"})
	timeTravel := env.PG.SeedTag(t, tenant.ID, testutil.TagSeed{Name: "Time Travel"})
	slowBurn := env.PG.SeedTag(t, tenant.ID, testutil.TagSeed{Name: "Slow Burn"})

	subject := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESASUB01",
		Title:       "The Series Being Read",
		Published:   true,
		PublishedAt: time.Now().Add(-1 * time.Hour),
	})
	env.PG.SeedSeriesGenre(t, tenant.ID, subject.ID, genre.ID)
	env.PG.SeedSeriesTag(t, tenant.ID, subject.ID, timeTravel.ID)
	env.PG.SeedSeriesTag(t, tenant.ID, subject.ID, slowBurn.ID)

	// Seeded and published in the reverse of the order they should come back
	// in, so only the scoring can produce that order.
	genreOnly := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAGEN01",
		Title:       "Same Genre Only",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})
	env.PG.SeedSeriesGenre(t, tenant.ID, genreOnly.ID, genre.ID)

	bothTags := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESATAG02",
		Title:       "Both Tags",
		Published:   true,
		PublishedAt: time.Now().Add(-3 * time.Hour),
	})
	env.PG.SeedSeriesTag(t, tenant.ID, bothTags.ID, timeTravel.ID)
	env.PG.SeedSeriesTag(t, tenant.ID, bothTags.ID, slowBurn.ID)

	everything := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESABOT01",
		Title:       "Same Genre And Both Tags",
		Published:   true,
		PublishedAt: time.Now().Add(-4 * time.Hour),
	})
	env.PG.SeedSeriesGenre(t, tenant.ID, everything.ID, genre.ID)
	env.PG.SeedSeriesTag(t, tenant.ID, everything.ID, timeTravel.ID)
	env.PG.SeedSeriesTag(t, tenant.ID, everything.ID, slowBurn.ID)

	resp := env.listRelatedSeries(t, &publirav1.ListRelatedSeriesRequest{
		SeriesPublicId: subject.PublicID,
		Tenant:         tenantContext(tenant),
	})
	assertSeriesPublicIDs(t, resp.Series, "SERIESABOT01", "SERIESATAG02", "SERIESAGEN01")
}

// A series nothing relates to still gets a strip: everything scores 0, and the
// weekly ranking decides the order among them.
func TestDBListRelatedSeriesFallsBackToTheRankingWithoutARelation(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	subject := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESASUB01",
		Title:       "The Series Being Read",
		Published:   true,
		PublishedAt: time.Now().Add(-1 * time.Hour),
	})
	// Ranked oldest first, so the ranking order is not the publication order
	// the list would fall back on with no snapshot at all.
	rankedSecond := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAOLD01",
		Title:       "Ranked Second",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})
	rankedFirst := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAMID01",
		Title:       "Ranked First",
		Published:   true,
		PublishedAt: time.Now().Add(-3 * time.Hour),
	})
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAUNR01",
		Title:       "Unranked",
		Published:   true,
		PublishedAt: time.Now().Add(-4 * time.Hour),
	})

	// The subject leads the ranking and must still be left out of its own list.
	env.seedRankingSnapshot(t, tenant.ID, subject.ID, rankedFirst.ID, rankedSecond.ID)

	resp := env.listRelatedSeries(t, &publirav1.ListRelatedSeriesRequest{
		SeriesPublicId: subject.PublicID,
		Tenant:         tenantContext(tenant),
	})
	assertSeriesPublicIDs(t, resp.Series, "SERIESAMID01", "SERIESAOLD01", "SERIESAUNR01")
}

// The ranking only breaks ties, so it never lifts an unrelated series over a
// related one.
func TestDBListRelatedSeriesKeepsScoreAboveTheRanking(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Creator A"})

	subject := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESASUB01",
		Title:       "The Series Being Read",
		Published:   true,
		PublishedAt: time.Now().Add(-1 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, tenant.ID, subject.ID, creator.ID, "writer")

	related := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESACRE01",
		Title:       "By The Same Creator",
		Published:   true,
		PublishedAt: time.Now().Add(-3 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, tenant.ID, related.ID, creator.ID, "writer")

	popular := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESAPOP01",
		Title:       "Read By Everyone",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})

	env.seedRankingSnapshot(t, tenant.ID, popular.ID)

	resp := env.listRelatedSeries(t, &publirav1.ListRelatedSeriesRequest{
		SeriesPublicId: subject.PublicID,
		Tenant:         tenantContext(tenant),
	})
	assertSeriesPublicIDs(t, resp.Series, "SERIESACRE01", "SERIESAPOP01")
}

func TestDBListRelatedSeriesPagesAcrossTheScoreBoundary(t *testing.T) {
	env := newPublicDBEnv(t)
	tenant := env.seedTenant(t, "TENANTA", "tenant-a.example.com", "Tenant A")

	label := env.PG.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABELA000001", Name: "Label A"})
	creator := env.PG.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Creator A"})

	subject := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESASUB01",
		Title:       "The Series Being Read",
		LabelID:     label.ID,
		Published:   true,
		PublishedAt: time.Now().Add(-1 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, tenant.ID, subject.ID, creator.ID, "writer")

	// Published in the reverse of the order the pages should walk, so a page
	// boundary that fell back on publication date would be visible as a page
	// holding the wrong series.
	sameCreator := env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESACRE01",
		Title:       "By The Same Creator",
		Published:   true,
		PublishedAt: time.Now().Add(-4 * time.Hour),
	})
	env.PG.SeedSeriesCreator(t, tenant.ID, sameCreator.ID, creator.ID, "writer")

	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESALAB01",
		Title:       "On The Same Label",
		LabelID:     label.ID,
		Published:   true,
		PublishedAt: time.Now().Add(-3 * time.Hour),
	})
	env.PG.SeedSeries(t, tenant.ID, testutil.SeriesSeed{
		PublicID:    "SERIESANON01",
		Title:       "Sharing Nothing",
		Published:   true,
		PublishedAt: time.Now().Add(-2 * time.Hour),
	})

	// Page 1 stops inside the related run, page 2 crosses out of it — the
	// "see more" path a strip of twelve grows into.
	first := env.listRelatedSeries(t, &publirav1.ListRelatedSeriesRequest{
		Limit:          1,
		SeriesPublicId: subject.PublicID,
		Tenant:         tenantContext(tenant),
	})
	assertSeriesPublicIDs(t, first.Series, "SERIESACRE01")
	if first.PreviousToken != "" {
		t.Fatalf("previous_token = %q, want empty on the first page", first.PreviousToken)
	}

	second := env.listRelatedSeries(t, &publirav1.ListRelatedSeriesRequest{
		Limit:          2,
		SeriesPublicId: subject.PublicID,
		Tenant:         tenantContext(tenant),
		Token:          first.NextToken,
	})
	assertSeriesPublicIDs(t, second.Series, "SERIESALAB01", "SERIESANON01")
	if second.NextToken != "" {
		t.Fatalf("next_token = %q, want empty on the last page", second.NextToken)
	}

	// Walking back over the same boundary has to land on the page just left.
	back := env.listRelatedSeries(t, &publirav1.ListRelatedSeriesRequest{
		Limit:          1,
		SeriesPublicId: subject.PublicID,
		Tenant:         tenantContext(tenant),
		Token:          second.PreviousToken,
	})
	assertSeriesPublicIDs(t, back.Series, "SERIESACRE01")
}

func TestDBListRelatedSeriesHidesSeriesTheTenantCannotSee(t *testing.T) {
	env := newPublicDBEnv(t)
	first, second := env.seedTwoTenants(t)

	published := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID:    "SERIESASUB01",
		Title:       "Published",
		Published:   true,
		PublishedAt: time.Now().Add(-1 * time.Hour),
	})
	draft := env.PG.SeedSeries(t, first.ID, testutil.SeriesSeed{
		PublicID: "SERIESADRF01",
		Title:    "Still A Draft",
	})

	for _, testCase := range []struct {
		name           string
		tenant         testutil.Tenant
		seriesPublicID string
	}{
		{name: "another tenant's series", tenant: second, seriesPublicID: published.PublicID},
		{name: "an unpublished series", tenant: first, seriesPublicID: draft.PublicID},
		{name: "a series that does not exist", tenant: first, seriesPublicID: "SERIESAXXX01"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := env.catalogClient().ListRelatedSeries(context.Background(), connect.NewRequest(&publirav1.ListRelatedSeriesRequest{
				SeriesPublicId: testCase.seriesPublicID,
				Tenant:         tenantContext(testCase.tenant),
			}))
			if connect.CodeOf(err) != connect.CodeNotFound {
				t.Fatalf("error = %v, want not_found", err)
			}
		})
	}

	// The draft is invisible as a subject and as a neighbour alike.
	resp := env.listRelatedSeries(t, &publirav1.ListRelatedSeriesRequest{
		SeriesPublicId: published.PublicID,
		Tenant:         tenantContext(first),
	})
	if len(resp.Series) != 0 {
		t.Fatalf("series = %v, want none: the only other series is a draft (%s)", seriesPublicIDs(resp.Series), draft.ID)
	}
}
