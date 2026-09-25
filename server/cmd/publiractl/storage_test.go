package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageserver"
	"github.com/publira/publira/server/internal/platformstorage"
	"github.com/publira/publira/server/internal/storage"
	s3storage "github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/testutil"
)

// storageCommand runs one storage command against the database
// PUBLIRA_PLATFORM_DB_URL names, and returns its exit code and what it printed.
func storageCommand(t *testing.T, stdin string, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = runGroup(&storageGroup, args, pipedConsole(stdin, &errOut), &out)
	return code, out.String(), errOut.String()
}

func mustStorageCommand(t *testing.T, stdin string, args ...string) string {
	t.Helper()
	code, stdout, stderr := storageCommand(t, stdin, args...)
	if code != 0 {
		t.Fatalf("storage %s: exit code = %d\n%s", strings.Join(args, " "), code, stderr)
	}
	return stdout
}

// storageSetArgs saves bucket on the RustFS store.
func storageSetArgs(s3 *testutil.RustFSEnv, bucket string, extra ...string) []string {
	return append([]string{
		"set",
		"--bucket", bucket,
		"--region", s3.Region,
		"--endpoint", s3.Endpoint,
		"--force-path-style",
	}, extra...)
}

func storedSecretAccessKey(t *testing.T, pg *testutil.PostgresEnv) string {
	t.Helper()
	var encrypted string
	if err := pg.DB.QueryRowContext(context.Background(),
		`SELECT COALESCE(secret_access_key_encrypted, '') FROM platform_storage_config`,
	).Scan(&encrypted); err != nil {
		t.Fatalf("read platform_storage_config: %v", err)
	}
	return encrypted
}

func TestStorageSetKeepsTheSecretAndShowNeverPrintsIt(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)
	settings := []string{"set", "--bucket", "publira-objects", "--region", "ap-northeast-1"}

	if got := mustStorageCommand(t, "", "show"); got != "No object store is saved\n" {
		t.Fatalf("show before a save = %q", got)
	}
	if got := mustStorageCommand(t, testSecretValue+"\n", append(settings, "--access-key-id", "AKIAEXAMPLE", "--secret-access-key-stdin")...); got != "Saved the object store publira-objects, revision 1\n" {
		t.Fatalf("set = %q", got)
	}
	saved := storedSecretAccessKey(t, pg)
	// No --secret-access-key-stdin and no terminal to prompt on keeps the
	// saved one.
	mustStorageCommand(t, "", append(settings, "--access-key-id", "AKIAEXAMPLE", "--public-base-url", "https://cdn.example.com")...)
	if got := storedSecretAccessKey(t, pg); got != saved {
		t.Fatal("a set that gave no secret replaced the saved one")
	}

	show := mustStorageCommand(t, "", "show")
	if strings.Contains(show, testSecretValue) || strings.Contains(show, saved) {
		t.Fatalf("show printed the secret access key:\n%s", show)
	}
	for _, want := range []string{
		"Bucket:             publira-objects\n",
		"Public base URL:    https://cdn.example.com\n",
		"Access key ID:      AKIAEXAMPLE\n",
		"Secret access key:  saved\n",
		"Revision:           2\n",
	} {
		if !strings.Contains(show, want) {
			t.Fatalf("show = \n%s\nwant a line %q", show, want)
		}
	}

	// Leaving the access key out signs with each process's own credential,
	// and the saved one goes.
	mustStorageCommand(t, "", settings...)
	if got := storedSecretAccessKey(t, pg); got != "" {
		t.Fatal("a set without --access-key-id kept the secret access key")
	}
	if show := mustStorageCommand(t, "", "show"); !strings.Contains(show, "Secret access key:  not saved\n") {
		t.Fatalf("show after the ambient credential = \n%s", show)
	}

	// Saving what is already saved changes nothing, so rerunning a setup
	// script leaves the revision and the audit log as they were.
	if got := mustStorageCommand(t, "", settings...); got != "Saved the object store publira-objects, revision 3\n" {
		t.Fatalf("an unchanged set = %q, want revision 3 again", got)
	}
	if got := platformActions(t, pg); got != "platform_storage_settings_updated,platform_storage_settings_updated,platform_storage_settings_updated" {
		t.Fatalf("audit actions = %s", got)
	}
}

