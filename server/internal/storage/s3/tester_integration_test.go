package s3_test

import (
	"context"
	"testing"

	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/storagesettings"
	"github.com/publira/publira/server/internal/testutil"
)

func rustFSSettings(env *testutil.RustFSEnv) storagesettings.Settings {
	return storagesettings.Settings{
		Bucket:         env.Bucket,
		Region:         env.Region,
		Endpoint:       env.Endpoint,
		ForcePathStyle: true,
	}
}

func rustFSCredentials(env *testutil.RustFSEnv) storagesettings.Credentials {
	return storagesettings.Credentials{AccessKeyID: env.AccessKey, SecretAccessKey: env.SecretKey}
}

func reasons(checks []storagesettings.Check) map[storagesettings.Operation]string {
	byOperation := make(map[storagesettings.Operation]string, len(checks))
	for _, check := range checks {
		byOperation[check.Operation] = check.Reason
	}
	return byOperation
}

func TestConnectionTesterPerformsEveryOperationAndTakesItsProbeAway_Integration(t *testing.T) {
	env := testutil.StartRustFS(t)
	env.CreateBucket(t)

	checks, err := s3.NewConnectionTester().TestConnection(context.Background(), rustFSSettings(env), rustFSCredentials(env))
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if len(checks) != 4 {
		t.Fatalf("TestConnection() returned %d checks, want one per operation", len(checks))
	}
	for _, check := range checks {
		if !check.Succeeded() {
			t.Fatalf("operation %v was refused with %q", check.Operation, check.Reason)
		}
	}

	// The probe is Publira's own object, and the bucket it was written to is
	// an operator's: a test that leaves one behind leaves one behind on every
	// run.
	store, err := s3.New(context.Background(), s3.Config{
		Bucket:          env.Bucket,
		Region:          env.Region,
		Endpoint:        env.Endpoint,
		AccessKeyID:     env.AccessKey,
		SecretAccessKey: env.SecretKey,
		ForcePathStyle:  true,
	})
	if err != nil {
		t.Fatalf("s3.New: %v", err)
	}
	listed, err := store.List(context.Background(), storage.ListRequest{Prefix: "tenants/_connection-test/"})
	if err != nil {
		t.Fatalf("store.List: %v", err)
	}
	if len(listed.Objects) != 0 {
		t.Fatalf("the test left %d objects behind, want none", len(listed.Objects))
	}
}

func TestConnectionTesterReportsABucketThatIsNotThere_Integration(t *testing.T) {
	env := testutil.StartRustFS(t)
	env.CreateBucket(t)

	settings := rustFSSettings(env)
	settings.Bucket = "publira-no-such-bucket"
	checks, err := s3.NewConnectionTester().TestConnection(context.Background(), settings, rustFSCredentials(env))
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	// Nothing below the write has an object to work on, so the run ends there.
	if len(checks) != 1 {
		t.Fatalf("TestConnection() returned %d checks, want the write alone", len(checks))
	}
	if got := reasons(checks)[storagesettings.OperationPutObject]; got != rpcerrors.ReasonStorageTestBucketNotFound {
		t.Fatalf("the write was refused with %q, want %q", got, rpcerrors.ReasonStorageTestBucketNotFound)
	}
}

func TestConnectionTesterReportsACredentialTheStoreRefused_Integration(t *testing.T) {
	env := testutil.StartRustFS(t)
	env.CreateBucket(t)

	checks, err := s3.NewConnectionTester().TestConnection(context.Background(), rustFSSettings(env), storagesettings.Credentials{
		AccessKeyID:     env.AccessKey,
		SecretAccessKey: "not-the-secret-this-store-signs-with",
	})
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if got := reasons(checks)[storagesettings.OperationPutObject]; got != rpcerrors.ReasonStorageTestCredentials {
		t.Fatalf("the write was refused with %q, want %q", got, rpcerrors.ReasonStorageTestCredentials)
	}
}
