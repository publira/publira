package platformstorage

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/storage"
)

type fakeQuerier struct {
	row   dbmodels.PlatformStorageConfig
	found bool
	err   error
	reads int
}

func (q *fakeQuerier) GetPlatformStorageConfig(context.Context) (dbmodels.PlatformStorageConfig, error) {
	q.reads++
	if q.err != nil {
		return dbmodels.PlatformStorageConfig{}, q.err
	}
	if !q.found {
		return dbmodels.PlatformStorageConfig{}, sql.ErrNoRows
	}
	return q.row, nil
}

func (q *fakeQuerier) save(bucket string, revision int64) {
	q.found = true
	q.row = dbmodels.PlatformStorageConfig{
		Singleton: true,
		Bucket:    bucket,
		Region:    "us-east-1",
		Revision:  revision,
		UpdatedAt: time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC).Add(time.Duration(revision) * time.Second),
	}
}

type fakeSecrets struct{}

func (fakeSecrets) DecryptString(value string) (string, error) {
	return "decrypted:" + value, nil
}

// recorder is a Build that answers the snapshot it was given, so a test can
// see both what was built and how many times.
type recorder struct {
	builds []Snapshot
	err    error
}

func (r *recorder) build(_ context.Context, snapshot Snapshot) (Snapshot, error) {
	if r.err != nil {
		return Snapshot{}, r.err
	}
	r.builds = append(r.builds, snapshot)
	return snapshot, nil
}

type clock struct{ now time.Time }

func (c *clock) advance(d time.Duration) { c.now = c.now.Add(d) }

func newTestResolver(q *fakeQuerier, secrets SecretManager, rec *recorder) (*Resolver[Snapshot], *clock) {
	c := &clock{now: time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)}
	r := New(Config{Queries: q, Secrets: secrets, Interval: time.Minute}, rec.build)
	r.now = func() time.Time { return c.now }
	return r, c
}

func TestResolveAnswersNotConfiguredUntilARowIsSaved(t *testing.T) {
	q := &fakeQuerier{}
	rec := &recorder{}
	r, c := newTestResolver(q, nil, rec)

	if _, _, err := r.Resolve(context.Background()); !errors.Is(err, storage.ErrNotConfigured) {
		t.Fatalf("Resolve error = %v, want %v", err, storage.ErrNotConfigured)
	}

	q.save("publira-first", 1)
	if _, _, err := r.Resolve(context.Background()); !errors.Is(err, storage.ErrNotConfigured) {
		t.Fatalf("Resolve within the interval error = %v, want the cached %v", err, storage.ErrNotConfigured)
	}

	c.advance(time.Minute)
	got, bucket, err := r.Resolve(context.Background())
	if err != nil {
		t.Fatalf("Resolve after the interval: %v", err)
	}
	if bucket != "publira-first" || got.Settings.Bucket != "publira-first" {
		t.Fatalf("Resolve = %q (built for %q), want publira-first", bucket, got.Settings.Bucket)
	}
}

func TestResolveRebuildsOnlyWhenTheSavedRowChanges(t *testing.T) {
	q := &fakeQuerier{}
	q.save("publira-first", 1)
	rec := &recorder{}
	r, c := newTestResolver(q, nil, rec)

	for range 3 {
		if _, _, err := r.Resolve(context.Background()); err != nil {
			t.Fatalf("Resolve: %v", err)
		}
	}
	if q.reads != 1 {
		t.Fatalf("reads within the interval = %d, want 1", q.reads)
	}

	c.advance(time.Minute)
	if _, _, err := r.Resolve(context.Background()); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if q.reads != 2 || len(rec.builds) != 1 {
		t.Fatalf("reads = %d, builds = %d, want the row reread and the client kept", q.reads, len(rec.builds))
	}

	q.save("publira-second", 2)
	c.advance(time.Minute)
	_, bucket, err := r.Resolve(context.Background())
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if bucket != "publira-second" || len(rec.builds) != 2 {
		t.Fatalf("bucket = %q, builds = %d, want a rebuild for publira-second", bucket, len(rec.builds))
	}
}

