package platformstorage_test

import (
	"context"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/storage"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/testutil"
)

const secondBucket = "publira-test-moved"

// An operator who moves the platform to another bucket moves every process
// with it: the next upload after a reread lands in the bucket now saved, with
// no process environment edited in between. The tenant console's pool reads
// the row, as the image server's does.
func TestProviderFollowsTheSavedBucket(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	s3 := testutil.StartRustFS(t)
	s3.CreateBucket(t)
	s3.CreateNamedBucket(t, secondBucket)

	resolver := platformstorage.New(platformstorage.Config{
		Queries:  dbmodels.New(pg.OpenAdminDB(t)),
		Interval: -1,
	}, platformstorage.NewStorage)
	provider := platformstorage.Provider{Resolver: resolver}
	ctx := context.Background()

	if _, err := provider.Upload(ctx, storage.UploadRequest{ObjectKey: "tenants/x/before.txt", Data: []byte("x")}); err == nil {
		t.Fatal("Upload succeeded before any storage was saved")
	}

	s3.SavePlatformStorage(t, pg.DB, s3.Bucket)
	if _, err := provider.Upload(ctx, storage.UploadRequest{ObjectKey: "tenants/x/first.txt", ContentType: "text/plain", Data: []byte("first")}); err != nil {
		t.Fatalf("Upload to the first bucket: %v", err)
	}

	s3.SavePlatformStorage(t, pg.DB, secondBucket)
	if _, err := provider.Upload(ctx, storage.UploadRequest{ObjectKey: "tenants/x/second.txt", ContentType: "text/plain", Data: []byte("second")}); err != nil {
		t.Fatalf("Upload to the second bucket: %v", err)
	}

	assertKeys(t, s3, s3.Bucket, "tenants/x/first.txt")
	assertKeys(t, s3, secondBucket, "tenants/x/second.txt")

	// The sweep resolves the same bucket, named for its log.
	reclaimer, bucket, err := platformstorage.Reclaimers{Resolver: platformstorage.New(platformstorage.Config{
		Queries: dbmodels.New(pg.OpenContentStatsDB(t)),
	}, platformstorage.NewStorage)}.Reclaimer(ctx)
	if err != nil {
		t.Fatalf("Reclaimer: %v", err)
	}
	if bucket != secondBucket {
		t.Fatalf("Reclaimer bucket = %q, want %q", bucket, secondBucket)
	}
	page, err := reclaimer.List(ctx, storage.ListRequest{Prefix: "tenants/x/"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(page.Objects) != 1 || page.Objects[0].ObjectKey != "tenants/x/second.txt" {
		t.Fatalf("List = %+v, want only tenants/x/second.txt", page.Objects)
	}
}

func assertKeys(t *testing.T, env *testutil.RustFSEnv, bucket string, want ...string) {
	t.Helper()
	store, err := s3storage.New(context.Background(), s3storage.Config{
		Bucket:         bucket,
		Region:         env.Region,
		Endpoint:       env.Endpoint,
		ForcePathStyle: true,
	})
	if err != nil {
		t.Fatalf("s3.New(%s): %v", bucket, err)
	}
	page, err := store.List(context.Background(), storage.ListRequest{Prefix: "tenants/x/"})
	if err != nil {
		t.Fatalf("List %s: %v", bucket, err)
	}
	got := make([]string, 0, len(page.Objects))
	for _, object := range page.Objects {
		got = append(got, object.ObjectKey)
	}
	if len(got) != len(want) {
		t.Fatalf("%s holds %v, want %v", bucket, got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%s holds %v, want %v", bucket, got, want)
		}
	}
}
