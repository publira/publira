package adminapi

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/testutil"
)

// episodePageIDs lists the episode's pages in reading order, by id.
func episodePageIDs(t *testing.T, env *adminDBEnv, tenant adminDBTenant, episodeID string) []string {
	t.Helper()

	listed, err := env.seriesClient().ListEpisodeImages(testutil.WithBearer(context.Background(), tenant.token()), &publiraadminv1.ListEpisodeImagesRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: episodeID,
	})
	if err != nil {
		t.Fatalf("ListEpisodeImages: %v", err)
	}
	return imageIDs(listed.Images)
}

func imageIDs(images []*publirattypesv1.EpisodeImage) []string {
	ids := make([]string, 0, len(images))
	for _, image := range images {
		ids = append(ids, image.Id)
	}
	return ids
}

// episodeUpdatedEntries counts the episode_updated audit entries about one
// episode.
func (e *adminDBEnv) episodeUpdatedEntries(t *testing.T, tenant adminDBTenant, episodePublicID string) int {
	t.Helper()

	return e.countRows(t,
		"SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND action = 'episode_updated' AND target_type = 'episode' AND target_id = $2 AND outcome = 'success'",
		tenant.Tenant.ID, episodePublicID,
	)
}

// A rename writes the title and nothing else, and refuses a blank one and an
// episode of another tenant without writing.
func TestDBUpdateEpisodeTitleRenamesTheEpisode(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	other := env.seedTenantWithAdmin(t, "TENANTB", "tenant-b.example.com", "Tenant B", "TBUSER01", "admin@tenant-b.example.com")
	client := env.seriesClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	seriesPublicID := createDBSeries(t, client, tenant, "Renamed Series")
	episodePublicID := createDBEpisode(t, client, tenant, seriesPublicID, "Chapter Onw")
	episodeID := env.episodeID(t, episodePublicID)
	before := getDBEpisode(t, env, tenant, seriesPublicID, episodePublicID).Episode

	renamed, err := client.UpdateEpisodeTitle(ctx, &publiraadminv1.UpdateEpisodeTitleRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: episodeID,
		Title:     "Chapter One",
	})
	if err != nil {
		t.Fatalf("UpdateEpisodeTitle: %v", err)
	}
	if renamed.Episode.Title != "Chapter One" {
		t.Fatalf("answered title = %q, want %q", renamed.Episode.Title, "Chapter One")
	}
	after := getDBEpisode(t, env, tenant, seriesPublicID, episodePublicID).Episode
	if after.Title != "Chapter One" {
		t.Fatalf("stored title = %q, want %q", after.Title, "Chapter One")
	}
	if after.OrderIndex != before.OrderIndex || after.Price != before.Price || after.Status != before.Status {
		t.Fatalf("rename changed more than the title: before %v, after %v", before, after)
	}
	if got := env.episodeUpdatedEntries(t, tenant, episodePublicID); got != 1 {
		t.Fatalf("episode_updated entries = %d, want 1", got)
	}

	if _, err := client.UpdateEpisodeTitle(ctx, &publiraadminv1.UpdateEpisodeTitleRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: episodeID,
		Title:     "   ",
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("UpdateEpisodeTitle with a blank title error = %v, want invalid_argument", err)
	}
	if _, err := client.UpdateEpisodeTitle(testutil.WithBearer(context.Background(), other.token()), &publiraadminv1.UpdateEpisodeTitleRequest{
		Tenant:    other.tenantContext(),
		EpisodeId: episodeID,
		Title:     "Taken Over",
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("UpdateEpisodeTitle of another tenant's episode error = %v, want not_found", err)
	}
	if got := getDBEpisode(t, env, tenant, seriesPublicID, episodePublicID).Episode.Title; got != "Chapter One" {
		t.Fatalf("title after the refused renames = %q, want %q", got, "Chapter One")
	}
}

