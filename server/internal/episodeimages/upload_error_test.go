package episodeimages

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
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
	value, detailErr := connectproto.UnmarshalErrorDetail(details[0])
	if detailErr != nil {
		t.Fatalf("detail Value(): %v", detailErr)
	}
	info, ok := value.(*errdetails.ErrorInfo)
	if !ok || info.Reason != rpcerrors.ReasonStorageNotConfigured {
		t.Fatalf("detail = %#v, want reason %q", value, rpcerrors.ReasonStorageNotConfigured)
	}
}

// An upload carries at most MaxUploadBytes, whether as an archive or as images
// taken together, and a larger one is refused before anything is extracted.
func TestCollectInputsBoundsWhatOneUploadCarries(t *testing.T) {
	half := make([]byte, MaxUploadBytes/2)
	for _, tc := range []struct {
		name    string
		images  []*publiraadminv1.EpisodeImageUpload
		archive []byte
	}{
		{name: "archive", archive: make([]byte, MaxUploadBytes+1)},
		{name: "images", images: []*publiraadminv1.EpisodeImageUpload{{Data: half}, {Data: half}, {Data: []byte{0}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := collectInputs(tc.images, tc.archive, "pages.zip", "application/zip", true)
			if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "at most") {
				t.Errorf("an upload of %d bytes: %v, want invalid_argument for its size", MaxUploadBytes+1, err)
			}
		})
	}

	inputs, err := collectInputs([]*publiraadminv1.EpisodeImageUpload{{Data: half}, {Data: half}}, nil, "", "", true)
	if err != nil || len(inputs) != 2 {
		t.Errorf("an upload of exactly %d bytes: %d inputs, %v, want both images", MaxUploadBytes, len(inputs), err)
	}
}
