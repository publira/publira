package platformstorage_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"slices"
	"testing"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/secretcrypto"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/storage"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/storagesettings"
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

	// A pinned store stays where it was pinned, so the variants of one image
	// cannot be split across a save.
	pinned, err := storage.Pin(ctx, provider)
	if err != nil {
		t.Fatalf("Pin: %v", err)
	}
	s3.SavePlatformStorage(t, pg.DB, s3.Bucket)
	if _, err := pinned.Upload(ctx, storage.UploadRequest{ObjectKey: "tenants/x/pinned.txt", ContentType: "text/plain", Data: []byte("pinned")}); err != nil {
		t.Fatalf("Upload through the pinned store: %v", err)
	}
	s3.SavePlatformStorage(t, pg.DB, secondBucket)

	assertKeys(t, s3, s3.Bucket, "tenants/x/first.txt")
	assertKeys(t, s3, secondBucket, "tenants/x/pinned.txt", "tenants/x/second.txt")

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
	if len(page.Objects) != 2 {
		t.Fatalf("List = %+v, want the two objects in %s", page.Objects, secondBucket)
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

// The Platform Console tests the settings on its form, and publiractl storage
// test the saved ones; given the same settings, the store answers each with
// the same checks, whether it takes the probe or refuses it.
func TestTheConsoleAndTheSavedSettingsRunTheSameChecks(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	db := pg.OpenPlatformDB(t)
	s3 := testutil.StartRustFS(t)
	s3.CreateNamedBucket(t, "platformstorage-checks")
	encryptor, err := secretcrypto.NewManager(map[string][]byte{"k1": bytes.Repeat([]byte{1}, 32)}, "k1")
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	q := dbmodels.New(db)
	tester := platformstorage.Tester{Encryptor: encryptor, Store: s3storage.NewConnectionTester(), Recorder: auditlog.New(q, slog.Default())}
	ctx := context.Background()

	for _, bucket := range []string{"platformstorage-checks", "platformstorage-missing"} {
		settings := storagesettings.Settings{Bucket: bucket, Region: s3.Region, Endpoint: s3.Endpoint, ForcePathStyle: true}
		if _, err := platformstorage.Save(ctx, db, slog.Default(), encryptor, auditlog.SystemPlatformActor, platformstorage.SaveParams{
			Settings:        settings,
			AccessKeyID:     s3.AccessKey,
			SecretMode:      secretupdate.Replace,
			SecretAccessKey: s3.SecretKey,
		}); err != nil {
			t.Fatalf("Save %s: %v", bucket, err)
		}
		console, err := tester.Test(ctx, q, auditlog.SystemPlatformActor, platformstorage.TestParams{
			Settings:    settings,
			AccessKeyID: s3.AccessKey,
			SecretMode:  secretupdate.Unchanged,
		})
		if err != nil {
			t.Fatalf("Test %s: %v", bucket, err)
		}
		saved, err := tester.TestSaved(ctx, q, auditlog.SystemPlatformActor)
		if err != nil {
			t.Fatalf("TestSaved %s: %v", bucket, err)
		}
		if !slices.Equal(console, saved) {
			t.Fatalf("%s: the console's checks %+v, the saved settings' %+v", bucket, console, saved)
		}
		if len(console) == 0 {
			t.Fatalf("%s: no checks were run", bucket)
		}
	}
}

func TestTestSavedWithNothingSaved(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	q := dbmodels.New(pg.OpenPlatformDB(t))
	tester := platformstorage.Tester{Store: s3storage.NewConnectionTester(), Recorder: auditlog.New(q, slog.Default())}

	if _, err := tester.TestSaved(context.Background(), q, auditlog.SystemPlatformActor); !errors.Is(err, platformstorage.ErrNotSaved) {
		t.Fatalf("TestSaved = %v, want ErrNotSaved", err)
	}
}