func TestResolveServesTheLastBuildWhenARereadFails(t *testing.T) {
	q := &fakeQuerier{}
	q.save("publira-first", 1)
	rec := &recorder{}
	r, c := newTestResolver(q, nil, rec)

	if _, _, err := r.Resolve(context.Background()); err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	q.err = errors.New("connection refused")
	c.advance(time.Minute)
	_, bucket, err := r.Resolve(context.Background())
	if err != nil || bucket != "publira-first" {
		t.Fatalf("Resolve = %q, %v, want the last build of publira-first", bucket, err)
	}
	// The failure waits out an interval too, so an outage is one query per
	// interval rather than one per upload.
	if _, _, err := r.Resolve(context.Background()); err != nil || q.reads != 2 {
		t.Fatalf("reads = %d, err = %v, want no second reread within the interval", q.reads, err)
	}
}

func TestResolveFailsWhenTheFirstReadFails(t *testing.T) {
	readErr := errors.New("connection refused")
	r, _ := newTestResolver(&fakeQuerier{err: readErr}, nil, &recorder{})

	if _, _, err := r.Resolve(context.Background()); !errors.Is(err, readErr) {
		t.Fatalf("Resolve error = %v, want %v", err, readErr)
	}
}

// A saved row that cannot be built from replaces nothing: answering with the
// configuration it replaced would leave an operator believing the change took.
func TestResolveDoesNotKeepTheOldBuildWhenTheNewRowFails(t *testing.T) {
	q := &fakeQuerier{}
	q.save("publira-first", 1)
	rec := &recorder{}
	r, c := newTestResolver(q, nil, rec)

	if _, _, err := r.Resolve(context.Background()); err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	q.save("publira-second", 2)
	q.row.AccessKeyID = sql.NullString{String: "AKIAEXAMPLE", Valid: true}
	q.row.SecretAccessKeyEncrypted = sql.NullString{String: "ciphertext", Valid: true}
	c.advance(time.Minute)
	if _, _, err := r.Resolve(context.Background()); !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("Resolve error = %v, want %v", err, ErrSecretManagerUnavailable)
	}
	if _, _, err := r.Resolve(context.Background()); !errors.Is(err, ErrSecretManagerUnavailable) {
		t.Fatalf("second Resolve error = %v, want %v again", err, ErrSecretManagerUnavailable)
	}
}

func TestResolveHandsTheDecryptedCredentialToBuild(t *testing.T) {
	q := &fakeQuerier{}
	q.save("publira-first", 1)
	q.row.AccessKeyID = sql.NullString{String: "AKIAEXAMPLE", Valid: true}
	q.row.SecretAccessKeyEncrypted = sql.NullString{String: "ciphertext", Valid: true}
	rec := &recorder{}
	r, _ := newTestResolver(q, fakeSecrets{}, rec)

	got, _, err := r.Resolve(context.Background())
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.Credentials.AccessKeyID != "AKIAEXAMPLE" || got.Credentials.SecretAccessKey != "decrypted:ciphertext" {
		t.Fatalf("built with %q / %q, want the decrypted credential", got.Credentials.AccessKeyID, got.Credentials.SecretAccessKey)
	}
	if cfg := got.S3Config(); cfg.AccessKeyID != "AKIAEXAMPLE" || cfg.SecretAccessKey != "decrypted:ciphertext" || cfg.Bucket != "publira-first" {
		t.Fatalf("S3Config = %+v, want the snapshot's bucket and credential", cfg)
	}
}

func TestResolveRetriesABuildThatFailed(t *testing.T) {
	q := &fakeQuerier{}
	q.save("publira-first", 1)
	rec := &recorder{err: errors.New("no region")}
	r, _ := newTestResolver(q, nil, rec)

	if _, _, err := r.Resolve(context.Background()); err == nil {
		t.Fatal("Resolve succeeded with a failing build")
	}
	rec.err = nil
	if _, bucket, err := r.Resolve(context.Background()); err != nil || bucket != "publira-first" {
		t.Fatalf("Resolve = %q, %v, want the build retried", bucket, err)
	}
}

func TestProviderAndReclaimersAnswerNotConfigured(t *testing.T) {
	resolver := New(Config{Queries: &fakeQuerier{}}, NewStorage)

	if _, err := (Provider{Resolver: resolver}).Upload(context.Background(), storage.UploadRequest{ObjectKey: "k"}); !errors.Is(err, storage.ErrNotConfigured) {
		t.Fatalf("Upload error = %v, want %v", err, storage.ErrNotConfigured)
	}
	if _, _, err := (Reclaimers{Resolver: resolver}).Reclaimer(context.Background()); !errors.Is(err, storage.ErrNotConfigured) {
		t.Fatalf("Reclaimer error = %v, want %v", err, storage.ErrNotConfigured)
	}
}
