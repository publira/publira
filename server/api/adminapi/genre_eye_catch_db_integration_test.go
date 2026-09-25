package adminapi

import (
	"context"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publiraadminv1connect "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1/publiraadminv1connect"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

// eyeCatchVariantCount is one variant per ratio and delivered width: three
// widths for each of portrait, square, landscape, and og.
const eyeCatchVariantCount = 12

// createGenreWithEyeCatch creates a genre with a whole eye-catch uploaded, the
// smallest image every ratio accepts.
func createGenreWithEyeCatch(
	t *testing.T,
	client publiraadminv1connect.AdminGenreServiceClient,
	tenant adminDBTenant,
	name string,
) *publirattypesv1.Genre {
	t.Helper()

	created, err := client.CreateGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateGenreRequest{
		Tenant:                   tenant.tenantContext(),
		Name:                     name,
		EyeCatchImageData:        aspectJPEG(t, 2400, 3200),
		EyeCatchImageContentType: "image/jpeg",
	}))
	if err != nil {
		t.Fatalf("CreateGenre(%q): %v", name, err)
	}
	return created.Msg.Genre
}

// genreVariantURLs lists the URLs of the variants of one ratio.
func genreVariantURLs(genre *publirattypesv1.Genre, variantType string) []string {
	urls := make([]string, 0)
	for _, variant := range genre.GetEyeCatchImageVariants() {
		if variant.GetVariantType() == variantType {
			urls = append(urls, variant.GetUrl())
		}
	}
	return urls
}

func TestDBCreateGenreStoresOneVariantPerRatioAndWidth(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	created := createGenreWithEyeCatch(t, client, tenant, "Fantasy")
	if got := len(created.GetEyeCatchImageVariants()); got != eyeCatchVariantCount {
		t.Fatalf("created variants = %d, want %d", got, eyeCatchVariantCount)
	}
	if created.GetEyeCatchImageUpdatedAt() == "" {
		t.Fatal("eye_catch_image_updated_at is empty on a genre with an eye-catch")
	}
	for _, variant := range created.GetEyeCatchImageVariants() {
		if !strings.HasPrefix(variant.GetUrl(), "/images/genres/") {
			t.Fatalf("variant url = %q, want it under /images/genres/", variant.GetUrl())
		}
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM genre_image_variants WHERE tenant_id = $1", tenant.Tenant.ID,
	); count != eyeCatchVariantCount {
		t.Fatalf("genre_image_variants rows = %d, want %d", count, eyeCatchVariantCount)
	}

	listed := listGenres(t, client, tenant)
	if len(listed) != 1 || len(listed[0].GetEyeCatchImageVariants()) != eyeCatchVariantCount {
		t.Fatalf("listed genres = %v, want the one genre with every variant", listed)
	}
}

// A genre holds its name within the tenant, so a create whose upload fails
// must not leave the genre behind to refuse the editor's retry.
func TestDBCreateGenreWithAnUnusableImageLeavesNoGenre(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	_, err := client.CreateGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.CreateGenreRequest{
		Tenant:                   tenant.tenantContext(),
		Name:                     "Fantasy",
		EyeCatchImageData:        aspectJPEG(t, 600, 800),
		EyeCatchImageContentType: "image/jpeg",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CreateGenre with a small image error = %v, want invalid_argument", err)
	}
	if listed := listGenres(t, client, tenant); len(listed) != 0 {
		t.Fatalf("genres after the refused create = %v, want none", genreNames(listed))
	}
	createGenre(t, client, tenant, "Fantasy")
}

