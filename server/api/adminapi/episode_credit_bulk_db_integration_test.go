package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/creatorroles"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// bulkCreditFixture is a series with a team and a run of episodes baked from
// it, which is the shape every range edit acts on.
type bulkCreditFixture struct {
	tenant   adminDBTenant
	series   testutil.Series
	episodes []string
	roles    map[string]testutil.CreatorRole
	creators map[string]testutil.Creator
}

// seedSeriesRun credits the series to one person per named role and creates
// episodeCount episodes from it. The episodes come back in the order they were
// created, which is the order the console's range picker composes.
func seedSeriesRun(t *testing.T, env *adminDBEnv, credited map[string]string, episodeCount int) bulkCreditFixture {
	t.Helper()

	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Long Running Series"})
	roles := make(map[string]testutil.CreatorRole, len(creatorroles.Defaults))
	for _, role := range creatorroles.Defaults {
		roles[role.Name] = env.PG.CreatorRoleByName(t, tenant.Tenant.ID, role.Name)
	}
	fixture := bulkCreditFixture{
		tenant:   tenant,
		series:   series,
		roles:    roles,
		creators: make(map[string]testutil.Creator, len(credited)),
	}
	for roleName, creatorName := range credited {
		creator := env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{Name: creatorName})
		env.PG.SeedSeriesCreator(t, tenant.Tenant.ID, series.ID, creator.ID, roleName)
		fixture.creators[creatorName] = creator
	}
	fixture.episodes = seedMoreEpisodes(t, env, fixture, episodeCount)
	return fixture
}

// seedMoreEpisodes adds episodes to the fixture's series, which is also how a
// test arranges episodes baked from a different team than the ones before them.
func seedMoreEpisodes(t *testing.T, env *adminDBEnv, fixture bulkCreditFixture, count int) []string {
	t.Helper()

	episodes := make([]string, 0, count)
	for range count {
		created, err := env.seriesClient().CreateEpisode(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.CreateEpisodeRequest{
			Tenant:         fixture.tenant.tenantContext(),
			SeriesPublicId: fixture.series.PublicID,
			Title:          "Chapter",
		}))
		if err != nil {
			t.Fatalf("CreateEpisode: %v", err)
		}
		episodes = append(episodes, created.Msg.Episode.PublicId)
	}
	return episodes
}

// seedCreator adds someone who is not on the series' standing team — a
// successor, a guest, a person left off when the series was created — and keeps
// them where credit can find them by name.
func (f bulkCreditFixture) seedCreator(t *testing.T, env *adminDBEnv, name string) {
	t.Helper()

	f.creators[name] = env.PG.SeedCreator(t, f.tenant.Tenant.ID, testutil.CreatorSeed{Name: name})
}

// credit names one (creator, role) pair the way a request carries it, by the
// name the person was seeded under, so a test says who it means rather than
// carrying public IDs around.
func (f bulkCreditFixture) credit(t *testing.T, creatorName, roleName string) *publiraadminv1.EpisodeCreatorCredit {
	t.Helper()

	creator, ok := f.creators[creatorName]
	if !ok {
		t.Fatalf("no creator named %q was seeded", creatorName)
	}
	return &publiraadminv1.EpisodeCreatorCredit{
		CreatorPublicId: creator.PublicID,
		RolePublicId:    f.roles[roleName].PublicID,
	}
}

