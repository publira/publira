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
// the row, so a stored configuration is always one that names something.
func TestUpdatePlatformStorageSettingsRefusesAConfigurationBeforeItIsWritten(t *testing.T) {
	for _, tc := range []struct {
		name string
		req  *publirasplatformv1.UpdatePlatformStorageSettingsRequest
	}{
		{
			name: "no bucket",
			req:  &publirasplatformv1.UpdatePlatformStorageSettingsRequest{Region: "ap-northeast-1"},
		},
		{
			name: "no region",
			req:  &publirasplatformv1.UpdatePlatformStorageSettingsRequest{Bucket: "publira-objects"},
		},
		{
			name: "an endpoint that is not a URL",
			req:  &publirasplatformv1.UpdatePlatformStorageSettingsRequest{Bucket: "publira-objects", Region: "ap-northeast-1", Endpoint: "s3.example.com"},
		},
		{
			name: "a revision no read could have answered",
			req:  &publirasplatformv1.UpdatePlatformStorageSettingsRequest{Bucket: "publira-objects", Region: "ap-northeast-1", ExpectedRevision: -1},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server, mock := newOperatorHandlerTestServer(t)

			_, err := server.UpdatePlatformStorageSettings(newStorageActorContext(), connect.NewRequest(tc.req))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("UpdatePlatformStorageSettings code = %v, want invalid_argument (err=%v)", connect.CodeOf(err), err)
			}
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
