package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/creatorroles"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func creatorRolePublicIDs(roles []*publirattypesv1.CreatorRole) []string {
	publicIDs := make([]string, 0, len(roles))
	for _, role := range roles {
		publicIDs = append(publicIDs, role.PublicId)
	}
	return publicIDs
}

func creatorRoleNames(roles []*publirattypesv1.CreatorRole) []string {
	names := make([]string, 0, len(roles))
	for _, role := range roles {
		names = append(names, role.Name)
	}
	return names
}

// defaultCreatorRoleNames is the vocabulary a tenant is created with, as the
// list RPC hands it back.
func defaultCreatorRoleNames() []string {
	names := make([]string, 0, len(creatorroles.Defaults))
	for _, role := range creatorroles.Defaults {
		names = append(names, role.Name)
	}
	return names
}

func createCreatorRole(
	t *testing.T,
	client publiraadminv1connect.AdminCreatorRoleServiceClient,
	tenant adminDBTenant,
	name string,
) *publirattypesv1.CreatorRole {
	t.Helper()

	created, err := client.CreateCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateCreatorRoleRequest{
		Tenant: tenant.tenantContext(),
		Name:   name,
	}))
	if err != nil {
		t.Fatalf("CreateCreatorRole(%q): %v", name, err)
	}
	return created.Msg.CreatorRole
}

func listCreatorRoles(
	t *testing.T,
	client publiraadminv1connect.AdminCreatorRoleServiceClient,
	tenant adminDBTenant,
) []*publirattypesv1.CreatorRole {
	t.Helper()

	listed, err := client.ListCreatorRoles(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListCreatorRolesRequest{
		Tenant: tenant.tenantContext(),
		Limit:  100,
	}))
	if err != nil {
		t.Fatalf("ListCreatorRoles: %v", err)
	}
	return listed.Msg.CreatorRoles
}

// A tenant reaches its console with a vocabulary already in it, because a
// credit names a role and a series is credited from the day it is written.
func TestDBANewTenantStartsWithTheDefaultCreatorRoles(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	if got := creatorRoleNames(listCreatorRoles(t, env.creatorRoleClient(), tenant)); !slices.Equal(got, defaultCreatorRoleNames()) {
		t.Fatalf("creator roles = %v, want %v", got, defaultCreatorRoleNames())
	}
}

func TestDBCreateCreatorRoleAppendsToTheTenantOrder(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.creatorRoleClient()

	letterer := createCreatorRole(t, client, tenant, "Letterer")

	want := append(defaultCreatorRoleNames(), letterer.Name)
	if got := creatorRoleNames(listCreatorRoles(t, client, tenant)); !slices.Equal(got, want) {
		t.Fatalf("creator roles = %v, want the new one last at %v", got, want)
	}
}

// Two roles that differ only in case are one choice offered twice, so the
// second spelling is refused.
func TestDBCreateCreatorRoleRefusesANameAnotherRoleAlreadyHolds(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.creatorRoleClient()

	_, err := client.CreateCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateCreatorRoleRequest{
		Tenant: tenant.tenantContext(),
		Name:   "  original author ",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateCreatorRole code = %v, want %v", connect.CodeOf(err), connect.CodeAlreadyExists)
	}
}

func TestDBUpdateCreatorRoleRenamesWithoutMovingItsPublicID(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.creatorRoleClient()

	role := env.PG.CreatorRoleByName(t, tenant.Tenant.ID, creatorroles.Defaults[0].Name)
	updated, err := client.UpdateCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateCreatorRoleRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: role.PublicID,
		Name:     "Story",
	}))
	if err != nil {
		t.Fatalf("UpdateCreatorRole: %v", err)
	}
	if updated.Msg.CreatorRole.PublicId != role.PublicID {
		t.Fatalf("creator_role.public_id = %q, want it unchanged at %q", updated.Msg.CreatorRole.PublicId, role.PublicID)
	}
	if got := creatorRoleNames(listCreatorRoles(t, client, tenant))[0]; got != "Story" {
		t.Fatalf("leading role name = %q, want the renamed one", got)
	}
}

