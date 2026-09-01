package orphanimages_test

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/orphanimages"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/testutil"
)

const sweepPrefix = "tenants/"

// TestReclaimerRunIntegration drives one reclamation run against a real
// PostgreSQL and a real S3 compatible bucket, over one object of every kind an
// upload can leave behind: the ones an entity still points at, the one a
// replacement superseded, and the one a rolled-back transaction abandoned.
func TestReclaimerRunIntegration(t *testing.T) {
	env := testutil.StartPostgres(t)
	env.Reset(t)
	rustfs := testutil.StartRustFS(t)
	rustfs.CreateBucket(t)

	ctx := t.Context()
	store, err := s3.New(ctx, s3.Config{
		Bucket:         rustfs.Bucket,
		Region:         rustfs.Region,
		Endpoint:       rustfs.Endpoint,
		ForcePathStyle: true,
	})
	if err != nil {
		t.Fatalf("s3.New: %v", err)
	}

	tenant := env.SeedTenant(t, "TENANT001", "tenant.example.com", "Tenant")
	label := env.SeedLabel(t, tenant.ID, testutil.LabelSeed{PublicID: "LABEL0000001"})
	series := env.SeedSeries(t, tenant.ID, testutil.SeriesSeed{PublicID: "SERIES000001", LabelID: label.ID})
	episode := env.SeedEpisode(t, tenant.ID, series.ID, testutil.EpisodeSeed{PublicID: "EPISODE00001"})
	creator := env.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATOR00001"})

	// Every image an entity still points at, one per table that holds object
	// keys. None of these may be touched by a run.
	liveCreatorIcon := "tenants/TENANT001/creators/CREATOR00001/live-original.webp"
	seedCreatorImage(t, env.DB, tenant.ID, creator.ID, liveCreatorIcon, true)
	liveSeriesEyeCatch := "tenants/TENANT001/series/SERIES000001/live-portrait.webp"
	seedSeriesImage(t, env.DB, tenant.ID, series.ID, liveSeriesEyeCatch, true)
	liveLabelEyeCatch := "tenants/TENANT001/labels/LABEL0000001/live-portrait.webp"
	seedLabelImage(t, env.DB, tenant.ID, label.ID, liveLabelEyeCatch, true)
	liveTenantIcon := "tenants/TENANT001/icons/live-icon.webp"
	seedTenantImage(t, env.DB, tenant.ID, liveTenantIcon, true)
	liveEpisodePage := "tenants/TENANT001/episodes/EPISODE00001/live-original.webp"
	seedEpisodeImage(t, env.DB, tenant.ID, episode.ID, liveEpisodePage)

	// The image a replacement superseded: its row survived the swap, and
	// nothing has pointed at it since.
	supersededCreatorIcon := "tenants/TENANT001/creators/CREATOR00001/superseded-original.webp"
	supersededImageID := seedCreatorImage(t, env.DB, tenant.ID, creator.ID, supersededCreatorIcon, false)

	// The object a rolled-back transaction abandoned: it was uploaded, and the
	// rows that would have named it were never committed.
	abandonedObject := "tenants/TENANT001/series/SERIES000001/rolled-back-portrait.webp"

	stored := []string{
		liveCreatorIcon, liveSeriesEyeCatch, liveLabelEyeCatch, liveTenantIcon,
		liveEpisodePage, supersededCreatorIcon, abandonedObject,
	}
	for _, key := range stored {
		if _, err := store.Upload(ctx, storage.UploadRequest{
			ObjectKey:   key,
			ContentType: "image/webp",
			Data:        []byte("image bytes"),
		}); err != nil {
			t.Fatalf("upload %s: %v", key, err)
		}
	}

	reclaimer := orphanimages.New(env.DB, store)

	// A cutoff behind everything just uploaded: nothing is old enough to be a
	// candidate, which is the guard that keeps an upload still in flight out
	// of a sweep.
	tooNew, err := reclaimer.Run(ctx, orphanimages.Options{
		Prefix: sweepPrefix,
		Cutoff: time.Now().UTC().Add(-time.Hour),
	})
	if err != nil {
		t.Fatalf("Run with a cutoff behind every object: %v", err)
	}
	if tooNew.DeletedCount != 0 {
		t.Fatalf("deleted count = %d, want 0 when every object is newer than the cutoff", tooNew.DeletedCount)
	}
	if got := listKeys(t, ctx, store); !slices.Equal(got, slices.Sorted(slices.Values(stored))) {
		t.Fatalf("stored keys = %v, want every seeded key", got)
	}

	// A cutoff ahead of everything: the same run now sees every object and
	// every image row as settled.
	result, err := reclaimer.Run(ctx, orphanimages.Options{
		Prefix: sweepPrefix,
		Cutoff: time.Now().UTC().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("Run with a cutoff ahead of every object: %v", err)
	}

	if result.RowCount != 1 {
		t.Fatalf("row count = %d, want the one superseded creator image", result.RowCount)
	}
	if result.DeletedCount != 2 {
		t.Fatalf("deleted count = %d, want the superseded and the abandoned object", result.DeletedCount)
	}
	if result.ScannedCount != int64(len(stored)) {
		t.Fatalf("scanned count = %d, want %d", result.ScannedCount, len(stored))
	}

	want := slices.Sorted(slices.Values([]string{
		liveCreatorIcon, liveSeriesEyeCatch, liveLabelEyeCatch, liveTenantIcon, liveEpisodePage,
	}))
	if got := listKeys(t, ctx, store); !slices.Equal(got, want) {
		t.Fatalf("stored keys = %v, want %v", got, want)
	}
	if imageRowExists(t, env.DB, "creator_images", supersededImageID) {
		t.Fatal("the superseded creator_images row survived the run")
	}

	// Reclamation is idempotent: with nothing left unreferenced, a second run
	// over the same cutoff removes nothing.
	again, err := reclaimer.Run(ctx, orphanimages.Options{
		Prefix: sweepPrefix,
		Cutoff: time.Now().UTC().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if again.RowCount != 0 || again.DeletedCount != 0 {
		t.Fatalf("second run removed (%d rows, %d objects), want nothing left to remove", again.RowCount, again.DeletedCount)
	}
}

func listKeys(t *testing.T, ctx context.Context, store *s3.Storage) []string {
	t.Helper()

	keys := make([]string, 0)
	cursor := ""
	for {
		page, err := store.List(ctx, storage.ListRequest{Prefix: sweepPrefix, Cursor: cursor})
		if err != nil {
			t.Fatalf("list stored objects: %v", err)
		}
		for _, object := range page.Objects {
			keys = append(keys, object.ObjectKey)
		}
		if page.NextCursor == "" {
			slices.Sort(keys)
			return keys
		}
		cursor = page.NextCursor
	}
}

func imageRowExists(t *testing.T, db *sql.DB, table string, id uuid.UUID) bool {
	t.Helper()

	var exists bool
	// table is one of this file's own literals, never test input.
	if err := db.QueryRowContext(t.Context(),
		"SELECT EXISTS (SELECT 1 FROM "+table+" WHERE id = $1)", id).Scan(&exists); err != nil {
		t.Fatalf("check %s row %s: %v", table, id, err)
	}
	return exists
}

// seedCreatorImage stores one creator icon and its single variant, pointing the
// creator at it when inUse. Returns the creator_images id.
func seedCreatorImage(t *testing.T, db *sql.DB, tenantID, creatorID uuid.UUID, objectKey string, inUse bool) uuid.UUID {
	t.Helper()

	imageID := uuid.Must(uuid.NewV7())
	exec(t, db, `
		INSERT INTO creator_images (id, tenant_id, creator_id)
		VALUES ($1, $2, $3)
	`, imageID, tenantID, creatorID)
	exec(t, db, `
		INSERT INTO creator_image_variants (
			id, tenant_id, creator_image_id, label, storage_provider, object_key,
			content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, $3, 'original', 's3', $4, 'image/webp', 1024, 512, 512)
	`, uuid.Must(uuid.NewV7()), tenantID, imageID, objectKey)
	if inUse {
		exec(t, db, `UPDATE creators SET icon_image_id = $1 WHERE id = $2`, imageID, creatorID)
	}
	return imageID
}

func seedSeriesImage(t *testing.T, db *sql.DB, tenantID, seriesID uuid.UUID, objectKey string, inUse bool) uuid.UUID {
	t.Helper()

	imageID := uuid.Must(uuid.NewV7())
	exec(t, db, `
		INSERT INTO series_images (id, tenant_id, series_id)
		VALUES ($1, $2, $3)
	`, imageID, tenantID, seriesID)
	exec(t, db, `
		INSERT INTO series_image_variants (
			id, tenant_id, series_image_id, label, variant_type, storage_provider,
			object_key, content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, $3, 'portrait-640', 'portrait', 's3', $4, 'image/webp', 1024, 640, 960)
	`, uuid.Must(uuid.NewV7()), tenantID, imageID, objectKey)
	if inUse {
		exec(t, db, `UPDATE series SET eye_catch_image_id = $1 WHERE id = $2`, imageID, seriesID)
	}
	return imageID
}

func seedLabelImage(t *testing.T, db *sql.DB, tenantID, labelID uuid.UUID, objectKey string, inUse bool) uuid.UUID {
	t.Helper()

	imageID := uuid.Must(uuid.NewV7())
	exec(t, db, `
		INSERT INTO label_images (id, tenant_id, label_id)
		VALUES ($1, $2, $3)
	`, imageID, tenantID, labelID)
	exec(t, db, `
		INSERT INTO label_image_variants (
			id, tenant_id, label_image_id, label, variant_type, storage_provider,
			object_key, content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, $3, 'portrait-640', 'portrait', 's3', $4, 'image/webp', 1024, 640, 960)
	`, uuid.Must(uuid.NewV7()), tenantID, imageID, objectKey)
	if inUse {
		exec(t, db, `UPDATE labels SET eye_catch_image_id = $1 WHERE id = $2`, imageID, labelID)
	}
	return imageID
}

// seedTenantImage stores one branding image and its single variant, pointing
// the tenant theme's icon slot at it when inUse.
func seedTenantImage(t *testing.T, db *sql.DB, tenantID uuid.UUID, objectKey string, inUse bool) uuid.UUID {
	t.Helper()

	imageID := uuid.Must(uuid.NewV7())
	exec(t, db, `
		INSERT INTO tenant_images (id, tenant_id)
		VALUES ($1, $2)
	`, imageID, tenantID)
	exec(t, db, `
		INSERT INTO tenant_image_variants (
			id, tenant_id, tenant_image_id, label, variant_type, storage_provider,
			object_key, content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, $3, 'icon-192', 'icon', 's3', $4, 'image/webp', 1024, 192, 192)
	`, uuid.Must(uuid.NewV7()), tenantID, imageID, objectKey)
	if inUse {
		exec(t, db, `
			INSERT INTO tenant_themes (tenant_id, icon_image_id)
			VALUES ($1, $2)
			ON CONFLICT (tenant_id) DO UPDATE SET icon_image_id = EXCLUDED.icon_image_id
		`, tenantID, imageID)
	}
	return imageID
}

// seedEpisodeImage stores one episode page image under a known object key. Its
// row is reachable from the episode by existing at all, so it has no in-use
// flag: an episode owns every image filed under it.
func seedEpisodeImage(t *testing.T, db *sql.DB, tenantID, episodeID uuid.UUID, objectKey string) uuid.UUID {
	t.Helper()

	imageID := uuid.Must(uuid.NewV7())
	exec(t, db, `
		INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
		VALUES ($1, $2, $3, 1)
	`, imageID, tenantID, episodeID)
	exec(t, db, `
		INSERT INTO episode_image_variants (
			id, episode_image_id, label, storage_provider, object_key,
			content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, 'original', 's3', $3, 'image/webp', 1024, 1200, 1800)
	`, uuid.Must(uuid.NewV7()), imageID, objectKey)
	return imageID
}

func exec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}