// Deleting a page takes it and its renditions out and leaves the others in
// the order they had.
func TestDBDeleteEpisodeImageKeepsTheOtherPagesInOrder(t *testing.T) {
	env := newAdminDBEnv(t)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	seriesPublicID := createDBSeries(t, client, tenant, "Paged Series")
	episodePublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 3)
	episodeID := env.episodeID(t, episodePublicID)
	otherEpisodeID := env.episodeID(t, createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 1))
	pages := episodePageIDs(t, env, tenant, episodeID)

	deleted, err := client.DeleteEpisodeImage(ctx, &publiraadminv1.DeleteEpisodeImageRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: episodeID,
		ImageId:   pages[1],
	})
	if err != nil {
		t.Fatalf("DeleteEpisodeImage: %v", err)
	}
	want := []string{pages[0], pages[2]}
	if got := imageIDs(deleted.Images); !slices.Equal(got, want) {
		t.Fatalf("answered pages = %v, want %v", got, want)
	}
	if got := episodePageIDs(t, env, tenant, episodeID); !slices.Equal(got, want) {
		t.Fatalf("stored pages = %v, want %v", got, want)
	}
	if got := env.countRows(t, "SELECT count(*) FROM episode_image_variants WHERE episode_image_id = $1", pages[1]); got != 0 {
		t.Fatalf("renditions of the deleted page = %d, want 0", got)
	}
	if got := env.episodeUpdatedEntries(t, tenant, episodePublicID); got != 1 {
		t.Fatalf("episode_updated entries = %d, want 1", got)
	}

	if _, err := client.DeleteEpisodeImage(ctx, &publiraadminv1.DeleteEpisodeImageRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: episodeID,
		ImageId:   pages[1],
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteEpisodeImage of a page already deleted error = %v, want not_found", err)
	}
	if _, err := client.DeleteEpisodeImage(ctx, &publiraadminv1.DeleteEpisodeImageRequest{
		Tenant:    tenant.tenantContext(),
		EpisodeId: otherEpisodeID,
		ImageId:   pages[0],
	}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("DeleteEpisodeImage naming another episode error = %v, want not_found", err)
	}
	if got := episodePageIDs(t, env, tenant, episodeID); !slices.Equal(got, want) {
		t.Fatalf("pages after the refused deletes = %v, want %v", got, want)
	}
}

// A replacement is a new page in the old one's place: the others keep theirs,
// the old page and its renditions are gone, and the new renditions name the
// objects that were stored for them.
func TestDBReplaceEpisodeImagePutsTheNewPageInTheOldOnesPlace(t *testing.T) {
	store := &recordingStorageProvider{}
	env := newAdminDBEnvWithStorage(t, store)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	seriesPublicID := createDBSeries(t, client, tenant, "Paged Series")
	episodePublicID := createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 3)
	episodeID := env.episodeID(t, episodePublicID)
	pages := episodePageIDs(t, env, tenant, episodeID)

	replaced, err := client.ReplaceEpisodeImage(ctx, &publiraadminv1.ReplaceEpisodeImageRequest{
		Tenant:      tenant.tenantContext(),
		EpisodeId:   episodeID,
		ImageId:     pages[1],
		Filename:    "002.jpg",
		ContentType: "image/jpeg",
		Data:        generateJPEG(t, 800, 1200),
	})
	if err != nil {
		t.Fatalf("ReplaceEpisodeImage: %v", err)
	}
	got := imageIDs(replaced.Images)
	if len(got) != 3 || got[0] != pages[0] || got[2] != pages[2] || got[1] == pages[1] {
		t.Fatalf("answered pages = %v, want %s, a new page, %s", got, pages[0], pages[2])
	}
	if replaced.Images[1].Width != 800 || replaced.Images[1].Height != 1200 {
		t.Fatalf("new page = %dx%d, want 800x1200", replaced.Images[1].Width, replaced.Images[1].Height)
	}
	if stored := episodePageIDs(t, env, tenant, episodeID); !slices.Equal(stored, got) {
		t.Fatalf("stored pages = %v, want %v", stored, got)
	}
	if count := env.countRows(t, "SELECT count(*) FROM episode_images WHERE id = $1", pages[1]); count != 0 {
		t.Fatalf("rows of the replaced page = %d, want 0", count)
	}
	uploaded := make([]string, 0)
	for _, upload := range store.recorded() {
		uploaded = append(uploaded, upload.ObjectKey)
	}
	rows, err := env.PG.DB.QueryContext(context.Background(), "SELECT object_key FROM episode_image_variants WHERE episode_image_id = $1", got[1])
	if err != nil {
		t.Fatalf("read the renditions of the new page: %v", err)
	}
	defer rows.Close() //nolint:errcheck
	renditions := 0
	for rows.Next() {
		var objectKey string
		if err := rows.Scan(&objectKey); err != nil {
			t.Fatalf("scan a rendition of the new page: %v", err)
		}
		if !slices.Contains(uploaded, objectKey) {
			t.Fatalf("rendition names %q, which was never stored (stored %v)", objectKey, uploaded)
		}
		renditions++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read the renditions of the new page: %v", err)
	}
	if renditions == 0 || renditions != len(uploaded) {
		t.Fatalf("renditions of the new page = %d, want one per stored object (%d)", renditions, len(uploaded))
	}
	if entries := env.episodeUpdatedEntries(t, tenant, episodePublicID); entries != 1 {
		t.Fatalf("episode_updated entries = %d, want 1", entries)
	}
}

