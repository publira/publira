package adminapi

import (
	"context"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// uploadDBEpisodeEyeCatch gives the episode a whole eye-catch, the smallest
// image every ratio accepts.
func uploadDBEpisodeEyeCatch(t *testing.T, env *adminDBEnv, tenant adminDBTenant, episodeID string) *publirattypesv1.Episode {
	t.Helper()

	uploaded, err := env.seriesClient().UploadEpisodeEyeCatchImage(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UploadEpisodeEyeCatchImageRequest{
		Tenant:           tenant.tenantContext(),
		EpisodeId:        episodeID,
		ImageData:        aspectJPEG(t, 2400, 3200),
		ImageContentType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("UploadEpisodeEyeCatchImage: %v", err)
	}
	return uploaded.Episode
}

// episodeVariantURLs lists the URLs of the variants of one ratio.
func episodeVariantURLs(episode *publirattypesv1.Episode, variantType string) []string {
	urls := make([]string, 0)
	for _, variant := range episode.GetEyeCatchImageVariants() {
		if variant.GetVariantType() == variantType {
			urls = append(urls, variant.GetUrl())
		}
	}
	return urls
}

func listDBEpisodes(t *testing.T, env *adminDBEnv, tenant adminDBTenant, seriesPublicID string) []*publirattypesv1.Episode {
	t.Helper()

	listed, err := env.seriesClient().ListEpisodes(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodesRequest{
		Tenant:   tenant.tenantContext(),
		SeriesId: env.seriesID(t, seriesPublicID),
	})
	if err != nil {
		t.Fatalf("ListEpisodes: %v", err)
	}
	return listed.Episodes
}

// An uploaded eye-catch is stored as every ratio at every width, delivered from
// a route of its own, and carried by the episode reads; an episode without one
// is read with both fields empty.
func TestDBUploadEpisodeEyeCatchImageIsCarriedByTheEpisodeReads(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	seriesPublicID := createDBSeries(t, env.seriesClient(), tenant, "Eye Catch Series")
	withPublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 0)
	withoutPublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 0)

	uploaded := uploadDBEpisodeEyeCatch(t, env, tenant, env.episodeID(t, withPublicID))
	if got := len(uploaded.GetEyeCatchImageVariants()); got != eyeCatchVariantCount {
		t.Fatalf("uploaded variants = %d, want %d", got, eyeCatchVariantCount)
	}
	if uploaded.GetEyeCatchImageUpdatedAt() == "" {
		t.Fatal("eye_catch_image_updated_at is empty on an episode with an eye-catch")
	}
	for _, variant := range uploaded.GetEyeCatchImageVariants() {
		if !strings.HasPrefix(variant.GetUrl(), "/images/episode-eye-catches/") {
			t.Fatalf("variant url = %q, want it under /images/episode-eye-catches/", variant.GetUrl())
		}
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM episode_eye_catch_image_variants WHERE tenant_id = $1", tenant.Tenant.ID,
	); count != eyeCatchVariantCount {
		t.Fatalf("episode_eye_catch_image_variants rows = %d, want %d", count, eyeCatchVariantCount)
	}

	got := getDBEpisode(t, env, tenant, seriesPublicID, withPublicID)
	if !slices.Equal(episodeVariantURLs(got.Episode, "portrait"), episodeVariantURLs(uploaded, "portrait")) {
		t.Fatalf("GetEpisode portrait urls = %v, want the upload response %v", episodeVariantURLs(got.Episode, "portrait"), episodeVariantURLs(uploaded, "portrait"))
	}
	if got.Episode.GetEyeCatchImageUpdatedAt() != uploaded.GetEyeCatchImageUpdatedAt() {
		t.Fatalf("GetEpisode updated_at = %q, want %q", got.Episode.GetEyeCatchImageUpdatedAt(), uploaded.GetEyeCatchImageUpdatedAt())
	}
	bare := getDBEpisode(t, env, tenant, seriesPublicID, withoutPublicID)
	if len(bare.Episode.GetEyeCatchImageVariants()) != 0 || bare.Episode.GetEyeCatchImageUpdatedAt() != "" {
		t.Fatalf("episode without an eye-catch = %v at %q, want both empty", bare.Episode.GetEyeCatchImageVariants(), bare.Episode.GetEyeCatchImageUpdatedAt())
	}

	listed := listDBEpisodes(t, env, tenant, seriesPublicID)
	counts := make(map[string]int, len(listed))
	for _, episode := range listed {
		counts[episode.GetPublicId()] = len(episode.GetEyeCatchImageVariants())
	}
	if counts[withPublicID] != eyeCatchVariantCount || counts[withoutPublicID] != 0 {
		t.Fatalf("listed variant counts = %v, want %d on %s and none on %s", counts, eyeCatchVariantCount, withPublicID, withoutPublicID)
	}

	// The next write to the episode answers with the eye-catch it still has.
	renamed, err := env.seriesClient().UpdateEpisodeTitle(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UpdateEpisodeTitleRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: env.episodeID(t, withPublicID),
		Title:     "Renamed",
	})
	if err != nil {
		t.Fatalf("UpdateEpisodeTitle: %v", err)
	}
	if got := len(renamed.Episode.GetEyeCatchImageVariants()); got != eyeCatchVariantCount {
		t.Fatalf("variants after a rename = %d, want the eye-catch kept", got)
	}
}

