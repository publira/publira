package episodeimages

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/storage"
)

func TestStorageUploadErrorPreservesContextErrors(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
	}{
		{name: "canceled", err: context.Canceled},
		{name: "deadline exceeded", err: context.DeadlineExceeded},
	} {
		got := storageUploadError(tc.err)
		if !errors.Is(got, tc.err) {
			t.Fatalf("%s error = %v, want %v", tc.name, got, tc.err)
		}
		if code := connect.CodeOf(got); code != connect.CodeUnknown {
			t.Fatalf("%s code = %v, want it left uncoded for connect to map", tc.name, code)
		}
	}

	err := storageUploadError(errors.New("storage unavailable"))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInternal)
	}
}

// A platform with no object store saved is a state the Platform Console
// resolves, so an upload says which state it is rather than failing as internal.
func TestStorageUploadErrorReportsMissingPlatformStorage(t *testing.T) {
	err := storageUploadError(fmt.Errorf("variant persistence failed: %w", storage.ErrNotConfigured))
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeFailedPrecondition {
		t.Fatalf("error = %v, want %v", err, connect.CodeFailedPrecondition)
	}
	details := connectErr.Details()
	if len(details) != 1 {
		t.Fatalf("details = %d, want one ErrorInfo", len(details))
	}
	value, detailErr := details[0].Value()
	if detailErr != nil {
		t.Fatalf("detail Value(): %v", detailErr)
	}
	info, ok := value.(*errdetails.ErrorInfo)
	if !ok || info.Reason != rpcerrors.ReasonStorageNotConfigured {
		t.Fatalf("detail = %#v, want reason %q", value, rpcerrors.ReasonStorageNotConfigured)
	}
}