// creditEpisodeWithAGuest adds one credit to a single episode through the
// per-episode editor. That is what makes the episode's set differ from the
// series', and the row it writes is the episode's own.
func creditEpisodeWithAGuest(t *testing.T, env *adminDBEnv, fixture bulkCreditFixture, episodePublicID string, guest *publiraadminv1.EpisodeCreatorCredit) {
	t.Helper()

	listed, err := env.seriesClient().ListEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.ListEpisodeCreditsRequest{
		Tenant:          fixture.tenant.tenantContext(),
		EpisodePublicId: episodePublicID,
	}))
	if err != nil {
		t.Fatalf("ListEpisodeCredits: %v", err)
	}
	credits := make([]*publiraadminv1.EpisodeCreatorCredit, 0, len(listed.Msg.Creators)+1)
	for _, creator := range listed.Msg.Creators {
		credits = append(credits, &publiraadminv1.EpisodeCreatorCredit{
			CreatorPublicId: creator.PublicId,
			RolePublicId:    creator.GetRole().GetPublicId(),
		})
	}
	credits = append(credits, guest)
	if _, err := env.seriesClient().ReplaceEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:          fixture.tenant.tenantContext(),
		EpisodePublicId: episodePublicID,
		CreatorCredits:  credits,
	})); err != nil {
		t.Fatalf("ReplaceEpisodeCredits to add the guest: %v", err)
	}
}

// unchangedReasons reads the response's skip list as episode → reason, which is
// what a test about what the operation passed over compares.
func unchangedReasons(unchanged []*publiraadminv1.UnchangedEpisodeCredit) map[string]publiraadminv1.EpisodeCreditUnchangedReason {
	reasons := make(map[string]publiraadminv1.EpisodeCreditUnchangedReason, len(unchanged))
	for _, episode := range unchanged {
		reasons[episode.EpisodePublicId] = episode.Reason
	}
	return reasons
}

// The team change the whole feature is for: the artist is replaced across
// eleven episodes, and the episode that also credits a guest is changed like
// every other one while the guest stays where they were credited.
func TestDBBulkEditEpisodeCreditsReplacesTheArtistAcrossTheRange(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := seedSeriesRun(t, env, map[string]string{
		creatorroles.Defaults[0].Name: "Aoi Sakura",
		creatorroles.Defaults[1].Name: "Ren Takahashi",
	}, 11)
	fixture.seedCreator(t, env, "Kaoru Ito")
	fixture.seedCreator(t, env, "Hana Kubo")
	creditEpisodeWithAGuest(t, env, fixture, fixture.episodes[6], fixture.credit(t, "Kaoru Ito", creatorroles.Defaults[3].Name))

	edited, err := env.seriesClient().BulkEditEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:           fixture.tenant.tenantContext(),
		SeriesPublicId:   fixture.series.PublicID,
		EpisodePublicIds: fixture.episodes,
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Replace{
			Replace: &publiraadminv1.ReplaceEpisodeCreditOperation{
				From: fixture.credit(t, "Ren Takahashi", creatorroles.Defaults[1].Name),
				To:   fixture.credit(t, "Hana Kubo", creatorroles.Defaults[1].Name),
			},
		},
	}))
	if err != nil {
		t.Fatalf("BulkEditEpisodeCredits: %v", err)
	}
	if !slices.Equal(edited.Msg.ChangedEpisodePublicIds, fixture.episodes) {
		t.Fatalf("changed = %v, want all eleven episodes in the order they were listed, %v", edited.Msg.ChangedEpisodePublicIds, fixture.episodes)
	}
	if len(edited.Msg.UnchangedEpisodes) != 0 {
		t.Fatalf("unchanged = %v, want none", unchangedReasons(edited.Msg.UnchangedEpisodes))
	}

	listed, err := env.seriesClient().ListEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.ListEpisodeCreditsRequest{
		Tenant:          fixture.tenant.tenantContext(),
		EpisodePublicId: fixture.episodes[6],
	}))
	if err != nil {
		t.Fatalf("ListEpisodeCredits of the guest episode: %v", err)
	}
	want := []string{
		"Aoi Sakura / " + creatorroles.Defaults[0].Name,
		"Hana Kubo / " + creatorroles.Defaults[1].Name,
		"Kaoru Ito / " + creatorroles.Defaults[3].Name,
	}
	if got := creditedNames(listed.Msg.Creators); !slices.Equal(got, want) {
		t.Fatalf("credits of the guest episode = %v, want the new artist with the guest still there, %v", got, want)
	}
	if sources := creditSources(t, env, fixture.episodes[6]); sources["Kaoru Ito"] != "episode" {
		t.Fatalf("the guest credit has source %q, want episode", sources["Kaoru Ito"])
	}
}

