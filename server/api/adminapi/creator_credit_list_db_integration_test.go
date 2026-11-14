package adminapi

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/creatorroles"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

func listCreatorCredits(env *adminDBEnv, as adminDBTenant, creatorID uuid.UUID, limit int32, token string) (*publiraadminv1.ListCreatorCreditsResponse, error) {
	return env.creatorClient().ListCreatorCredits(testutil.WithBearer(context.Background(), as.token()), &publiraadminv1.ListCreatorCreditsRequest{
		Tenant:    as.tenantContext(),
		CreatorId: creatorID.String(),
		Limit:     limit,
		Token:     token,
	})
}

// describeCreatorCredit names a credit by what the console shows of it, so a
// list compares as one readable line per credit.
func describeCreatorCredit(credit *publiraadminv1.CreatorCredit) string {
	line := credit.GetSeries().GetTitle()
	if episode := credit.GetEpisode(); episode != nil {
		line += " / " + episode.GetTitle()
		switch credit.GetSource() {
		case publirattypesv1.CreatorCreditSource_CREATOR_CREDIT_SOURCE_SERIES:
			line += " (series)"
		case publirattypesv1.CreatorCreditSource_CREATOR_CREDIT_SOURCE_EPISODE:
			line += " (episode)"
		default:
			line += " (no source)"
		}
	} else if credit.GetSource() != publirattypesv1.CreatorCreditSource_CREATOR_CREDIT_SOURCE_UNSPECIFIED {
		line += " (series credit with a source)"
	}
	if role := credit.GetRole(); role != nil {
		return line + ": " + role.GetName()
	}
	return line + ": no role"
}