// A replacement that names a page the episode does not have, or carries no
// usable image, stores nothing and leaves the pages as they were.
func TestDBReplaceEpisodeImageRefusesWithoutTouchingThePages(t *testing.T) {
	store := &recordingStorageProvider{}
	env := newAdminDBEnvWithStorage(t, store)
	tenant := env.seedTenantWithAdmin(t, "TENANTA", "tenant-a.example.com", "Tenant A", "TAUSER01", "admin@tenant-a.example.com")
	client := env.seriesClient()
	ctx := testutil.WithBearer(context.Background(), tenant.token())
	seriesPublicID := createDBSeries(t, client, tenant, "Paged Series")
	episodeID := env.episodeID(t, createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 2))
	otherEpisodeID := env.episodeID(t, createDBEpisodeWithPages(t, env, tenant, seriesPublicID, 1))
	pages := episodePageIDs(t, env, tenant, episodeID)
	otherPages := episodePageIDs(t, env, tenant, otherEpisodeID)

	for _, tc := range []struct {
		name string
		req  *publiraadminv1.ReplaceEpisodeImageRequest
		want connect.Code
	}{
		{
			name: "a page of another episode",
			req:  &publiraadminv1.ReplaceEpisodeImageRequest{EpisodeId: episodeID, ImageId: otherPages[0], ContentType: "image/jpeg", Data: generateJPEG(t, 80, 120)},
			want: connect.CodeNotFound,
		},
		{
			name: "data that is no image",
			req:  &publiraadminv1.ReplaceEpisodeImageRequest{EpisodeId: episodeID, ImageId: pages[0], ContentType: "image/jpeg", Data: []byte("not an image")},
			want: connect.CodeInvalidArgument,
		},
		{
			name: "no data",
			req:  &publiraadminv1.ReplaceEpisodeImageRequest{EpisodeId: episodeID, ImageId: pages[0], ContentType: "image/jpeg"},
			want: connect.CodeInvalidArgument,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.req.Tenant = tenant.tenantContext()
			if _, err := client.ReplaceEpisodeImage(ctx, tc.req); connect.CodeOf(err) != tc.want {
				t.Fatalf("ReplaceEpisodeImage error = %v, want %v", err, tc.want)
			}
			if uploads := store.recorded(); len(uploads) != 0 {
				t.Fatalf("stored %d objects, want none", len(uploads))
			}
			if got := episodePageIDs(t, env, tenant, episodeID); !slices.Equal(got, pages) {
				t.Fatalf("pages = %v, want %v", got, pages)
			}
			if got := episodePageIDs(t, env, tenant, otherEpisodeID); !slices.Equal(got, otherPages) {
				t.Fatalf("pages of the other episode = %v, want %v", got, otherPages)
			}
		})
	}
}