// A refusal names the flag the Connect adapter names as a field, and nothing is
// written.
func TestStorageSetNamesTheRefusedFlag(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)

	for _, tc := range []struct {
		name  string
		stdin string
		args  []string
		want  string
	}{
		{name: "no bucket", args: []string{"--region", "us-east-1"}, want: "--bucket: bucket is required"},
		{name: "no region", args: []string{"--bucket", "publira-objects"}, want: "--region: region is required"},
		{
			name: "an endpoint that is no URL",
			args: []string{"--bucket", "publira-objects", "--region", "us-east-1", "--endpoint", "s3.example.com"},
			want: "--endpoint: endpoint must be an http or https URL",
		},
		{
			name: "a public base URL with a query",
			args: []string{"--bucket", "publira-objects", "--region", "us-east-1", "--public-base-url", "https://cdn.example.com/?v=1"},
			want: "--public-base-url: public_base_url must not carry a query or a fragment",
		},
		{
			name: "an access key with no secret",
			args: []string{"--bucket", "publira-objects", "--region", "us-east-1", "--access-key-id", "AKIAEXAMPLE"},
			want: "--secret-access-key-stdin: secret_access_key is required alongside an access key id",
		},
		{
			name:  "a secret with no access key",
			stdin: testSecretValue,
			args:  []string{"--bucket", "publira-objects", "--region", "us-east-1", "--secret-access-key-stdin"},
			want:  "--access-key-id: access_key_id is required alongside a secret access key",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, _, stderr := storageCommand(t, tc.stdin, append([]string{"set"}, tc.args...)...)
			if code != 1 || !strings.Contains(stderr, tc.want) {
				t.Fatalf("exit code = %d, stderr = %q; want 1 and %q", code, stderr, tc.want)
			}
		})
	}

	mustStorageCommand(t, testSecretValue, "set", "--bucket", "publira-objects", "--region", "us-east-1", "--access-key-id", "AKIAEXAMPLE", "--secret-access-key-stdin")
	code, _, stderr := storageCommand(t, "", "set", "--bucket", "publira-objects", "--region", "us-east-1", "--access-key-id", "AKIAOTHER")
	if want := "--secret-access-key-stdin: secret_access_key must be replaced when access_key_id changes"; code != 1 || !strings.Contains(stderr, want) {
		t.Fatalf("a new access key with the saved secret: exit code = %d, stderr = %q; want 1 and %q", code, stderr, want)
	}
	if got := platformActions(t, pg); got != "platform_storage_settings_updated" {
		t.Fatalf("audit actions = %s, want only the save that landed", got)
	}
}

// storage test signs with the saved secret, runs the Platform Console's four
// checks, and files each run.
func TestStorageTestRunsTheChecksAgainstTheSavedStore(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	setEncryptionKeys(t)
	s3 := testutil.StartRustFS(t)
	s3.CreateNamedBucket(t, "publiractl-storage-test")

	mustStorageCommand(t, s3.SecretKey, storageSetArgs(s3, "publiractl-storage-test", "--access-key-id", s3.AccessKey, "--secret-access-key-stdin")...)
	got := mustStorageCommand(t, "", "test")
	if want := "PutObject     ok\nGetObject     ok\nListObjects   ok\nDeleteObject  ok\n"; got != want {
		t.Fatalf("test = \n%s\nwant\n%s", got, want)
	}

	// A bucket the store does not have refuses the write, and nothing after it
	// has an object to work on.
	mustStorageCommand(t, "", storageSetArgs(s3, "publiractl-missing", "--access-key-id", s3.AccessKey)...)
	code, stdout, stderr := storageCommand(t, "", "test")
	if want := "PutObject     failed: STORAGE_TEST_BUCKET_NOT_FOUND\nGetObject     skipped\nListObjects   skipped\nDeleteObject  skipped\n"; code != 1 || stdout != want {
		t.Fatalf("test of a missing bucket: exit code = %d, stdout = \n%s\nwant 1 and\n%s", code, stdout, want)
	}
	if !strings.Contains(stderr, "the object store refused the connection test (STORAGE_TEST_BUCKET_NOT_FOUND)") {
		t.Fatalf("stderr = %q", stderr)
	}

	var outcomes string
	if err := pg.DB.QueryRowContext(context.Background(), `
		SELECT string_agg(outcome || ':' || COALESCE(reason, ''), ',' ORDER BY id)
		FROM platform_audit_logs WHERE action = 'platform_storage_connection_tested'
	`).Scan(&outcomes); err != nil {
		t.Fatalf("read the test entries: %v", err)
	}
	if outcomes != "success:,failure:STORAGE_TEST_BUCKET_NOT_FOUND" {
		t.Fatalf("test entries = %s", outcomes)
	}
}

