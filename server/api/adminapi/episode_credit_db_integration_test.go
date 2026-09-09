package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/creatorroles"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// creditedNames names who each credit is on and in what role, which is what a
// test about the set of credits compares.
func creditedNames(creators []*publirattypesv1.Creator) []string {
	names := make([]string, 0, len(creators))
	for _, creator := range creators {
		names = append(names, creator.Name+" / "+creator.GetRole().GetName())
	}
	return names
}

// creditSources reads the stored source of every credit on the episode, so a
// test can tell a row baked from the series from one an editor added here.
func creditSources(t *testing.T, env *adminDBEnv, episodePublicID string) map[string]string {
	t.Helper()

	rows, err := env.PG.DB.QueryContext(context.Background(), `
		SELECT c.name, ec.source
		FROM episode_creators ec
			JOIN creators c ON c.id = ec.creator_id
			JOIN episodes e ON e.id = ec.episode_id
		WHERE e.public_id = $1
	`, episodePublicID)
	if err != nil {
		t.Fatalf("read episode credit sources: %v", err)
	}
	defer rows.Close() //nolint:errcheck

	sources := make(map[string]string)
	for rows.Next() {
		var name, source string
		if err := rows.Scan(&name, &source); err != nil {
			t.Fatalf("scan episode credit source: %v", err)
		}
		sources[name] = source
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read episode credit sources: %v", err)
	}
	return sources
}

// seedCreditedSeries returns a tenant, a series credited to three people, one
// per role, and those three in the order they were credited. That shape is
// what the bake has to copy.
func seedCreditedSeries(t *testing.T, env *adminDBEnv) (adminDBTenant, testutil.Series, []testutil.Creator) {
	t.Helper()

	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Long Running Series"})
	creators := make([]testutil.Creator, 0, 3)
	for index, name := range []string{"Aoi Sakura", "Ren Takahashi", "Yuki Mori"} {
		creator := env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{Name: name})
		env.PG.SeedSeriesCreator(t, tenant.Tenant.ID, series.ID, creator.ID, creatorroles.Defaults[index].Name)
		creators = append(creators, creator)
	}
	return tenant, series, creators
}

// A new episode is credited to the team its series carries at that moment, and
// every one of those rows says it came from the series.
func TestDBCreateEpisodeBakesTheSeriesCredits(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant, series, _ := seedCreditedSeries(t, env)

	created, err := env.seriesClient().CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: series.PublicID,
		Title:          "Chapter One",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}

	listed, err := env.seriesClient().ListEpisodeCredits(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListEpisodeCreditsRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: created.Msg.Episode.PublicId,
	}))
	if err != nil {
		t.Fatalf("ListEpisodeCredits: %v", err)
	}
	want := []string{
		"Aoi Sakura / " + creatorroles.Defaults[0].Name,
		"Ren Takahashi / " + creatorroles.Defaults[1].Name,
		"Yuki Mori / " + creatorroles.Defaults[2].Name,
	}
	if got := creditedNames(listed.Msg.Creators); !slices.Equal(got, want) {
		t.Fatalf("baked credits = %v, want %v", got, want)
	}
	for name, source := range creditSources(t, env, created.Msg.Episode.PublicId) {
		if source != "series" {
			t.Fatalf("credit of %q has source %q, want series", name, source)
		}
	}
}

// The bake freezes: editing the series afterwards changes what the next
// episode is created with and leaves the ones already out alone.
func TestDBEditingTheSeriesLeavesAnAlreadyCreatedEpisodeCredited(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant, series, _ := seedCreditedSeries(t, env)

	created, err := env.seriesClient().CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: series.PublicID,
		Title:          "Chapter One",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}

	// The artist changes: the series is re-credited to one person alone.
	successor := env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{Name: "Hana Kubo"})
	_, err = env.seriesClient().UpdateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		PublicId:       series.PublicID,
		Title:          "Long Running Series",
		CreatorCredits: env.creatorCredits(t, tenant, successor.PublicID),
	}))
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}

	listed, err := env.seriesClient().ListEpisodeCredits(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListEpisodeCreditsRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: created.Msg.Episode.PublicId,
	}))
	if err != nil {
		t.Fatalf("ListEpisodeCredits: %v", err)
	}
	shipped := []string{
		"Aoi Sakura / " + creatorroles.Defaults[0].Name,
		"Ren Takahashi / " + creatorroles.Defaults[1].Name,
		"Yuki Mori / " + creatorroles.Defaults[2].Name,
	}
	if got := creditedNames(listed.Msg.Creators); !slices.Equal(got, shipped) {
		t.Fatalf("credits of the episode published before the change = %v, want the three it shipped with, %v", got, shipped)
	}

	next, err := env.seriesClient().CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: series.PublicID,
		Title:          "Chapter Two",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode after the change: %v", err)
	}
	afterwards, err := env.seriesClient().ListEpisodeCredits(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListEpisodeCreditsRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: next.Msg.Episode.PublicId,
	}))
	if err != nil {
		t.Fatalf("ListEpisodeCredits after the change: %v", err)
	}
	want := []string{"Hana Kubo / " + creatorroles.Defaults[0].Name}
	if got := creditedNames(afterwards.Msg.Creators); !slices.Equal(got, want) {
		t.Fatalf("credits of the episode created after the change = %v, want %v", got, want)
	}
}

