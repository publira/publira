package maintenancejobs_test

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/storage"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/testutil"
)

var purgeKinds = map[string]time.Duration{
	"maintenance.purge_content_events":     24 * time.Hour,
	"maintenance.purge_ranking_snapshots":  24 * time.Hour,
	"maintenance.purge_mfa_challenges":     time.Hour,
	"maintenance.purge_withdrawn_comments": time.Hour,
	"maintenance.purge_orphan_images":      24 * time.Hour,
}

// A started worker runs every purge without anything else enqueueing one, and
// the orphan image sweep reclaims the bucket saved in the platform's settings.
// A restart inside the same interval runs none of them again, so a deploy is
// not a sweep of the whole bucket.
func TestWorkerRunsEveryPurgeOncePerInterval(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	rustfs := testutil.StartRustFS(t)
	rustfs.CreateBucket(t)
	rustfs.SavePlatformStorage(t, pg.DB, rustfs.Bucket)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	store, err := s3storage.New(ctx, s3storage.Config{
		Bucket:         rustfs.Bucket,
		Region:         rustfs.Region,
		Endpoint:       rustfs.Endpoint,
		ForcePathStyle: true,
	})
	if err != nil {
		t.Fatalf("s3.New: %v", err)
	}

	tenant := pg.SeedTenant(t, "MAINTPURGE01", "maintenancepurge.example.com", "Maintenance Purge Tenant")
	creator := pg.SeedCreator(t, tenant.ID, testutil.CreatorSeed{PublicID: "CREATOR00001"})

	liveIcon := "tenants/MAINTPURGE01/creators/CREATOR00001/live-original.webp"
	seedCreatorImage(t, pg.DB, tenant.ID, creator.ID, liveIcon, true)
	supersededIcon := "tenants/MAINTPURGE01/creators/CREATOR00001/superseded-original.webp"
	supersededImageID := seedCreatorImage(t, pg.DB, tenant.ID, creator.ID, supersededIcon, false)
	abandonedObject := "tenants/MAINTPURGE01/creators/CREATOR00001/rolled-back-original.webp"
	for _, key := range []string{liveIcon, supersededIcon, abandonedObject} {
		if _, err := store.Upload(ctx, storage.UploadRequest{
			ObjectKey:   key,
			ContentType: "image/webp",
			Data:        []byte("image bytes"),
		}); err != nil {
			t.Fatalf("upload %s: %v", key, err)
		}
	}

	source := agedSource{inner: platformstorage.Reclaimers{Resolver: platformstorage.New(platformstorage.Config{
		Queries: dbmodels.New(pg.OpenContentStatsDB(t)),
	}, platformstorage.NewStorage)}}

	started := time.Now()
	stop := startWorkerWithMaintenanceJobs(t, pg, source)
	for kind := range purgeKinds {
		waitFor(t, ctx, "a completed "+kind+" row in river_job", func() bool {
			return countJobs(t, ctx, pg.DB, kind, "completed") > 0
		})
	}

	if got := listKeys(t, ctx, store); !slices.Equal(got, []string{liveIcon}) {
		t.Fatalf("stored keys = %v, want only %s", got, liveIcon)
	}
	var supersededRows int
	if err := pg.DB.QueryRowContext(ctx,
		"SELECT count(*) FROM creator_images WHERE id = $1", supersededImageID,
	).Scan(&supersededRows); err != nil {
		t.Fatalf("count superseded creator_images rows: %v", err)
	}
	if supersededRows != 0 {
		t.Fatal("the superseded creator_images row survived the scheduled sweep")
	}

	// The chain head is unique only while a run is in flight, so its second
	// completed row is how the test knows the restarted worker has enqueued
	// its start-up runs.
	stop()
	startWorkerWithMaintenanceJobs(t, pg, source)
	waitFor(t, ctx, "the restarted worker's first pass", func() bool {
		return countJobs(t, ctx, pg.DB, "maintenance.project_episode_reads", "completed") >= 2
	})
	ended := time.Now()

	for kind, interval := range purgeKinds {
		// An interval boundary crossed during the test is a new interval, and
		// a second run in it is what the schedule is for.
		want := int(ended.Truncate(interval).Sub(started.Truncate(interval))/interval) + 1
		if got := countJobs(t, ctx, pg.DB, kind, ""); got > want {
			t.Fatalf("%s rows = %d, want at most %d across a restart inside its interval", kind, got, want)
		}
	}
}

// agedSource reports every stored object as two days old. An object uploaded
// by the test is younger than any minimum age the sweep accepts, and S3 offers
// no way to backdate one.
type agedSource struct{ inner storage.ReclaimerSource }

func (s agedSource) Reclaimer(ctx context.Context) (storage.Reclaimer, string, error) {
	reclaimer, bucket, err := s.inner.Reclaimer(ctx)
	if err != nil {
		return nil, "", err
	}
	return agedReclaimer{Reclaimer: reclaimer}, bucket, nil
}

type agedReclaimer struct{ storage.Reclaimer }

func (r agedReclaimer) List(ctx context.Context, req storage.ListRequest) (storage.ListResult, error) {
	page, err := r.Reclaimer.List(ctx, req)
	for i := range page.Objects {
		page.Objects[i].LastModified = page.Objects[i].LastModified.Add(-48 * time.Hour)
	}
	return page, err
}

// countJobs counts the river_job rows of kind, in state unless it is empty.
func countJobs(t *testing.T, ctx context.Context, db *sql.DB, kind, state string) int {
	t.Helper()
	var rows int
	if err := db.QueryRowContext(ctx,
		"SELECT count(*) FROM river_job WHERE kind = $1 AND ($2 = '' OR state::text = $2)", kind, state,
	).Scan(&rows); err != nil {
		t.Fatalf("count %s jobs: %v", kind, err)
	}
	return rows
}

func listKeys(t *testing.T, ctx context.Context, store *s3storage.Storage) []string {
	t.Helper()
	keys := make([]string, 0)
	cursor := ""
	for {
		page, err := store.List(ctx, storage.ListRequest{Prefix: "tenants/", Cursor: cursor})
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

// seedCreatorImage stores one creator icon, created two days ago, and its
// single variant, pointing the creator at it when inUse. Returns the
// creator_images id.
func seedCreatorImage(t *testing.T, db *sql.DB, tenantID, creatorID uuid.UUID, objectKey string, inUse bool) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	imageID := uuid.Must(uuid.NewV7())
	if _, err := db.ExecContext(ctx, `
		INSERT INTO creator_images (id, tenant_id, creator_id, created_at)
		VALUES ($1, $2, $3, NOW() - INTERVAL '2 days')
	`, imageID, tenantID, creatorID); err != nil {
		t.Fatalf("seed creator image: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO creator_image_variants (
			id, tenant_id, creator_image_id, label, storage_provider, object_key,
			content_type, file_size_bytes, width, height
		)
		VALUES ($1, $2, $3, 'original', 's3', $4, 'image/webp', 1024, 512, 512)
	`, uuid.Must(uuid.NewV7()), tenantID, imageID, objectKey); err != nil {
		t.Fatalf("seed creator image variant: %v", err)
	}
	if inUse {
		if _, err := db.ExecContext(ctx, "UPDATE creators SET icon_image_id = $1 WHERE id = $2", imageID, creatorID); err != nil {
			t.Fatalf("point creator at its icon: %v", err)
		}
	}
	return imageID
}
