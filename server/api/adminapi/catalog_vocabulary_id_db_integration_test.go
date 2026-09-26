package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func creatorRoleIDs(roles []*publirattypesv1.CreatorRole) []string {
	ids := make([]string, 0, len(roles))
	for _, role := range roles {
		ids = append(ids, role.Id)
	}
	return ids
}

func genreIDs(genres []*publirattypesv1.Genre) []string {
	ids := make([]string, 0, len(genres))
	for _, genre := range genres {
		ids = append(ids, genre.Id)
	}
	return ids
}

// requireID fails the test unless value is a primary key, so a response that
// forgot to carry the ID fails where it is read rather than as a not-found
// on the request that sends it back.
func requireID(t *testing.T, what, value string) {
	t.Helper()

	if _, err := uuid.Parse(value); err != nil {
		t.Fatalf("%s.id = %q, want a primary key", what, value)
	}
}

func TestDBCreatorRolesAreAddressedByID(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.creatorRoleClient()

	letterer := createCreatorRole(t, client, tenant, "Letterer")
	requireID(t, "created creator_role", letterer.Id)

	updated, err := client.UpdateCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateCreatorRoleRequest{
		Tenant:        tenant.tenantContext(),
		CreatorRoleId: letterer.Id,
		Name:          "Lettering",
	}))
	if err != nil {
		t.Fatalf("UpdateCreatorRole: %v", err)
	}
	if updated.Msg.CreatorRole.Id != letterer.Id || updated.Msg.CreatorRole.Name != "Lettering" {
		t.Fatalf("updated creator_role = %+v, want %s renamed to Lettering", updated.Msg.CreatorRole, letterer.Id)
	}

	current := creatorRoleIDs(listCreatorRoles(t, client, tenant))
	for _, id := range current {
		requireID(t, "listed creator_role", id)
	}
	wanted := slices.Clone(current)
	slices.Reverse(wanted)
	reordered, err := client.ReorderCreatorRoles(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderCreatorRolesRequest{
		Tenant:                 tenant.tenantContext(),
		CreatorRoleIds:         wanted,
		ExpectedCreatorRoleIds: current,
	}))
	if err != nil {
		t.Fatalf("ReorderCreatorRoles: %v", err)
	}
	if got := creatorRoleIDs(reordered.Msg.CreatorRoles); !slices.Equal(got, wanted) {
		t.Fatalf("ReorderCreatorRoles = %v, want %v", got, wanted)
	}
	if got := creatorRoleIDs(listCreatorRoles(t, client, tenant)); !slices.Equal(got, wanted) {
		t.Fatalf("creator role order = %v, want %v", got, wanted)
	}

	if _, err := client.DeleteCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteCreatorRoleRequest{
		Tenant:        tenant.tenantContext(),
		CreatorRoleId: letterer.Id,
	})); err != nil {
		t.Fatalf("DeleteCreatorRole: %v", err)
	}
	if got := creatorRoleIDs(listCreatorRoles(t, client, tenant)); slices.Contains(got, letterer.Id) {
		t.Fatalf("creator roles after delete = %v, want %s gone", got, letterer.Id)
	}
}

