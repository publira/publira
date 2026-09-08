package adminapi

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func tagNames(tags []*publirattypesv1.Tag) []string {
	names := make([]string, 0, len(tags))
	for _, tag := range tags {
		names = append(names, tag.Name)
	}
	return names
}

func TestDBCreateSeriesCarriesItsGenresAndTags(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	genres := env.genreClient()
	client := env.seriesClient()

	romance := createGenre(t, genres, tenant, "Romance")
	fantasy := createGenre(t, genres, tenant, "Fantasy")

	created, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant: tenant.tenantContext(),
		Title:  "Classified Series",
		// Assigned in the reverse of the tenant's genre order, which is not the
		// order a read hands back.
		GenrePublicIds: []string{fantasy.PublicId, romance.PublicId},
		TagNames:       []string{"time travel", "school life"},
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}
	if got := genreNames(created.Msg.Series.Genres); !slices.Equal(got, []string{"Romance", "Fantasy"}) {
		t.Fatalf("genres = %v, want them in the tenant's genre order", got)
	}
	if got := tagNames(created.Msg.Series.Tags); !slices.Equal(got, []string{"school life", "time travel"}) {
		t.Fatalf("tags = %v, want them by name", got)
	}

	got, err := client.GetSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.GetSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: created.Msg.Series.PublicId,
	}))
	if err != nil {
		t.Fatalf("GetSeries: %v", err)
	}
	if names := genreNames(got.Msg.Series.Genres); !slices.Equal(names, []string{"Romance", "Fantasy"}) {
		t.Fatalf("GetSeries genres = %v, want the assigned genres", names)
	}
	if names := tagNames(got.Msg.Series.Tags); !slices.Equal(names, []string{"school life", "time travel"}) {
		t.Fatalf("GetSeries tags = %v, want the assigned tags", names)
	}

	listed, err := client.ListSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ListSeriesRequest{
		Tenant: tenant.tenantContext(),
	}))
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if len(listed.Msg.Series) != 1 {
		t.Fatalf("ListSeries = %d series, want 1", len(listed.Msg.Series))
	}
	if names := genreNames(listed.Msg.Series[0].Genres); !slices.Equal(names, []string{"Romance", "Fantasy"}) {
		t.Fatalf("ListSeries genres = %v, want the assigned genres", names)
	}
	if names := tagNames(listed.Msg.Series[0].Tags); !slices.Equal(names, []string{"school life", "time travel"}) {
		t.Fatalf("ListSeries tags = %v, want the assigned tags", names)
	}
}

func TestDBUpdateSeriesReplacesTheWholeClassification(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	genres := env.genreClient()
	client := env.seriesClient()

	fantasy := createGenre(t, genres, tenant, "Fantasy")
	mystery := createGenre(t, genres, tenant, "Mystery")

	created, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		Title:          "Classified Series",
		GenrePublicIds: []string{fantasy.PublicId},
		TagNames:       []string{"Time Travel"},
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}

	updated, err := client.UpdateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		PublicId:       created.Msg.Series.PublicId,
		Title:          "Classified Series",
		GenrePublicIds: []string{mystery.PublicId},
		TagNames:       []string{"Detective"},
	}))
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if got := genreNames(updated.Msg.Series.Genres); !slices.Equal(got, []string{"Mystery"}) {
		t.Fatalf("genres = %v, want only the genre the update named", got)
	}
	if got := tagNames(updated.Msg.Series.Tags); !slices.Equal(got, []string{"Detective"}) {
		t.Fatalf("tags = %v, want only the tag the update named", got)
	}

	// The tag the series let go of was the only one carrying it, so nothing
	// keeps it alive.
	if count := env.countRows(t, "SELECT count(*) FROM tags WHERE tenant_id = $1", tenant.Tenant.ID); count != 1 {
		t.Fatalf("tag rows = %d, want only the tag still carried", count)
	}
}

