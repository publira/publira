package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
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

	updated, err := client.UpdateCreatorRole(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCreatorRoleRequest{
		Tenant:        tenant.tenantContext(),
		CreatorRoleId: letterer.Id,
		Name:          "Lettering",
	})
	if err != nil {
		t.Fatalf("UpdateCreatorRole: %v", err)
	}
	if updated.CreatorRole.Id != letterer.Id || updated.CreatorRole.Name != "Lettering" {
		t.Fatalf("updated creator_role = %+v, want %s renamed to Lettering", updated.CreatorRole, letterer.Id)
	}

	current := creatorRoleIDs(listCreatorRoles(t, client, tenant))
	for _, id := range current {
		requireID(t, "listed creator_role", id)
	}
	wanted := slices.Clone(current)
	slices.Reverse(wanted)
	reordered, err := client.ReorderCreatorRoles(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ReorderCreatorRolesRequest{
		Tenant:                 tenant.tenantContext(),
		CreatorRoleIds:         wanted,
		ExpectedCreatorRoleIds: current,
	})
	if err != nil {
		t.Fatalf("ReorderCreatorRoles: %v", err)
	}
	if got := creatorRoleIDs(reordered.CreatorRoles); !slices.Equal(got, wanted) {
		t.Fatalf("ReorderCreatorRoles = %v, want %v", got, wanted)
	}
	if got := creatorRoleIDs(listCreatorRoles(t, client, tenant)); !slices.Equal(got, wanted) {
		t.Fatalf("creator role order = %v, want %v", got, wanted)
	}

	if _, err := client.DeleteCreatorRole(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteCreatorRoleRequest{
		Tenant:        tenant.tenantContext(),
		CreatorRoleId: letterer.Id,
	}); err != nil {
		t.Fatalf("DeleteCreatorRole: %v", err)
	}
	if got := creatorRoleIDs(listCreatorRoles(t, client, tenant)); slices.Contains(got, letterer.Id) {
		t.Fatalf("creator roles after delete = %v, want %s gone", got, letterer.Id)
	}
}