func TestStorageTestWithNothingSaved(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)

	code, _, stderr := storageCommand(t, "", "test")
	if code != 1 || !strings.Contains(stderr, platformstorage.ErrNotSaved.Error()) {
		t.Fatalf("exit code = %d, stderr = %q; want 1 and %q", code, stderr, platformstorage.ErrNotSaved)
	}
}

// A running api-server uploads to, and a running image server reads from, the
// store storage set saves, and follow it to the next one without a restart.
// Both resolve the row as they do in production, only rereading it on every
// call rather than every platformstorage.RefreshInterval.
func TestStorageSetReachesRunningServers(t *testing.T) {
	pg := testutil.StartPostgres(t)
	pg.Reset(t)
	t.Setenv("PUBLIRA_PLATFORM_DB_URL", pg.PlatformURL)
	s3 := testutil.StartRustFS(t)
	for key, value := range s3.DeploymentEnv() {
		t.Setenv(key, value)
	}
	s3.CreateNamedBucket(t, "publiractl-running-a")
	s3.CreateNamedBucket(t, "publiractl-running-b")
	ctx := context.Background()

	uploads := platformstorage.Provider{Resolver: platformstorage.New(platformstorage.Config{
		Queries:  dbmodels.New(pg.OpenPlatformDB(t)),
		Interval: -1,
	}, platformstorage.NewStorage)}
	images := platformstorage.New(platformstorage.Config{
		Queries:  dbmodels.New(pg.OpenAdminDB(t)),
		Interval: -1,
	}, func(ctx context.Context, snapshot platformstorage.Snapshot) (imageserver.ObjectStore, error) {
		client, err := s3storage.NewClient(ctx, snapshot.S3Config())
		if err != nil {
			return nil, err
		}
		return imageserver.NewS3Store(client, snapshot.Settings.Bucket), nil
	})
	roundTrip := func(key, body string) {
		t.Helper()
		if _, err := uploads.Upload(ctx, storage.UploadRequest{ObjectKey: key, ContentType: "text/plain", Data: []byte(body)}); err != nil {
			t.Fatalf("Upload %s: %v", key, err)
		}
		resolved, err := images.Resolve(ctx)
		if err != nil {
			t.Fatalf("resolve the image store: %v", err)
		}
		object, err := resolved.Value.GetObject(ctx, key)
		if err != nil {
			t.Fatalf("GetObject %s: %v", key, err)
		}
		defer object.Body.Close() //nolint:errcheck
		if got, err := io.ReadAll(object.Body); err != nil || string(got) != body {
			t.Fatalf("GetObject %s = %q, %v; want %q", key, got, err, body)
		}
	}

	if _, err := uploads.Upload(ctx, storage.UploadRequest{ObjectKey: "tenants/x/before.txt", Data: []byte("x")}); err == nil {
		t.Fatal("Upload succeeded before any object store was saved")
	}
	mustStorageCommand(t, "", storageSetArgs(s3, "publiractl-running-a")...)
	roundTrip("tenants/x/first.txt", "first")

	mustStorageCommand(t, "", storageSetArgs(s3, "publiractl-running-b")...)
	roundTrip("tenants/x/second.txt", "second")
	resolved, err := images.Resolve(ctx)
	if err != nil {
		t.Fatalf("resolve the image store: %v", err)
	}
	if _, err := resolved.Value.GetObject(ctx, "tenants/x/first.txt"); !errors.Is(err, imageserver.ErrObjectNotFound) {
		t.Fatalf("GetObject of the first bucket's object = %v, want ErrObjectNotFound from the second", err)
	}
}

func TestStorageSetHelpSaysWhenTheSecretIsAskedFor(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := runGroup(&storageGroup, []string{"set", "--help"}, pipedConsole("", &errOut), &out); code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	for _, want := range []string{
		"left out, every process signs with its own AWS credential",
		"The saved secret access key is kept when it is left blank at the prompt",
	} {
		if !strings.Contains(errOut.String(), want) {
			t.Fatalf("help = \n%s\nwant %q", errOut.String(), want)
		}
	}
}