// Every credit naming the Author is listed, on a series or an episode of any
// state, grouped by series with the series' own credit first and the episodes
// in reading order, and nothing of another Author. The pages walked forward
// and then back hold the same credits in the same order.
func TestDBListCreatorCreditsListsEveryCreditNamingTheAuthor(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	tenantID := tenant.Tenant.ID
	author := env.PG.SeedCreator(t, tenantID, testutil.CreatorSeed{PublicID: "CRLIST000001", Name: "Listed Author"})
	other := env.PG.SeedCreator(t, tenantID, testutil.CreatorSeed{PublicID: "CRLIST000002", Name: "Other Author"})
	leading := creatorroles.Defaults[0].Name
	artist := creatorroles.Defaults[1].Name

	first := env.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: "SRLIST000001", Title: "First Series"})
	second := env.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: "SRLIST000002", Title: "Second Series", Published: true})
	uncredited := env.PG.SeedSeries(t, tenantID, testutil.SeriesSeed{PublicID: "SRLIST000003", Title: "Uncredited Series"})

	// Seeded out of reading order, so the list has to sort them itself.
	chapterTwo := env.PG.SeedEpisode(t, tenantID, first.ID, testutil.EpisodeSeed{PublicID: "EPLIST000002", Title: "Chapter 2", OrderIndex: 2})
	chapterOne := env.PG.SeedEpisode(t, tenantID, first.ID, testutil.EpisodeSeed{PublicID: "EPLIST000001", Title: "Chapter 1", OrderIndex: 1})
	sideStory := env.PG.SeedEpisode(t, tenantID, second.ID, testutil.EpisodeSeed{PublicID: "EPLIST000003", Title: "Side Story", Status: testutil.EpisodeStatusPublished})
	otherChapter := env.PG.SeedEpisode(t, tenantID, uncredited.ID, testutil.EpisodeSeed{PublicID: "EPLIST000004", Title: "Other Chapter"})

	env.PG.SeedSeriesCreator(t, tenantID, first.ID, author.ID, leading)
	env.PG.SeedSeriesCreator(t, tenantID, first.ID, author.ID, artist)
	env.PG.SeedEpisodeCreator(t, tenantID, chapterTwo.ID, author.ID, leading)
	env.PG.SeedEpisodeCreator(t, tenantID, chapterOne.ID, author.ID, leading)
	env.PG.SeedEpisodeCreator(t, tenantID, chapterOne.ID, other.ID, artist)
	// A guest credit written on the episode alone, and a series credit
	// written before the tenant had roles.
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO episode_creators (tenant_id, episode_id, creator_id, role_id, display_order, source)
		VALUES ($1, $2, $3, $4, 1, 'episode')
	`, tenantID, sideStory.ID, author.ID, env.PG.CreatorRoleByName(t, tenantID, artist).ID); err != nil {
		t.Fatalf("insert the episode's own credit: %v", err)
	}
	if _, err := env.PG.DB.ExecContext(context.Background(), `
		INSERT INTO series_creators (tenant_id, series_id, creator_id, role_id, display_order)
		VALUES ($1, $2, $3, NULL, 0)
	`, tenantID, second.ID, author.ID); err != nil {
		t.Fatalf("insert a credit with no role: %v", err)
	}
	env.PG.SeedSeriesCreator(t, tenantID, uncredited.ID, other.ID, leading)
	env.PG.SeedEpisodeCreator(t, tenantID, otherChapter.ID, other.ID, leading)

	// A role id orders two roles held on one series, so the expectation
	// follows the ids the roles were given rather than their names.
	firstSeriesRoles := []string{leading, artist}
	if env.PG.CreatorRoleByName(t, tenantID, artist).ID.String() < env.PG.CreatorRoleByName(t, tenantID, leading).ID.String() {
		firstSeriesRoles = []string{artist, leading}
	}
	want := []string{
		"First Series: " + firstSeriesRoles[0],
		"First Series: " + firstSeriesRoles[1],
		"First Series / Chapter 1 (series): " + leading,
		"First Series / Chapter 2 (series): " + leading,
		"Second Series: no role",
		"Second Series / Side Story (episode): " + artist,
	}

	res, err := listCreatorCredits(env, tenant, author.ID, 0, "")
	if err != nil {
		t.Fatalf("ListCreatorCredits: %v", err)
	}
	var got []string
	for _, credit := range res.GetCredits() {
		got = append(got, describeCreatorCredit(credit))
	}
	if !slices.Equal(got, want) {
		t.Fatalf("credits = %q, want %q", got, want)
	}
	if res.GetPreviousToken() != "" || res.GetNextToken() != "" {
		t.Errorf("tokens of a single page = %q / %q, want both empty", res.GetPreviousToken(), res.GetNextToken())
	}
	firstCredit := res.GetCredits()[0]
	if s := firstCredit.GetSeries(); s.GetId() != first.ID.String() || s.GetPublicId() != first.PublicID {
		t.Errorf("series of the first credit = %s / %s, want %s / %s", s.GetId(), s.GetPublicId(), first.ID, first.PublicID)
	}
	if role := firstCredit.GetRole(); role.GetId() == "" || role.GetPublicId() == "" {
		t.Errorf("role of the first credit = %+v, want its id and public id", role)
	}
	if e := res.GetCredits()[2].GetEpisode(); e.GetId() != chapterOne.ID.String() || e.GetPublicId() != chapterOne.PublicID {
		t.Errorf("episode of the third credit = %s / %s, want %s / %s", e.GetId(), e.GetPublicId(), chapterOne.ID, chapterOne.PublicID)
	}

	// Two at a time forward, then back again from the last page.
	var forward []string
	var pages []*publiraadminv1.ListCreatorCreditsResponse
	token := ""
	for range len(want) {
		page, err := listCreatorCredits(env, tenant, author.ID, 2, token)
		if err != nil {
			t.Fatalf("ListCreatorCredits page %d: %v", len(pages)+1, err)
		}
		pages = append(pages, page)
		for _, credit := range page.GetCredits() {
			forward = append(forward, describeCreatorCredit(credit))
		}
		if token = page.GetNextToken(); token == "" {
			break
		}
	}
	if !slices.Equal(forward, want) {
		t.Fatalf("credits paged forward = %q, want %q", forward, want)
	}
	if len(pages) != 3 {
		t.Fatalf("pages of two = %d, want 3", len(pages))
	}
	if pages[0].GetPreviousToken() != "" {
		t.Errorf("first page has a previous token")
	}
	var backward []string
	token = pages[len(pages)-1].GetPreviousToken()
	for token != "" {
		page, err := listCreatorCredits(env, tenant, author.ID, 2, token)
		if err != nil {
			t.Fatalf("ListCreatorCredits backward: %v", err)
		}
		var credits []string
		for _, credit := range page.GetCredits() {
			credits = append(credits, describeCreatorCredit(credit))
		}
		backward = append(credits, backward...)
		token = page.GetPreviousToken()
	}
	if wantBack := want[:4]; !slices.Equal(backward, wantBack) {
		t.Fatalf("credits paged back = %q, want %q", backward, wantBack)
	}

	// A tenant_auditor reads them too.
	auditor := env.PG.SeedTenantUser(t, tenantID, "TAAUDIT01", "auditor@tenant-a.example.com", "Auditor", "tenant_auditor")
	if res, err := listCreatorCredits(env, tenant.as(auditor), author.ID, 0, ""); err != nil || len(res.GetCredits()) != len(want) {
		t.Fatalf("ListCreatorCredits as a tenant_auditor = %d credits, %v; want %d", len(res.GetCredits()), err, len(want))
	}
}

// An Author nobody credits has an empty list with no page to move to.
func TestDBListCreatorCreditsOfAnAuthorWithNoCredit(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	author := env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{PublicID: "CRNONE000001", Name: "Uncredited Author"})
	credited := env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{PublicID: "CRNONE000002", Name: "Credited Author"})
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "SRNONE000001", Title: "Series"})
	env.PG.SeedSeriesCreator(t, tenant.Tenant.ID, series.ID, credited.ID, "")

	res, err := listCreatorCredits(env, tenant, author.ID, 0, "")
	if err != nil {
		t.Fatalf("ListCreatorCredits: %v", err)
	}
	if len(res.GetCredits()) != 0 || res.GetPreviousToken() != "" || res.GetNextToken() != "" {
		t.Fatalf("ListCreatorCredits = %+v, want no credit and no token", res)
	}
}

// Another tenant's Author is not found, as one that does not exist is, and
// what each tenant lists of its own Author is that tenant's credits alone.
func TestDBListCreatorCreditsKeepsToTheTenant(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenantA := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAADMIN01", "admin@tenant-a.example.com")
	tenantB := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBADMIN01", "admin@tenant-b.example.com")

	seed := func(tenant adminDBTenant, suffix string) testutil.Creator {
		creator := env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{PublicID: "CRTEN" + suffix, Name: "Author " + suffix})
		series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "SRTEN" + suffix, Title: "Series " + suffix})
		episode := env.PG.SeedEpisode(t, tenant.Tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPTEN" + suffix, Title: "Chapter " + suffix})
		env.PG.SeedSeriesCreator(t, tenant.Tenant.ID, series.ID, creator.ID, "")
		env.PG.SeedEpisodeCreator(t, tenant.Tenant.ID, episode.ID, creator.ID, "")
		return creator
	}
	authorA := seed(tenantA, "0000001")
	authorB := seed(tenantB, "0000002")

	for _, tc := range []struct {
		tenant adminDBTenant
		author testutil.Creator
		suffix string
	}{{tenantA, authorA, "0000001"}, {tenantB, authorB, "0000002"}} {
		res, err := listCreatorCredits(env, tc.tenant, tc.author.ID, 0, "")
		if err != nil {
			t.Fatalf("ListCreatorCredits of %s: %v", tc.author.Name, err)
		}
		var got []string
		for _, credit := range res.GetCredits() {
			got = append(got, describeCreatorCredit(credit))
		}
		leading := creatorroles.Defaults[0].Name
		want := []string{
			fmt.Sprintf("Series %s: %s", tc.suffix, leading),
			fmt.Sprintf("Series %s / Chapter %s (series): %s", tc.suffix, tc.suffix, leading),
		}
		if !slices.Equal(got, want) {
			t.Errorf("credits of %s = %q, want %q", tc.author.Name, got, want)
		}
	}

	if _, err := listCreatorCredits(env, tenantA, authorB.ID, 0, ""); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("ListCreatorCredits of another tenant's Author = %v, want not_found", err)
	}
	if _, err := listCreatorCredits(env, tenantA, uuid.Must(uuid.NewV7()), 0, ""); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("ListCreatorCredits of an Author that does not exist = %v, want not_found", err)
	}
}