func TestDBCreatorRoleIDThatIsNotAnIdentifierIsRefused(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")

	_, err := env.creatorRoleClient().DeleteCreatorRole(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteCreatorRoleRequest{
		Tenant:        tenant.tenantContext(),
		CreatorRoleId: "not-a-uuid",
	})
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

	updated, err := client.UpdateGenre(testutil.WithBearer(context.Background(), tenantA.token()), &publiraadminv1.UpdateGenreRequest{
		Tenant:  tenantA.tenantContext(),
		GenreId: romance.Id,
		Name:    "Love Story",
	})
	if err != nil {
		t.Fatalf("UpdateGenre: %v", err)
	}
	if updated.Genre.Id != romance.Id || updated.Genre.Name != "Love Story" {
		t.Fatalf("updated genre = %+v, want %s renamed to Love Story", updated.Genre, romance.Id)
	}

	uploaded, err := client.UploadGenreEyeCatchAspectImage(testutil.WithBearer(context.Background(), tenantA.token()), &publiraadminv1.UploadGenreEyeCatchAspectImageRequest{
		Tenant:           tenantA.tenantContext(),
		GenreId:          fantasy.Id,
		VariantType:      "square",
		ImageData:        aspectJPEG(t, 1200, 1200),
		ImageContentType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("UploadGenreEyeCatchAspectImage: %v", err)
	}
	if uploaded.Genre.Id != fantasy.Id {
		t.Fatalf("uploaded genre.id = %q, want %q", uploaded.Genre.Id, fantasy.Id)
	}

	reordered, err := client.ReorderGenres(testutil.WithBearer(context.Background(), tenantA.token()), &publiraadminv1.ReorderGenresRequest{
		Tenant:           tenantA.tenantContext(),
		GenreIds:         []string{romance.Id, fantasy.Id},
		ExpectedGenreIds: []string{fantasy.Id, romance.Id},
	})
	if err != nil {
		t.Fatalf("ReorderGenres: %v", err)
	}
	if got, want := genreIDs(reordered.Genres), []string{romance.Id, fantasy.Id}; !slices.Equal(got, want) {
		t.Fatalf("ReorderGenres = %v, want %v", got, want)
	}

	_, err = client.DeleteGenre(testutil.WithBearer(context.Background(), tenantB.token()), &publiraadminv1.DeleteGenreRequest{
		Tenant:  tenantB.tenantContext(),
		GenreId: romance.Id,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteGenre from another tenant code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}
	if _, err := client.DeleteGenre(testutil.WithBearer(context.Background(), tenantA.token()), &publiraadminv1.DeleteGenreRequest{
		Tenant:  tenantA.tenantContext(),
		GenreId: romance.Id,
	}); err != nil {
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

	created, err := creators.CreateCreator(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateCreatorRequest{
		Tenant: tenant.tenantContext(),
		Name:   "Before Rename",
	})
	if err != nil {
		t.Fatalf("CreateCreator: %v", err)
	}
	requireID(t, "created creator", created.Creator.Id)

	updated, err := creators.UpdateCreator(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateCreatorRequest{
		Tenant:    tenant.tenantContext(),
		CreatorId: created.Creator.Id,
		Name:      "After Rename",
	})
	if err != nil {
		t.Fatalf("UpdateCreator: %v", err)
	}
	if updated.Creator.Id != created.Creator.Id || updated.Creator.Name != "After Rename" {
		t.Fatalf("updated creator = %+v, want %s renamed", updated.Creator, created.Creator.Id)
	}

	// The detail page still resolves its route segment by public ID, and what
	// it reads back is the ID the edit form posts.
	fetched, err := creators.GetCreator(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.GetCreatorRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: created.Creator.PublicId,
	})
	if err != nil {
		t.Fatalf("GetCreator: %v", err)
	}
	if fetched.Creator.Id != created.Creator.Id {
		t.Fatalf("GetCreator id = %q, want %q", fetched.Creator.Id, created.Creator.Id)
	}

	listed, err := creators.ListCreators(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListCreatorsRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListCreators: %v", err)
	}
	if len(listed.Creators) != 1 || listed.Creators[0].Id != created.Creator.Id {
		t.Fatalf("ListCreators = %+v, want the one creator with its id", listed.Creators)
	}
}

func TestDBLabelsAreAddressedByID(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	labels := env.labelClient()

	created, err := labels.CreateLabel(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.CreateLabelRequest{
		Tenant:                   tenant.tenantContext(),
		Name:                     "Before Rename",
		EyeCatchImageData:        aspectJPEG(t, 2400, 3200),
		EyeCatchImageContentType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("CreateLabel: %v", err)
	}
	requireID(t, "created label", created.Label.Id)

	updated, err := labels.UpdateLabel(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateLabelRequest{
		Tenant:  tenant.tenantContext(),
		LabelId: created.Label.Id,
		Name:    "After Rename",
	})
	if err != nil {
		t.Fatalf("UpdateLabel: %v", err)
	}
	if updated.Label.Id != created.Label.Id || updated.Label.Name != "After Rename" {
		t.Fatalf("updated label = %+v, want %s renamed", updated.Label, created.Label.Id)
	}

	uploaded, err := labels.UploadLabelEyeCatchAspectImage(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UploadLabelEyeCatchAspectImageRequest{
		Tenant:           tenant.tenantContext(),
		LabelId:          created.Label.Id,
		VariantType:      "square",
		ImageData:        aspectJPEG(t, 1200, 1200),
		ImageContentType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("UploadLabelEyeCatchAspectImage: %v", err)
	}
	if uploaded.Label.Id != created.Label.Id {
		t.Fatalf("uploaded label.id = %q, want %q", uploaded.Label.Id, created.Label.Id)
	}

	listed, err := labels.ListLabels(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListLabelsRequest{
		Tenant: tenant.tenantContext(),
	})
	if err != nil {
		t.Fatalf("ListLabels: %v", err)
	}
	if len(listed.Labels) != 1 || listed.Labels[0].Id != created.Label.Id {
		t.Fatalf("ListLabels = %+v, want the one label with its id", listed.Labels)
	}
}