func TestDBUpdateSeriesClearsTheClassificationWhenTheSaveNamesNone(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	genres := env.genreClient()
	client := env.seriesClient()

	fantasy := createGenre(t, genres, tenant, "Fantasy")
	created, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:         tenant.tenantContext(),
		Title:          "Classified Series",
		GenrePublicIds: []string{fantasy.PublicId},
		TagNames:       []string{"Time Travel"},
	}))
	if err != nil {
		t.Fatalf("CreateSeries: %v", err)
	}

	updated, err := client.UpdateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: created.Msg.Series.PublicId,
		Title:    "Classified Series",
	}))
	if err != nil {
		t.Fatalf("UpdateSeries: %v", err)
	}
	if len(updated.Msg.Series.Genres) != 0 || len(updated.Msg.Series.Tags) != 0 {
		t.Fatalf("genres/tags = %v/%v, want both cleared", genreNames(updated.Msg.Series.Genres), tagNames(updated.Msg.Series.Tags))
	}
	if count := env.countRows(t, "SELECT count(*) FROM tags WHERE tenant_id = $1", tenant.Tenant.ID); count != 0 {
		t.Fatalf("tag rows = %d, want none left", count)
	}
	// The genre is the tenant's own list, so it outlives the assignment.
	if got := len(listGenres(t, genres, tenant)); got != 1 {
		t.Fatalf("genres = %d, want the tenant's list untouched", got)
	}
}

func TestDBSeriesTagsResolveToOneTagPerSlug(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	first, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		Title:    "First Series",
		TagNames: []string{"Time Travel", "time travel"},
	}))
	if err != nil {
		t.Fatalf("CreateSeries first: %v", err)
	}
	if got := tagNames(first.Msg.Series.Tags); !slices.Equal(got, []string{"Time Travel"}) {
		t.Fatalf("tags = %v, want the two spellings counted once", got)
	}

	// A second series typing the tag differently joins the tag that exists
	// rather than creating one beside it.
	second, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		Title:    "Second Series",
		TagNames: []string{"TIME TRAVEL"},
	}))
	if err != nil {
		t.Fatalf("CreateSeries second: %v", err)
	}
	if got := tagNames(second.Msg.Series.Tags); !slices.Equal(got, []string{"Time Travel"}) {
		t.Fatalf("tags = %v, want the name the tag was created under", got)
	}
	if count := env.countRows(t, "SELECT count(*) FROM tags WHERE tenant_id = $1", tenant.Tenant.ID); count != 1 {
		t.Fatalf("tag rows = %d, want one", count)
	}
}

func TestDBSeriesRefusesAGenreOfAnotherTenant(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	theirs := createGenre(t, env.genreClient(), second, "Fantasy")
	client := env.seriesClient()

	_, err := client.CreateSeries(context.Background(), newAdminDBRequest(first, &publiraadminv1.CreateSeriesRequest{
		Tenant:         first.tenantContext(),
		Title:          "Classified Series",
		GenrePublicIds: []string{theirs.PublicId},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
}

func TestDBSeriesRefusesMoreTagsThanTheLimit(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()

	tags := make([]string, 0, maxSeriesTags+1)
	for i := range maxSeriesTags + 1 {
		tags = append(tags, fmt.Sprintf("tag %d", i))
	}

	_, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
		Tenant:   tenant.tenantContext(),
		Title:    "Classified Series",
		TagNames: tags,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateSeries code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
}

func TestDBSeriesTagsOfAnotherTenantStayApart(t *testing.T) {
	env := newAdminDBEnv(t)
	first, second := seedTwoTenants(t, env)
	client := env.seriesClient()

	for _, tenant := range []adminDBTenant{first, second} {
		if _, err := client.CreateSeries(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateSeriesRequest{
			Tenant:   tenant.tenantContext(),
			Title:    "Classified Series",
			TagNames: []string{"Time Travel"},
		})); err != nil {
			t.Fatalf("CreateSeries: %v", err)
		}
	}

	// The same tag name on two tenants is two rows: the slug is unique within
	// a tenant, and one tenant's tag says nothing about the other's catalog.
	if count := env.countRows(t, "SELECT count(*) FROM tags"); count != 2 {
		t.Fatalf("tag rows = %d, want one per tenant", count)
	}
	if count := env.countRows(t, "SELECT count(*) FROM tags WHERE tenant_id = $1", first.Tenant.ID); count != 1 {
		t.Fatalf("tag rows of tenant A = %d, want 1", count)
	}
}