// Episodes the credit never reached come back as skips with a reason, so an
// editor sees that a removal covered fewer episodes than the range they picked.
func TestDBBulkEditEpisodeCreditsReportsTheEpisodesThatNeverHadTheCredit(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := seedSeriesRun(t, env, map[string]string{
		creatorroles.Defaults[0].Name: "Aoi Sakura",
		creatorroles.Defaults[2].Name: "Yuki Mori",
	}, 3)

	// The writer leaves the series, so the two episodes created afterwards are
	// never credited to them.
	if _, err := env.seriesClient().UpdateSeries(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:   fixture.tenant.tenantContext(),
		PublicId: fixture.series.PublicID,
		Title:    "Long Running Series",
		CreatorCredits: []*publiraadminv1.SeriesCreatorCredit{{
			CreatorPublicId: fixture.creators["Aoi Sakura"].PublicID,
			RolePublicId:    fixture.roles[creatorroles.Defaults[0].Name].PublicID,
		}},
	})); err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	later := seedMoreEpisodes(t, env, fixture, 2)

	edited, err := env.seriesClient().BulkEditEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:           fixture.tenant.tenantContext(),
		SeriesPublicId:   fixture.series.PublicID,
		EpisodePublicIds: append(slices.Clone(fixture.episodes), later...),
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Remove{
			Remove: &publiraadminv1.RemoveEpisodeCreditOperation{
				Credit: fixture.credit(t, "Yuki Mori", creatorroles.Defaults[2].Name),
			},
		},
	}))
	if err != nil {
		t.Fatalf("BulkEditEpisodeCredits: %v", err)
	}
	if !slices.Equal(edited.Msg.ChangedEpisodePublicIds, fixture.episodes) {
		t.Fatalf("changed = %v, want the three episodes the writer was credited on, %v", edited.Msg.ChangedEpisodePublicIds, fixture.episodes)
	}
	reasons := unchangedReasons(edited.Msg.UnchangedEpisodes)
	if len(reasons) != len(later) {
		t.Fatalf("unchanged = %v, want exactly the two episodes created after the writer left", reasons)
	}
	for _, episodePublicID := range later {
		if reasons[episodePublicID] != publiraadminv1.EpisodeCreditUnchangedReason_EPISODE_CREDIT_UNCHANGED_REASON_NOT_CREDITED {
			t.Fatalf("episode %q reported %v, want not_credited", episodePublicID, reasons[episodePublicID])
		}
	}
}

