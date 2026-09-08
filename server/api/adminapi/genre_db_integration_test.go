package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func genrePublicIDs(genres []*publirattypesv1.Genre) []string {
	publicIDs := make([]string, 0, len(genres))
	for _, genre := range genres {
		publicIDs = append(publicIDs, genre.PublicId)
	}
	return publicIDs
}

func genreNames(genres []*publirattypesv1.Genre) []string {
	names := make([]string, 0, len(genres))
	for _, genre := range genres {
		names = append(names, genre.Name)
	}
	return names
}

// createGenre creates one genre and fails the test if it could not be created,
// so a case that is about something else reads as one call per genre.
func createGenre(
	t *testing.T,
	client publiraadminv1connect.AdminGenreServiceClient,
	tenant adminDBTenant,
	name string,
) *publirattypesv1.Genre {
	t.Helper()

	created, err := client.CreateGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateGenreRequest{
		Tenant: tenant.tenantContext(),
		Name:   name,
	}))
	if err != nil {
		t.Fatalf("CreateGenre(%q): %v", name, err)
	}
	return created.Msg.Genre
}

func listGenres(
	t *testing.T,
	client publiraadminv1connect.AdminGenreServiceClient,
	tenant adminDBTenant,
) []*publirattypesv1.Genre {
	t.Helper()

	listed, err := client.ListGenres(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListGenresRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListGenres: %v", err)
	}
	return listed.Msg.Genres
}

func TestDBCreateGenreAppendsToTheTenantOrder(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	fantasy := createGenre(t, client, tenant, "Fantasy")
	mystery := createGenre(t, client, tenant, "Mystery")

	if fantasy.Slug != "fantasy" {
		t.Fatalf("genre.slug = %q, want fantasy", fantasy.Slug)
	}
	if got := genrePublicIDs(listGenres(t, client, tenant)); !slices.Equal(got, []string{fantasy.PublicId, mystery.PublicId}) {
		t.Fatalf("genre order = %v, want the order they were created in", got)
	}
}

func TestDBCreateGenreRefusesANameAnotherGenreAlreadyHolds(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	createGenre(t, client, tenant, "Slice of Life")

	// The names differ on screen but reach the same slug, which is what makes
	// them the same genre.
	_, err := client.CreateGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateGenreRequest{
		Tenant: tenant.tenantContext(),
		Name:   "  slice   OF  life ",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("CreateGenre code = %v, want %v", connect.CodeOf(err), connect.CodeAlreadyExists)
	}
}

func TestDBCreateGenreRefusesANameWithNothingToSlug(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	_, err := client.CreateGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateGenreRequest{
		Tenant: tenant.tenantContext(),
		Name:   "!!!",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateGenre code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
}

func TestDBUpdateGenreRenamesAndReSlugs(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	genre := createGenre(t, client, tenant, "Fantasy")

	updated, err := client.UpdateGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateGenreRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: genre.PublicId,
		Name:     "High Fantasy",
	}))
	if err != nil {
		t.Fatalf("UpdateGenre: %v", err)
	}
	if updated.Msg.Genre.PublicId != genre.PublicId {
		t.Fatalf("genre.public_id = %q, want it unchanged at %q", updated.Msg.Genre.PublicId, genre.PublicId)
	}
	if updated.Msg.Genre.Slug != "high-fantasy" {
		t.Fatalf("genre.slug = %q, want high-fantasy", updated.Msg.Genre.Slug)
	}
	if got := genreNames(listGenres(t, client, tenant)); !slices.Equal(got, []string{"High Fantasy"}) {
		t.Fatalf("genre names = %v, want the renamed genre", got)
	}
}

func TestDBReorderGenresWritesTheRequestedOrder(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	first := createGenre(t, client, tenant, "Fantasy")
	second := createGenre(t, client, tenant, "Mystery")
	third := createGenre(t, client, tenant, "Romance")

	wanted := []string{third.PublicId, first.PublicId, second.PublicId}
	reordered, err := client.ReorderGenres(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderGenresRequest{
		Tenant:                 tenant.tenantContext(),
		GenrePublicIds:         wanted,
		ExpectedGenrePublicIds: []string{first.PublicId, second.PublicId, third.PublicId},
	}))
	if err != nil {
		t.Fatalf("ReorderGenres: %v", err)
	}
	if got := genrePublicIDs(reordered.Msg.Genres); !slices.Equal(got, wanted) {
		t.Fatalf("ReorderGenres = %v, want %v", got, wanted)
	}
	if got := genrePublicIDs(listGenres(t, client, tenant)); !slices.Equal(got, wanted) {
		t.Fatalf("genre order = %v, want %v", got, wanted)
	}
}