// A guest on one episode is a row on that episode. The baked rows the request
// keeps stay baked, so a later range edit can still tell the standing team
// from the guest.
func TestDBReplaceEpisodeCreditsKeepsTheBakedRowsAndAddsTheGuest(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant, series, _ := seedCreditedSeries(t, env)

	created, err := env.seriesClient().CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: series.PublicID,
		Title:          "Chapter One",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}
	listed, err := env.seriesClient().ListEpisodeCredits(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListEpisodeCreditsRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: created.Msg.Episode.PublicId,
	}))
	if err != nil {
		t.Fatalf("ListEpisodeCredits: %v", err)
	}

	supervisor := env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{Name: "Kaoru Ito"})
	supervisorRole := env.PG.CreatorRoleByName(t, tenant.Tenant.ID, creatorroles.Defaults[3].Name)
	credits := make([]*publiraadminv1.EpisodeCreatorCredit, 0, len(listed.Msg.Creators)+1)
	for _, creator := range listed.Msg.Creators {
		credits = append(credits, &publiraadminv1.EpisodeCreatorCredit{
			CreatorPublicId: creator.PublicId,
			RolePublicId:    creator.GetRole().GetPublicId(),
		})
	}
	credits = append(credits, &publiraadminv1.EpisodeCreatorCredit{
		CreatorPublicId: supervisor.PublicID,
		RolePublicId:    supervisorRole.PublicID,
	})

	replaced, err := env.seriesClient().ReplaceEpisodeCredits(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: created.Msg.Episode.PublicId,
		CreatorCredits:  credits,
	}))
	if err != nil {
		t.Fatalf("ReplaceEpisodeCredits: %v", err)
	}
	want := []string{
		"Aoi Sakura / " + creatorroles.Defaults[0].Name,
		"Ren Takahashi / " + creatorroles.Defaults[1].Name,
		"Yuki Mori / " + creatorroles.Defaults[2].Name,
		"Kaoru Ito / " + creatorroles.Defaults[3].Name,
	}
	if got := creditedNames(replaced.Msg.Creators); !slices.Equal(got, want) {
		t.Fatalf("credits after the replace = %v, want %v", got, want)
	}

	sources := creditSources(t, env, created.Msg.Episode.PublicId)
	for _, name := range []string{"Aoi Sakura", "Ren Takahashi", "Yuki Mori"} {
		if sources[name] != "series" {
			t.Fatalf("credit of %q has source %q, want the baked row to stay baked", name, sources[name])
		}
	}
	if sources["Kaoru Ito"] != "episode" {
		t.Fatalf("credit of the guest has source %q, want episode", sources["Kaoru Ito"])
	}
}

// An empty list is a list: the episode ends up credited to nobody rather than
// keeping what it had.
func TestDBReplaceEpisodeCreditsWithAnEmptyListClearsThem(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant, series, _ := seedCreditedSeries(t, env)

	created, err := env.seriesClient().CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: series.PublicID,
		Title:          "Chapter One",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}

	replaced, err := env.seriesClient().ReplaceEpisodeCredits(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:          tenant.tenantContext(),
		EpisodePublicId: created.Msg.Episode.PublicId,
	}))
	if err != nil {
		t.Fatalf("ReplaceEpisodeCredits: %v", err)
	}
	if got := creditedNames(replaced.Msg.Creators); len(got) != 0 {
		t.Fatalf("credits after clearing = %v, want none", got)
	}
}

// The episode of another tenant is an episode this tenant does not have.
func TestDBReplaceEpisodeCreditsRefusesAnotherTenantsEpisode(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant, series, _ := seedCreditedSeries(t, env)
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")

	created, err := env.seriesClient().CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: series.PublicID,
		Title:          "Chapter One",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}

	_, err = env.seriesClient().ReplaceEpisodeCredits(context.Background(), newAdminDBRequest(other, &publiraadminv1.ReplaceEpisodeCreditsRequest{
		Tenant:          other.tenantContext(),
		EpisodePublicId: created.Msg.Episode.PublicId,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("ReplaceEpisodeCredits across tenants: err = %v, want not_found", err)
	}
}

// A role an episode still credits someone in cannot be deleted, even when no
// series names it any more: the episode's rows hold the role too.
func TestDBDeleteCreatorRoleRefusesARoleOnlyAnEpisodeStillNames(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant, series, creators := seedCreditedSeries(t, env)

	_, err := env.seriesClient().CreateEpisode(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateEpisodeRequest{
		Tenant:         tenant.tenantContext(),
		SeriesPublicId: series.PublicID,
		Title:          "Chapter One",
	}))
	if err != nil {
		t.Fatalf("CreateEpisode: %v", err)
	}

	// The series lets every role but the leading one go; the episode keeps all
	// three, because it was created before the change.
	_, err = env.seriesClient().UpdateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		PublicId:       series.PublicID,
		Title:          "Long Running Series",
		CreatorCredits: env.creatorCredits(t, tenant, creators[0].PublicID),
	}))
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}

	artistRole := env.PG.CreatorRoleByName(t, tenant.Tenant.ID, creatorroles.Defaults[1].Name)
	_, err = env.creatorRoleClient().DeleteCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteCreatorRoleRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: artistRole.PublicID,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeleteCreatorRole: err = %v, want failed_precondition because an episode still credits it", err)
	}
}