// A credit written on the episode itself is a deliberate deviation, so a range
// edit passes over it and says which of the two kinds of skip it was.
func TestDBBulkEditEpisodeCreditsLeavesACreditWrittenOnTheEpisode(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := seedSeriesRun(t, env, map[string]string{
		creatorroles.Defaults[0].Name: "Aoi Sakura",
	}, 3)
	fixture.seedCreator(t, env, "Kaoru Ito")
	guest := fixture.credit(t, "Kaoru Ito", creatorroles.Defaults[3].Name)
	creditEpisodeWithAGuest(t, env, fixture, fixture.episodes[1], guest)

	edited, err := env.seriesClient().BulkEditEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:           fixture.tenant.tenantContext(),
		SeriesPublicId:   fixture.series.PublicID,
		EpisodePublicIds: fixture.episodes,
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Remove{
			Remove: &publiraadminv1.RemoveEpisodeCreditOperation{Credit: guest},
		},
	}))
	if err != nil {
		t.Fatalf("BulkEditEpisodeCredits: %v", err)
	}
	if len(edited.Msg.ChangedEpisodePublicIds) != 0 {
		t.Fatalf("changed = %v, want none: the only matching credit is the episode's own", edited.Msg.ChangedEpisodePublicIds)
	}
	reasons := unchangedReasons(edited.Msg.UnchangedEpisodes)
	if reasons[fixture.episodes[1]] != publiraadminv1.EpisodeCreditUnchangedReason_EPISODE_CREDIT_UNCHANGED_REASON_CREDITED_ON_THE_EPISODE {
		t.Fatalf("the guest episode reported %v, want credited_on_the_episode", reasons[fixture.episodes[1]])
	}
	if reasons[fixture.episodes[0]] != publiraadminv1.EpisodeCreditUnchangedReason_EPISODE_CREDIT_UNCHANGED_REASON_NOT_CREDITED {
		t.Fatalf("an episode that never credited the guest reported %v, want not_credited", reasons[fixture.episodes[0]])
	}

	listed, err := env.seriesClient().ListEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.ListEpisodeCreditsRequest{
		Tenant:          fixture.tenant.tenantContext(),
		EpisodePublicId: fixture.episodes[1],
	}))
	if err != nil {
		t.Fatalf("ListEpisodeCredits: %v", err)
	}
	want := []string{
		"Aoi Sakura / " + creatorroles.Defaults[0].Name,
		"Kaoru Ito / " + creatorroles.Defaults[3].Name,
	}
	if got := creditedNames(listed.Msg.Creators); !slices.Equal(got, want) {
		t.Fatalf("credits of the guest episode = %v, want the guest still credited, %v", got, want)
	}
}

// A writer left off the series when it was created is added to every episode of
// the range, and an episode that already credits them is a skip rather than a
// duplicate.
func TestDBBulkEditEpisodeCreditsAddsTheCreditWhereItIsMissing(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := seedSeriesRun(t, env, map[string]string{
		creatorroles.Defaults[0].Name: "Aoi Sakura",
	}, 3)
	fixture.seedCreator(t, env, "Yuki Mori")
	forgotten := fixture.credit(t, "Yuki Mori", creatorroles.Defaults[2].Name)
	creditEpisodeWithAGuest(t, env, fixture, fixture.episodes[0], forgotten)

	edited, err := env.seriesClient().BulkEditEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:           fixture.tenant.tenantContext(),
		SeriesPublicId:   fixture.series.PublicID,
		EpisodePublicIds: fixture.episodes,
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Add{
			Add: &publiraadminv1.AddEpisodeCreditOperation{Credit: forgotten},
		},
	}))
	if err != nil {
		t.Fatalf("BulkEditEpisodeCredits: %v", err)
	}
	if want := fixture.episodes[1:]; !slices.Equal(edited.Msg.ChangedEpisodePublicIds, want) {
		t.Fatalf("changed = %v, want the two episodes that did not credit the writer, %v", edited.Msg.ChangedEpisodePublicIds, want)
	}
	reasons := unchangedReasons(edited.Msg.UnchangedEpisodes)
	if reasons[fixture.episodes[0]] != publiraadminv1.EpisodeCreditUnchangedReason_EPISODE_CREDIT_UNCHANGED_REASON_ALREADY_CREDITED {
		t.Fatalf("the episode that already credited the writer reported %v, want already_credited", reasons[fixture.episodes[0]])
	}

	listed, err := env.seriesClient().ListEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.ListEpisodeCreditsRequest{
		Tenant:          fixture.tenant.tenantContext(),
		EpisodePublicId: fixture.episodes[2],
	}))
	if err != nil {
		t.Fatalf("ListEpisodeCredits: %v", err)
	}
	want := []string{
		"Aoi Sakura / " + creatorroles.Defaults[0].Name,
		"Yuki Mori / " + creatorroles.Defaults[2].Name,
	}
	if got := creditedNames(listed.Msg.Creators); !slices.Equal(got, want) {
		t.Fatalf("credits after the add = %v, want %v", got, want)
	}
	// The added row is the series' own, so a later range edit can move it
	// again — which is the whole reason a range edit writes that provenance.
	if sources := creditSources(t, env, fixture.episodes[2]); sources["Yuki Mori"] != "series" {
		t.Fatalf("the added credit has source %q, want series", sources["Yuki Mori"])
	}
}