// A second whole upload stores a new image and points the episode at it, so
// every URL changes and the image it replaced is left for the sweep.
func TestDBUploadEpisodeEyeCatchImageReplacesTheWholeEyeCatch(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	seriesPublicID := createDBSeries(t, env.seriesClient(), tenant, "Eye Catch Series")
	episodeID := env.episodeID(t, createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 0))

	first := uploadDBEpisodeEyeCatch(t, env, tenant, episodeID)
	second := uploadDBEpisodeEyeCatch(t, env, tenant, episodeID)

	for _, url := range episodeVariantURLs(second, "portrait") {
		if slices.Contains(episodeVariantURLs(first, "portrait"), url) {
			t.Fatalf("portrait url %q survived a whole replacement", url)
		}
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM episode_eye_catch_images i WHERE i.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.eye_catch_image_id = i.id)",
		tenant.Tenant.ID,
	); count != 1 {
		t.Fatalf("unreferenced episode eye-catch images = %d, want the replaced one", count)
	}
}

func TestDBUploadEpisodeEyeCatchAspectImageReplacesOnlyThatRatio(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	seriesPublicID := createDBSeries(t, env.seriesClient(), tenant, "Eye Catch Series")
	episodePublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 0)
	episodeID := env.episodeID(t, episodePublicID)

	created := uploadDBEpisodeEyeCatch(t, env, tenant, episodeID)
	uploaded, err := env.seriesClient().UploadEpisodeEyeCatchAspectImage(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UploadEpisodeEyeCatchAspectImageRequest{
		Tenant:           tenant.tenantContext(),
		EpisodeId:        episodeID,
		VariantType:      "square",
		ImageData:        aspectJPEG(t, 1200, 1200),
		ImageContentType: "image/jpeg",
		Crop:             &publirattypesv1.ImageCropRect{X: 0, Y: 0, Width: 1200, Height: 1200},
	})
	if err != nil {
		t.Fatalf("UploadEpisodeEyeCatchAspectImage: %v", err)
	}

	if got := len(uploaded.Episode.GetEyeCatchImageVariants()); got != eyeCatchVariantCount {
		t.Fatalf("variants after replacing square = %d, want %d", got, eyeCatchVariantCount)
	}
	replaced := episodeVariantURLs(uploaded.Episode, "square")
	original := episodeVariantURLs(created, "square")
	if slices.Equal(replaced, original) {
		t.Fatalf("square urls = %v, want them to differ from the ones they replaced", replaced)
	}
	if got, want := eyeCatchPaths(t, replaced), eyeCatchPaths(t, original); !slices.Equal(got, want) {
		t.Fatalf("square paths = %v, want the same image route %v", got, want)
	}
	for _, ratio := range []string{"portrait", "landscape", "og"} {
		if got, want := episodeVariantURLs(uploaded.Episode, ratio), episodeVariantURLs(created, ratio); !slices.Equal(got, want) {
			t.Fatalf("%s urls = %v, want the urls from before the replacement %v", ratio, got, want)
		}
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'episode_eye_catch_aspect_image_uploaded' AND target_id = $2",
		tenant.Tenant.ID, episodePublicID+"/square",
	); count != 1 {
		t.Fatalf("audit entries for the ratio upload = %d, want 1", count)
	}
}

