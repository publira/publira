package platformapi

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	publirasplatformv1 "github.com/publira/publira/server/internal/proto/gen/publira/platform/v1"
)

func newStorageActorContext() context.Context {
	return context.WithValue(context.Background(), platformActorContextKey{}, platformActor{
		UserID: uuid.Must(uuid.NewV7()),
		Role:   "platform_operator",
		Email:  "platform@example.com",
	})
}

// A configuration that addresses no bucket is refused before the save reaches
// the row, so a stored configuration is always one that names something. The
// refusal names the field at fault.
func TestUpdatePlatformStorageSettingsRefusesAConfigurationBeforeItIsWritten(t *testing.T) {
	for _, tc := range []struct {
		name  string
		field string
		req   *publirasplatformv1.UpdatePlatformStorageSettingsRequest
	}{
		{
			name:  "no bucket",
			field: "bucket",
			req:   &publirasplatformv1.UpdatePlatformStorageSettingsRequest{Region: "ap-northeast-1"},
		},
		{
			name:  "a bucket name S3 refuses",
			field: "bucket",
			req:   &publirasplatformv1.UpdatePlatformStorageSettingsRequest{Bucket: "Publira_Objects", Region: "ap-northeast-1"},
		},
		{
			name:  "no region",
			field: "region",
			req:   &publirasplatformv1.UpdatePlatformStorageSettingsRequest{Bucket: "publira-objects"},
		},
		{
			name:  "an endpoint that is not a URL",
			field: "endpoint",
			req:   &publirasplatformv1.UpdatePlatformStorageSettingsRequest{Bucket: "publira-objects", Region: "ap-northeast-1", Endpoint: "s3.example.com"},
		},
		{
			name:  "a public base URL with a query",
			field: "public_base_url",
			req:   &publirasplatformv1.UpdatePlatformStorageSettingsRequest{Bucket: "publira-objects", Region: "ap-northeast-1", PublicBaseUrl: "https://cdn.example.com/?v=1"},
		},
		{
			name:  "a revision no read could have answered",
			field: "expected_revision",
			req:   &publirasplatformv1.UpdatePlatformStorageSettingsRequest{Bucket: "publira-objects", Region: "ap-northeast-1", ExpectedRevision: -1},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)

			_, err := server.UpdatePlatformStorageSettings(newStorageActorContext(), connect.NewRequest(tc.req))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdatePlatformStorageSettings code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
			assertFieldViolation(t, err, tc.field)
			assertOperatorHandlerExpectations(t, mock)
		})
	}
}

func TestTestPlatformStorageConnectionRefusesAConfigurationBeforeItIsTested(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)
	server.storageTester = &recordingTester{checks: passingChecks()}

	_, err := server.TestPlatformStorageConnection(newStorageActorContext(), connect.NewRequest(&publirasplatformv1.TestPlatformStorageConnectionRequest{
		Region: "ap-northeast-1",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("TestPlatformStorageConnection code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
	}
	assertFieldViolation(t, err, "bucket")
	if _, _, calls := server.storageTester.(*recordingTester).snapshot(); calls != 0 {
		t.Fatal("a configuration that addresses no bucket reached the store")
	}
	assertOperatorHandlerExpectations(t, mock)
}

// A process wired without a tester cannot answer what a bucket would do, and
// saying so is better than reporting checks nothing performed.
func TestTestPlatformStorageConnectionFailsWithoutATester(t *testing.T) {
	server, mock := newOperatorHandlerTestServer(t)

	_, err := server.TestPlatformStorageConnection(newStorageActorContext(), connect.NewRequest(&publirasplatformv1.TestPlatformStorageConnectionRequest{
		Bucket: "publira-objects",
		Region: "ap-northeast-1",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("TestPlatformStorageConnection code = %v, want internal (err=%v)", connect.CodeOf(err), err)
	}
	assertOperatorHandlerExpectations(t, mock)
}