// A replace whose destination is already credited on an episode of the range is
// refused before anything is written, rather than reaching the unique
// constraint with an error naming neither the episode nor the remedy.
func TestDBBulkEditEpisodeCreditsRefusesAReplaceThatWouldCreditTwice(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := seedSeriesRun(t, env, map[string]string{
		creatorroles.Defaults[0].Name: "Aoi Sakura",
		creatorroles.Defaults[1].Name: "Ren Takahashi",
	}, 3)

	_, err := env.seriesClient().BulkEditEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:           fixture.tenant.tenantContext(),
		SeriesPublicId:   fixture.series.PublicID,
		EpisodePublicIds: fixture.episodes,
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Replace{
			Replace: &publiraadminv1.ReplaceEpisodeCreditOperation{
				From: fixture.credit(t, "Ren Takahashi", creatorroles.Defaults[1].Name),
				To:   fixture.credit(t, "Aoi Sakura", creatorroles.Defaults[0].Name),
			},
		},
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("BulkEditEpisodeCredits: err = %v, want failed_precondition", err)
	}

	listed, listErr := env.seriesClient().ListEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.ListEpisodeCreditsRequest{
		Tenant:          fixture.tenant.tenantContext(),
		EpisodePublicId: fixture.episodes[0],
	}))
	if listErr != nil {
		t.Fatalf("ListEpisodeCredits: %v", listErr)
	}
	want := []string{
		"Aoi Sakura / " + creatorroles.Defaults[0].Name,
		"Ren Takahashi / " + creatorroles.Defaults[1].Name,
	}
	if got := creditedNames(listed.Msg.Creators); !slices.Equal(got, want) {
		t.Fatalf("credits after the refusal = %v, want them untouched, %v", got, want)
	}
}

// The range names episodes of one series. An episode of another series is a
// range the console could not have composed, so the whole request is refused
// rather than partly applied.
func TestDBBulkEditEpisodeCreditsRefusesAnEpisodeOfAnotherSeries(t *testing.T) {
	env := newAdminDBEnv(t)
	fixture := seedSeriesRun(t, env, map[string]string{
		creatorroles.Defaults[0].Name: "Aoi Sakura",
	}, 2)
	other := env.PG.SeedSeries(t, fixture.tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESB00001", Title: "Another Series"})
	elsewhere, err := env.seriesClient().CreateEpisode(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         fixture.tenant.tenantContext(),
		SeriesPublicId: other.PublicID,
		Title:          "Chapter One",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode on the other series: %v", err)
	}

	_, err = env.seriesClient().BulkEditEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.BulkEditEpisodeCreditsRequest{
		Tenant:           fixture.tenant.tenantContext(),
		SeriesPublicId:   fixture.series.PublicID,
		EpisodePublicIds: append(slices.Clone(fixture.episodes), elsewhere.Msg.Episode.PublicId),
		Operation: &publiraadminv1.BulkEditEpisodeCreditsRequest_Remove{
			Remove: &publiraadminv1.RemoveEpisodeCreditOperation{
				Credit: fixture.credit(t, "Aoi Sakura", creatorroles.Defaults[0].Name),
			},
		},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("BulkEditEpisodeCredits: err = %v, want invalid_argument", err)
	}

	listed, listErr := env.seriesClient().ListEpisodeCredits(context.Background(), newAdminDBRequest(fixture.tenant, &publiraadminv1.ListEpisodeCreditsRequest{
		Tenant:          fixture.tenant.tenantContext(),
		EpisodePublicId: fixture.episodes[0],
	}))
	if listErr != nil {
		t.Fatalf("ListEpisodeCredits: %v", listErr)
	}
	if got := creditedNames(listed.Msg.Creators); len(got) != 1 {
		t.Fatalf("credits after the refusal = %v, want the one the episode was baked with", got)
	}
}
