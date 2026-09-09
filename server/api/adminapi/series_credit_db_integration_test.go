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

// A credit written before the tenant had roles keeps its row and states none.
// It is still shown — the name is the part that matters — and it comes after
// the credits that name a role.
func TestDBSeriesKeepsACreditThatStatesNoRole(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	series := env.PG.SeedSeries(t, tenant.Tenant.ID, testutil.SeriesSeed{PublicID: "SERIESA00001", Title: "Long Running Series"})
	unroled := env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0001", Name: "Credited Before Roles"})
	roled := env.PG.SeedCreator(t, tenant.Tenant.ID, testutil.CreatorSeed{PublicID: "CREATORA0002", Name: "Credited After Roles"})
	env.PG.SeedSeriesCreatorWithoutRole(t, tenant.Tenant.ID, series.ID, unroled.ID)
	env.PG.SeedSeriesCreator(t, tenant.Tenant.ID, series.ID, roled.ID, creatorroles.Defaults[0].Name)

	got, err := env.seriesClient().GetSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: series.PublicID,
	}))
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}

	credits := got.Msg.Series.Creators
	if len(credits) != 2 {
		t.Fatalf("credits = %d, want both the roled and the role-less one", len(credits))
	}
	if credits[0].PublicId != roled.PublicID {
		t.Fatalf("credits[0].public_id = %q, want the roled credit %q first", credits[0].PublicId, roled.PublicID)
	}
	if credits[0].GetRole().GetName() != creatorroles.Defaults[0].Name {
		t.Fatalf("credits[0].role = %q, want %q", credits[0].GetRole().GetName(), creatorroles.Defaults[0].Name)
	}
	if credits[1].PublicId != unroled.PublicID {
		t.Fatalf("credits[1].public_id = %q, want the role-less credit %q last", credits[1].PublicId, unroled.PublicID)
	}
	if credits[1].Role != nil {
		t.Fatalf("credits[1].role = %v, want no role rather than an empty one", credits[1].Role)
	}
}

// creatorCreditRoleNames names the role each credit is held in, in the order
// the series presents them.
func creatorCreditRoleNames(creators []*publirattypesv1.Creator) []string {
	names := make([]string, 0, len(creators))
	for _, creator := range creators {
		names = append(names, creator.GetRole().GetName())
	}
	return names
}

// One person can be both the original author and the artist, which is two
// credits rather than one row that has to choose. They read back in role
// priority order however the save listed them.
func TestDBSeriesCreditsOnePersonInTwoRoles(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	creator, err := env.creatorClient().CreateCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Aoi Sakura",
	}))
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}
	author := env.PG.CreatorRoleByName(t, tenant.Tenant.ID, creatorroles.Defaults[0].Name)
	artist := env.PG.CreatorRoleByName(t, tenant.Tenant.ID, creatorroles.Defaults[1].Name)

	created, err := env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant: tenant.tenantContext(),
		Title:  "Written And Drawn",
		// Listed against the priority order, so what puts the leading role
		// first is the role rather than the order of the save.
		CreatorCredits: []*publiraadminv1.SeriesCreatorCredit{
			{CreatorPublicId: creator.Msg.Creator.PublicId, RolePublicId: artist.PublicID},
			{CreatorPublicId: creator.Msg.Creator.PublicId, RolePublicId: author.PublicID},
		},
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	want := []string{author.Name, artist.Name}
	if got := creatorCreditRoleNames(created.Msg.Series.Creators); !slices.Equal(got, want) {
		t.Fatalf("credit roles = %v, want %v", got, want)
	}

	reloaded, err := env.seriesClient().GetSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: created.Msg.Series.PublicId,
	}))
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if got := creatorCreditRoleNames(reloaded.Msg.Series.Creators); !slices.Equal(got, want) {
		t.Fatalf("reloaded credit roles = %v, want %v", got, want)
	}
}

func TestDBCreateSeriesRefusesTheSameCreatorTwiceInOneRole(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	creator, err := env.creatorClient().CreateCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Aoi Sakura",
	}))
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}
	role := env.PG.CreatorRoleByName(t, tenant.Tenant.ID, creatorroles.Defaults[0].Name)

	_, err = env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant: tenant.tenantContext(),
		Title:  "Doubly Credited",
		CreatorCredits: []*publiraadminv1.SeriesCreatorCredit{
			{CreatorPublicId: creator.Msg.Creator.PublicId, RolePublicId: role.PublicID},
			{CreatorPublicId: creator.Msg.Creator.PublicId, RolePublicId: role.PublicID},
		},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeInvalidArgument, err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("series rows = %d, want 0 after a rejected create", count)
	}
}

// A role of another tenant is a role that does not exist, the way a creator of
// another tenant is.
func TestDBCreateSeriesRefusesACreatorRoleOfAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)

	creator, err := env.creatorClient().CreateCreator(context.Background(), newAdminDBRequest(first, &publiraadminv1.CreateCreatorRequest{
		Tenant: first.tenantContext(),
		Name:   "Aoi Sakura",
	}))
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}
	theirRole := env.PG.CreatorRoleByName(t, second.Tenant.ID, creatorroles.Defaults[0].Name)

	_, err = env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(first, &publiraadminv1.CreateSeriesRequest{
		Tenant: first.tenantContext(),
		Title:  "Series Borrowing A Role",
		CreatorCredits: []*publiraadminv1.SeriesCreatorCredit{
			{CreatorPublicId: creator.Msg.Creator.PublicId, RolePublicId: theirRole.PublicID},
		},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want %v (err=%v)", connect.CodeOf(err), connect.CodeInvalidArgument, err)
	}
	if count := env.countRows(t, "SELECT count(*) FROM series_creators WHERE tenant_id = $1", first.Tenant.ID); count != 0 {
		t.Fatalf("series_creators rows = %d, want 0", count)
	}
}