func TestDBUploadGenreEyeCatchAspectImageReplacesOnlyThatRatio(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	created := createGenreWithEyeCatch(t, client, tenant, "Fantasy")
	untouched := func() []string {
		t.Helper()
		ids := make([]string, 0)
		rows, err := env.PG.DB.QueryContext(context.Background(),
			"SELECT id::text FROM genre_image_variants WHERE tenant_id = $1 AND variant_type <> 'square' ORDER BY id",
			tenant.Tenant.ID)
		if err != nil {
			t.Fatalf("list the other ratios: %v", err)
		}
		defer rows.Close() //nolint:errcheck
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatalf("scan: %v", err)
			}
			ids = append(ids, id)
		}
		return ids
	}
	before := untouched()

	uploaded, err := client.UploadGenreEyeCatchAspectImage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadGenreEyeCatchAspectImageRequest{
		Tenant:           tenant.tenantContext(),
		PublicId:         created.PublicId,
		VariantType:      "square",
		ImageData:        aspectJPEG(t, 1200, 1200),
		ImageContentType: "image/jpeg",
	}))
	if err != nil {
		t.Fatalf("UploadGenreEyeCatchAspectImage: %v", err)
	}

	if after := untouched(); !slices.Equal(after, before) {
		t.Fatalf("other ratios = %v after replacing square, want %v", after, before)
	}
	if got := len(uploaded.Msg.Genre.GetEyeCatchImageVariants()); got != eyeCatchVariantCount {
		t.Fatalf("variants after replacing square = %d, want %d", got, eyeCatchVariantCount)
	}
	// The ratio is replaced under the same image, so its delivery URLs hold.
	if got, want := genreVariantURLs(uploaded.Msg.Genre, "square"), genreVariantURLs(created, "square"); !slices.Equal(got, want) {
		t.Fatalf("square urls = %v, want %v", got, want)
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'genre_eye_catch_aspect_image_uploaded' AND target_id = $2",
		tenant.Tenant.ID, created.PublicId+"/square",
	); count != 1 {
		t.Fatalf("audit entries for the ratio upload = %d, want 1", count)
	}
}

func TestDBUploadGenreEyeCatchAspectImageRequiresAnEyeCatch(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	genre := createGenre(t, client, tenant, "Fantasy")
	_, err := client.UploadGenreEyeCatchAspectImage(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UploadGenreEyeCatchAspectImageRequest{
		Tenant:           tenant.tenantContext(),
		PublicId:         genre.PublicId,
		VariantType:      "square",
		ImageData:        aspectJPEG(t, 1200, 1200),
		ImageContentType: "image/jpeg",
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UploadGenreEyeCatchAspectImage error = %v, want failed_precondition", err)
	}
}

func TestDBUpdateGenreClearsTheEyeCatchAndKeepsItOtherwise(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	created := createGenreWithEyeCatch(t, client, tenant, "Fantasy")

	renamed, err := client.UpdateGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateGenreRequest{
		Tenant:   tenant.tenantContext(),
		PublicId: created.PublicId,
		Name:     "High Fantasy",
	}))
	if err != nil {
		t.Fatalf("UpdateGenre rename: %v", err)
	}
	if got := len(renamed.Msg.Genre.GetEyeCatchImageVariants()); got != eyeCatchVariantCount {
		t.Fatalf("variants after a rename = %d, want the eye-catch kept", got)
	}

	cleared, err := client.UpdateGenre(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.UpdateGenreRequest{
		Tenant:             tenant.tenantContext(),
		PublicId:           created.PublicId,
		Name:               "High Fantasy",
		ClearEyeCatchImage: true,
	}))
	if err != nil {
		t.Fatalf("UpdateGenre clear: %v", err)
	}
	if got := cleared.Msg.Genre.GetEyeCatchImageVariants(); len(got) != 0 {
		t.Fatalf("variants after clearing = %v, want none", got)
	}
	if listed := listGenres(t, client, tenant); len(listed[0].GetEyeCatchImageVariants()) != 0 {
		t.Fatalf("listed variants after clearing = %v, want none", listed[0].GetEyeCatchImageVariants())
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM genres WHERE tenant_id = $1 AND eye_catch_image_id IS NOT NULL", tenant.Tenant.ID,
	); count != 0 {
		t.Fatalf("genres still pointing at an eye-catch = %d, want 0", count)
	}
}

func TestDBReorderGenresKeepsTheEyeCatchInTheAnswer(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.genreClient()

	first := createGenreWithEyeCatch(t, client, tenant, "Fantasy")
	second := createGenre(t, client, tenant, "Mystery")

	reordered, err := client.ReorderGenres(context.Background(), newAdminDBRequest(tenant, &publiraadminv1.ReorderGenresRequest{
		Tenant:                 tenant.tenantContext(),
		GenrePublicIds:         []string{second.PublicId, first.PublicId},
		ExpectedGenrePublicIds: []string{first.PublicId, second.PublicId},
	}))
	if err != nil {
		t.Fatalf("ReorderGenres: %v", err)
	}
	genres := reordered.Msg.Genres
	if len(genres) != 2 || len(genres[0].GetEyeCatchImageVariants()) != 0 || len(genres[1].GetEyeCatchImageVariants()) != eyeCatchVariantCount {
		t.Fatalf("reordered genres = %v, want Mystery bare and Fantasy with its eye-catch", genres)
	}
}