func TestDBReorderCreatorRolesWritesTheRequestedOrder(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.creatorRoleClient()

	current := creatorRolePublicIDs(listCreatorRoles(t, client, tenant))
	wanted := []string{current[3], current[0], current[1], current[2]}

	reordered, err := client.ReorderCreatorRoles(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderCreatorRolesRequest{
		Tenant:                       tenant.tenantContext(),
		CreatorRolePublicIds:         wanted,
		ExpectedCreatorRolePublicIds: current,
	}))
	if err != nil {
		t.Fatalf("ReorderCreatorRoles: %v", err)
	}
	if got := creatorRolePublicIDs(reordered.Msg.CreatorRoles); !slices.Equal(got, wanted) {
		t.Fatalf("ReorderCreatorRoles = %v, want %v", got, wanted)
	}
	if got := creatorRolePublicIDs(listCreatorRoles(t, client, tenant)); !slices.Equal(got, wanted) {
		t.Fatalf("creator role order = %v, want %v", got, wanted)
	}
}

func TestDBReorderCreatorRolesRefusesAnOrderBuiltOnAStaleList(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.creatorRoleClient()

	current := creatorRolePublicIDs(listCreatorRoles(t, client, tenant))
	// A role created after the client read the list: the order it composed no
	// longer covers everything the tenant has.
	createCreatorRole(t, client, tenant, "Letterer")

	_, err := client.ReorderCreatorRoles(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderCreatorRolesRequest{
		Tenant:                       tenant.tenantContext(),
		CreatorRolePublicIds:         []string{current[1], current[0], current[2], current[3]},
		ExpectedCreatorRolePublicIds: current,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ReorderCreatorRoles code = %v, want %v", connect.CodeOf(err), connect.CodeFailedPrecondition)
	}
}

func TestDBDeleteCreatorRoleRemovesAnUnusedOne(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.creatorRoleClient()

	role := createCreatorRole(t, client, tenant, "Letterer")
	if _, err := client.DeleteCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteCreatorRoleRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: role.PublicId,
	})); err != nil {
		t.Fatalf("DeleteCreatorRole: %v", err)
	}
	if got := creatorRoleNames(listCreatorRoles(t, client, tenant)); !slices.Equal(got, defaultCreatorRoleNames()) {
		t.Fatalf("creator roles after delete = %v, want %v", got, defaultCreatorRoleNames())
	}
}

func TestDBDeleteCreatorRoleRefusesOneACreditNames(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	roles := env.creatorRoleClient()

	creator, err := env.creatorClient().CreateCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Aoi Sakura",
	}))
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}
	credits := env.creatorCredits(t, tenant, creator.Msg.Creator.PublicId)
	if _, err := env.seriesClient().CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		Title:          "Credited Series",
		CreatorCredits: credits,
	})); err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}

	_, err = roles.DeleteCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteCreatorRoleRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: credits[0].RolePublicId,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeleteCreatorRole code = %v, want %v", connect.CodeOf(err), connect.CodeFailedPrecondition)
	}
	if got := creatorRoleNames(listCreatorRoles(t, roles, tenant)); !slices.Equal(got, defaultCreatorRoleNames()) {
		t.Fatalf("creator roles after the refused delete = %v, want the role kept", got)
	}
}

func TestDBCreatorRolesOfAnotherTenantAreOutOfReach(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.creatorRoleClient()

	theirs := env.PG.CreatorRoleByName(t, second.Tenant.ID, creatorroles.Defaults[0].Name)
	mine := env.PG.CreatorRoleByName(t, first.Tenant.ID, creatorroles.Defaults[0].Name)
	if theirs.PublicID == mine.PublicID {
		t.Fatal("two tenants share one role row")
	}

	if got := creatorRolePublicIDs(listCreatorRoles(t, client, first)); slices.Contains(got, theirs.PublicID) {
		t.Fatalf("creator roles of tenant A = %v, want none of tenant B's", got)
	}
	_, err := client.UpdateCreatorRole(context.Background(), newAdminDBRequest(first, &publiraadminv1.UpdateCreatorRoleRequest{
		Tenant:   first.tenantContext(),
		PublicId: theirs.PublicID,
		Name:     "Renamed",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateCreatorRole code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}
}

func TestDBCreatorRoleChangesAreAudited(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.creatorRoleClient()

	role := createCreatorRole(t, client, tenant, "Letterer")
	if _, err := client.UpdateCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateCreatorRoleRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: role.PublicId,
		Name:     "Lettering",
	})); err != nil {
		t.Fatalf("UpdateCreatorRole: %v", err)
	}
	if _, err := client.DeleteCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteCreatorRoleRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: role.PublicId,
	})); err != nil {
		t.Fatalf("DeleteCreatorRole: %v", err)
	}

	for _, action := range []string{"creator_role_created", "creator_role_updated", "creator_role_deleted"} {
		if count := env.countRows(t,
			"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND target_id = $3",
			tenant.Tenant.ID, action, role.PublicId,
		); count != 1 {
			t.Fatalf("audit entries for %s = %d, want 1", action, count)
		}
	}
}