// A reorder by ID compares the stale list the client read the same way the
// public ID lists are compared.
func TestDBReorderCreatorRolesByIDRefusesAnOrderBuiltOnAStaleList(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.creatorRoleClient()

	current := creatorRoleIDs(listCreatorRoles(t, client, tenant))
	createCreatorRole(t, client, tenant, "Letterer")

	_, err := client.ReorderCreatorRoles(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderCreatorRolesRequest{
		Tenant:                 tenant.tenantContext(),
		CreatorRoleIds:         []string{current[1], current[0], current[2], current[3]},
		ExpectedCreatorRoleIds: current,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ReorderCreatorRoles code = %v, want %v", connect.CodeOf(err), connect.CodeFailedPrecondition)
	}
}

func TestDBCreatorRoleIDThatIsNotAnIdentifierIsRefused(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := env.creatorRoleClient().DeleteCreatorRole(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteCreatorRoleRequest{
		Tenant:        tenant.tenantContext(),
		CreatorRoleId: "not-a-uuid",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("DeleteCreatorRole code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
}

// The tenant is part of the lookup by primary key too, so another tenant's
// genre reads as not found.
func TestDBGenresAreAddressedByID(t *testing.T) {
	env := newAdminDBEnv(t)
	tenantA := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	tenantB := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.genreClient()

	fantasy := createGenreWithEyeCatch(t, client, tenantA, "Fantasy")
	romance := createGenre(t, client, tenantA, "Romance")
	requireID(t, "created genre", fantasy.Id)

	updated, err := client.UpdateGenre(context.Background(), newAdminDBRequest(tenantA, &publiraadminv1.UpdateGenreRequest{
		Tenant:  tenantA.tenantContext(),
		GenreId: romance.Id,
		Name:    "Love Story",
	}))
	if err != nil {
		t.Fatalf("UpdateGenre: %v", err)
	}
	if updated.Msg.Genre.Id != romance.Id || updated.Msg.Genre.Name != "Love Story" {
		t.Fatalf("updated genre = %+v, want %s renamed to Love Story", updated.Msg.Genre, romance.Id)
	}

	uploaded, err := client.UploadGenreEyeCatchAspectImage(context.Background(), newAdminDBRequest(tenantA, &publiraadminv1.UploadGenreEyeCatchAspectImageRequest{
		Tenant:           tenantA.tenantContext(),
		GenreId:          fantasy.Id,
		VariantType:      "square",
		ImageData:        aspectJPEG(t, 1200, 1200),
		ImageContentType: "image/jpeg",
	}))
	if err != nil {
		t.Fatalf("UploadGenreEyeCatchAspectImage: %v", err)
	}
	if uploaded.Msg.Genre.Id != fantasy.Id {
		t.Fatalf("uploaded genre.id = %q, want %q", uploaded.Msg.Genre.Id, fantasy.Id)
	}

	reordered, err := client.ReorderGenres(context.Background(), newAdminDBRequest(tenantA, &publiraadminv1.ReorderGenresRequest{
		Tenant:           tenantA.tenantContext(),
		GenreIds:         []string{romance.Id, fantasy.Id},
		ExpectedGenreIds: []string{fantasy.Id, romance.Id},
	}))
	if err != nil {
		t.Fatalf("ReorderGenres: %v", err)
	}
	if got, want := genreIDs(reordered.Msg.Genres), []string{romance.Id, fantasy.Id}; !slices.Equal(got, want) {
		t.Fatalf("ReorderGenres = %v, want %v", got, want)
	}

	_, err = client.DeleteGenre(context.Background(), newAdminDBRequest(tenantB, &publiraadminv1.DeleteGenreRequest{
		Tenant:  tenantB.tenantContext(),
		GenreId: romance.Id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteGenre from another tenant code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}
	if _, err := client.DeleteGenre(context.Background(), newAdminDBRequest(tenantA, &publiraadminv1.DeleteGenreRequest{
		Tenant:  tenantA.tenantContext(),
		GenreId: romance.Id,
	})); err != nil {
		t.Fatalf("DeleteGenre: %v", err)
	}
	if got := genreIDs(listGenres(t, client, tenantA)); !slices.Equal(got, []string{fantasy.Id}) {
		t.Fatalf("genres after delete = %v, want only %s", got, fantasy.Id)
	}
}

func TestDBCreatorsAreAddressedByID(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	creators := env.creatorClient()

	created, err := creators.CreateCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Before Rename",
	}))
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}
	requireID(t, "created creator", created.Msg.Creator.Id)

	updated, err := creators.UpdateCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateCreatorRequest{
		Tenant:    tenant.tenantContext(),
		CreatorId: created.Msg.Creator.Id,
		Name:      "After Rename",
	}))
	if err != nil {
		t.Fatalf("UpdateCreator: %v", err)
	}
	if updated.Msg.Creator.Id != created.Msg.Creator.Id || updated.Msg.Creator.Name != "After Rename" {
		t.Fatalf("updated creator = %+v, want %s renamed", updated.Msg.Creator, created.Msg.Creator.Id)
	}

	// The detail page still resolves its route segment by public ID, and what
	// it reads back is the ID the edit form posts.
	fetched, err := creators.GetCreator(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetCreatorRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: created.Msg.Creator.PublicId,
	}))
	if err != nil {
		t.Fatalf("GetCreator: %v", err)
	}
	if fetched.Msg.Creator.Id != created.Msg.Creator.Id {
		t.Fatalf("GetCreator id = %q, want %q", fetched.Msg.Creator.Id, created.Msg.Creator.Id)
	}

	listed, err := creators.ListCreators(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListCreatorsRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	if len(listed.Msg.Creators) != 1 || listed.Msg.Creators[0].Id != created.Msg.Creator.Id {
		t.Fatalf("ListCreators = %+v, want the one creator with its id", listed.Msg.Creators)
	}
}

func TestDBLabelsAreAddressedByID(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	labels := env.labelClient()

	created, err := labels.CreateLabel(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateLabelRequest{
		Tenant:                   tenant.tenantContext(),
		Name:                     "Before Rename",
		EyeCatchImageData:        aspectJPEG(t, 2400, 3200),
		EyeCatchImageContentType: "image/jpeg",
	}))
	if err != nil {
		t.Fatalf("CreateLabel: %v", err)
	}
	requireID(t, "created label", created.Msg.Label.Id)

	updated, err := labels.UpdateLabel(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateLabelRequest{
		Tenant:  tenant.tenantContext(),
		LabelId: created.Msg.Label.Id,
		Name:    "After Rename",
	}))
	if err != nil {
		t.Fatalf("UpdateLabel: %v", err)
	}
	if updated.Msg.Label.Id != created.Msg.Label.Id || updated.Msg.Label.Name != "After Rename" {
		t.Fatalf("updated label = %+v, want %s renamed", updated.Msg.Label, created.Msg.Label.Id)
	}

	uploaded, err := labels.UploadLabelEyeCatchAspectImage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadLabelEyeCatchAspectImageRequest{
		Tenant:           tenant.tenantContext(),
		LabelId:          created.Msg.Label.Id,
		VariantType:      "square",
		ImageData:        aspectJPEG(t, 1200, 1200),
		ImageContentType: "image/jpeg",
	}))
	if err != nil {
		t.Fatalf("UploadLabelEyeCatchAspectImage: %v", err)
	}
	if uploaded.Msg.Label.Id != created.Msg.Label.Id {
		t.Fatalf("uploaded label.id = %q, want %q", uploaded.Msg.Label.Id, created.Msg.Label.Id)
	}

	listed, err := labels.ListLabels(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListLabelsRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListLabels: %v", err)
	}
	if len(listed.Msg.Labels) != 1 || listed.Msg.Labels[0].Id != created.Msg.Label.Id {
		t.Fatalf("ListLabels = %+v, want the one label with its id", listed.Msg.Labels)
	}
}