func TestDBReorderGenresRefusesAnOrderBuiltOnAStaleList(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	first := createGenre(t, client, tenant, "Fantasy")
	second := createGenre(t, client, tenant, "Mystery")
	// A genre created after the client read the list: the order it composed no
	// longer covers everything the tenant has.
	createGenre(t, client, tenant, "Romance")

	_, err := client.ReorderGenres(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderGenresRequest{
		Tenant:                 tenant.tenantContext(),
		GenrePublicIds:         []string{second.PublicId, first.PublicId},
		ExpectedGenrePublicIds: []string{first.PublicId, second.PublicId},
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ReorderGenres code = %v, want %v", connect.CodeOf(err), connect.CodeFailedPrecondition)
	}
}

func TestDBDeleteGenreRemovesAnUnusedOne(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	genre := createGenre(t, client, tenant, "Fantasy")

	if _, err := client.DeleteGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteGenreRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: genre.PublicId,
	})); err != nil {
		t.Fatalf("DeleteGenre: %v", err)
	}
	if got := listGenres(t, client, tenant); len(got) != 0 {
		t.Fatalf("genres after delete = %v, want none", genrePublicIDs(got))
	}
}

func TestDBDeleteGenreRefusesOneASeriesCarries(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	genres := env.genreClient()
	series := env.seriesClient()

	genre := createGenre(t, genres, tenant, "Fantasy")
	if _, err := series.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		Title:          "Classified Series",
		GenrePublicIds: []string{genre.PublicId},
	})); err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}

	_, err := genres.DeleteGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteGenreRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: genre.PublicId,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("DeleteGenre code = %v, want %v", connect.CodeOf(err), connect.CodeFailedPrecondition)
	}
	if got := len(listGenres(t, genres, tenant)); got != 1 {
		t.Fatalf("genres after the refused delete = %d, want the genre kept", got)
	}
}

func TestDBGenresOfAnotherTenantAreOutOfReach(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.genreClient()

	theirs := createGenre(t, client, second, "Fantasy")
	// The same name is free for the other tenant: the slug is unique per
	// tenant, not per platform.
	mine := createGenre(t, client, first, "Fantasy")

	if got := genrePublicIDs(listGenres(t, client, first)); !slices.Equal(got, []string{mine.PublicId}) {
		t.Fatalf("genres of tenant A = %v, want only its own", got)
	}
	_, err := client.UpdateGenre(context.Background(), newAdminDBRequest(first, &publiraadminv1.UpdateGenreRequest{
		Tenant:   first.tenantContext(),
		PublicId: theirs.PublicId,
		Name:     "Renamed",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateGenre code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}
}

func TestDBListGenresPagesForwardAndBackward(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	created := make([]string, 0, 3)
	for _, name := range []string{"Fantasy", "Mystery", "Romance"} {
		created = append(created, createGenre(t, client, tenant, name).PublicId)
	}

	firstPage, err := client.ListGenres(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListGenresRequest{
		Tenant: tenant.tenantContext(),
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("ListGenres: %v", err)
	}
	if got := genrePublicIDs(firstPage.Msg.Genres); !slices.Equal(got, created[:2]) {
		t.Fatalf("first page = %v, want %v", got, created[:2])
	}
	if firstPage.Msg.PreviousToken != "" {
		t.Fatal("first page carries a previous token")
	}
	if firstPage.Msg.NextToken == "" {
		t.Fatal("first page carries no next token")
	}

	secondPage, err := client.ListGenres(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListGenresRequest{
		Tenant: tenant.tenantContext(),
		Limit:  2,
		Token:  firstPage.Msg.NextToken,
	}))
	if err != nil {
		t.Fatalf("ListGenres next: %v", err)
	}
	if got := genrePublicIDs(secondPage.Msg.Genres); !slices.Equal(got, created[2:]) {
		t.Fatalf("second page = %v, want %v", got, created[2:])
	}

	back, err := client.ListGenres(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListGenresRequest{
		Tenant: tenant.tenantContext(),
		Limit:  2,
		Token:  secondPage.Msg.PreviousToken,
	}))
	if err != nil {
		t.Fatalf("ListGenres previous: %v", err)
	}
	if got := genrePublicIDs(back.Msg.Genres); !slices.Equal(got, created[:2]) {
		t.Fatalf("page back = %v, want %v", got, created[:2])
	}
}

func TestDBGenreChangesAreAudited(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	genre := createGenre(t, client, tenant, "Fantasy")
	if _, err := client.UpdateGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateGenreRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: genre.PublicId,
		Name:     "High Fantasy",
	})); err != nil {
		t.Fatalf("UpdateGenre: %v", err)
	}
	if _, err := client.DeleteGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.DeleteGenreRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: genre.PublicId,
	})); err != nil {
		t.Fatalf("DeleteGenre: %v", err)
	}

	for _, action := range []string{"genre_created", "genre_updated", "genre_deleted"} {
		if count := env.countRows(t,
			"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = $2 AND target_id = $3",
			tenant.Tenant.ID, action, genre.PublicId,
		); count != 1 {
			t.Fatalf("audit entries for %s = %d, want 1", action, count)
		}
	}
}