func TestDBUploadEpisodeEyeCatchAspectImageRequiresAnEyeCatch(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	seriesPublicID := createDBSeries(t, env.seriesClient(), tenant, "Eye Catch Series")
	episodeID := env.episodeID(t, createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 0))

	_, err := env.seriesClient().UploadEpisodeEyeCatchAspectImage(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.UploadEpisodeEyeCatchAspectImageRequest{
		Tenant:           tenant.tenantContext(),
		EpisodeId:        episodeID,
		VariantType:      "square",
		ImageData:        aspectJPEG(t, 1200, 1200),
		ImageContentType: "image/jpeg",
	})
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("UploadEpisodeEyeCatchAspectImage error = %v, want failed_precondition", err)
	}
}

// An episode of another tenant is not found, for every write to an eye-catch.
func TestDBEpisodeEyeCatchWritesRefuseAnotherTenantsEpisode(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenantA := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	tenantB := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	seriesPublicID := createDBSeries(t, env.seriesClient(), tenantB, "Other Tenant Series")
	episodeID := env.episodeID(t, createDBEpisodeWithPages(t, env, tenantB, seriesPublicID, 0))
	uploadDBEpisodeEyeCatch(t, env, tenantB, episodeID)

	ctx := testutil.WithBearer(context.Background(), tenantA.token())
	_, err := env.seriesClient().UploadEpisodeEyeCatchImage(ctx, &publiraadminv1.UploadEpisodeEyeCatchImageRequest{
		Tenant:           tenantA.tenantContext(),
		EpisodeId:        episodeID,
		ImageData:        aspectJPEG(t, 2400, 3200),
		ImageContentType: "image/jpeg",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UploadEpisodeEyeCatchImage error = %v, want not_found", err)
	}
	_, err = env.seriesClient().UploadEpisodeEyeCatchAspectImage(ctx, &publiraadminv1.UploadEpisodeEyeCatchAspectImageRequest{
		Tenant:           tenantA.tenantContext(),
		EpisodeId:        episodeID,
		VariantType:      "square",
		ImageData:        aspectJPEG(t, 1200, 1200),
		ImageContentType: "image/jpeg",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UploadEpisodeEyeCatchAspectImage error = %v, want not_found", err)
	}
	_, err = env.seriesClient().DeleteEpisodeEyeCatchImage(ctx, &publiraadminv1.DeleteEpisodeEyeCatchImageRequest{
		Tenant:    tenantA.tenantContext(),
		EpisodeId: episodeID,
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteEpisodeEyeCatchImage error = %v, want not_found", err)
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM episodes WHERE tenant_id = $1 AND eye_catch_image_id IS NOT NULL", tenantB.Tenant.ID,
	); count != 1 {
		t.Fatalf("tenant B episodes with an eye-catch = %d, want its own upload kept", count)
	}
}

func TestDBDeleteEpisodeEyeCatchImageLeavesTheEpisodeWithoutOne(t *testing.T) {
	t.Parallel()

	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	seriesPublicID := createDBSeries(t, env.seriesClient(), tenant, "Eye Catch Series")
	episodePublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 0)
	episodeID := env.episodeID(t, episodePublicID)
	uploadDBEpisodeEyeCatch(t, env, tenant, episodeID)

	for attempt := range 2 {
		// A second removal finds nothing to remove and answers the same way.
		deleted, err := env.seriesClient().DeleteEpisodeEyeCatchImage(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.DeleteEpisodeEyeCatchImageRequest{
			Tenant:    tenant.tenantContext(),
			EpisodeId: episodeID,
		})
		if err != nil {
			t.Fatalf("DeleteEpisodeEyeCatchImage attempt %d: %v", attempt+1, err)
		}
		if len(deleted.Episode.GetEyeCatchImageVariants()) != 0 || deleted.Episode.GetEyeCatchImageUpdatedAt() != "" {
			t.Fatalf("episode after removal = %v at %q, want both empty", deleted.Episode.GetEyeCatchImageVariants(), deleted.Episode.GetEyeCatchImageUpdatedAt())
		}
	}

	if got := getDBEpisode(t, env, tenant, seriesPublicID, episodePublicID); len(got.Episode.GetEyeCatchImageVariants()) != 0 {
		t.Fatalf("GetEpisode variants after removal = %v, want none", got.Episode.GetEyeCatchImageVariants())
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM episodes WHERE tenant_id = $1 AND eye_catch_image_id IS NOT NULL", tenant.Tenant.ID,
	); count != 0 {
		t.Fatalf("episodes still pointing at an eye-catch = %d, want 0", count)
	}
	if count := env.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'episode_updated' AND target_id = $2",
		tenant.Tenant.ID, episodePublicID,
	); count != 2 {
		t.Fatalf("episode_updated entries = %d, want the upload and the one removal that removed something", count)
	}
}
