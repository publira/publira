package episodeimages

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"math/rand/v2"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"github.com/publira/epub"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/publira/publira/server/internal/imageproc"
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

// pagePNG is a PNG header of the given size, its tail from fill.
func pagePNG(t *testing.T, size int, fill func([]byte)) []byte {
	t.Helper()
	img := image.NewGray(image.Rect(0, 0, 1, 1))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	data := make([]byte, size)
	fill(data[copy(data, buf.Bytes()):])
	return data
}

func zipOfPages(t *testing.T, method uint16, pages ...[]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for index, page := range pages {
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: fmt.Sprintf("%04d.png", index), Method: method})
		if err != nil {
			t.Fatalf("writer.CreateHeader: %v", err)
		}
		if _, err := entry.Write(page); err != nil {
			t.Fatalf("entry.Write: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close: %v", err)
	}
	return buf.Bytes()
}

func epubOfPages(t *testing.T, pages ...[]byte) []byte {
	t.Helper()
	doc := &epub.Document{Title: "Episode", Direction: "rtl", Layout: epub.LayoutPrePaginated}
	for _, page := range pages {
		if _, _, err := doc.AddPageWithAsset(bytes.NewReader(page), int64(len(page)), "right"); err != nil {
			t.Fatalf("doc.AddPageWithAsset: %v", err)
		}
	}
	var buf bytes.Buffer
	if err := epub.Encode(&buf, doc); err != nil {
		t.Fatalf("epub.Encode: %v", err)
	}
	return buf.Bytes()
}

// A small archive of pages that are all one run of zeros is what the limit on
// the upload does not see: the pages here add up to more than the bound, in an
// archive a fraction of the size of one of them.
func TestCollectInputsRefusesAnArchiveThatUnpacksPastTheBound(t *testing.T) {
	page := pagePNG(t, imageproc.MaxUploadBytes, func([]byte) {})
	pages := make([][]byte, maxArchiveUnpackedBytes/imageproc.MaxUploadBytes+1)
	for index := range pages {
		pages[index] = page
	}

	for _, tc := range []struct {
		name     string
		archive  []byte
		filename string
	}{
		{name: "zip", archive: zipOfPages(t, zip.Deflate, pages...), filename: "pages.zip"},
		{name: "epub", archive: epubOfPages(t, pages...), filename: "pages.epub"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if len(tc.archive) >= imageproc.MaxUploadBytes {
				t.Fatalf("the archive is %d bytes, want it smaller than one of its pages", len(tc.archive))
			}
			_, err := collectInputs(nil, tc.archive, tc.filename, "", true)
			if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "unpacks to more than") {
				t.Errorf("collectInputs: %v, want invalid_argument for what it unpacks to", err)
			}
		})
	}
}

// Pages that do not compress reach the archive at their own size, so the
// largest archive an upload may carry unpacks to about that and stays inside.
func TestCollectInputsTakesIncompressiblePagesAtTheUploadLimit(t *testing.T) {
	source := rand.NewChaCha8([32]byte{})
	const pageCount = (MaxUploadBytes - 1<<20) / imageproc.MaxUploadBytes
	pages := make([][]byte, pageCount)
	for index := range pages {
		pages[index] = pagePNG(t, imageproc.MaxUploadBytes, func(tail []byte) { _, _ = source.Read(tail) })
	}

	for _, tc := range []struct {
		name     string
		archive  []byte
		filename string
	}{
		{name: "zip", archive: zipOfPages(t, zip.Store, pages...), filename: "pages.zip"},
		{name: "epub", archive: epubOfPages(t, pages...), filename: "pages.epub"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if len(tc.archive) > MaxUploadBytes {
				t.Fatalf("the archive is %d bytes, want it within MaxUploadBytes", len(tc.archive))
			}
			inputs, err := collectInputs(nil, tc.archive, tc.filename, "", true)
			if err != nil || len(inputs) != pageCount {
				t.Errorf("collectInputs: %d inputs, %v, want all %d pages", len(inputs), err, pageCount)
			}
		})
	}
}

// The console refuses an upload over its own limit before it sends one, with a
// message that states the number, so the number is this one: a console over it
// would refuse nothing and leave the RPC to answer with a generic error.
func TestMaxUploadBytesIsTheConsoles(t *testing.T) {
	source, err := os.ReadFile("../../../apps/web-admin/lib/episode-pages-upload.ts")
	if err != nil {
		t.Fatalf("read the console's upload limit: %v", err)
	}
	match := regexp.MustCompile(`EPISODE_PAGES_UPLOAD_MAX_BYTES = (\d+) \* 1024 \* 1024;`).FindSubmatch(source)
	if match == nil {
		t.Fatal("the console's source states no EPISODE_PAGES_UPLOAD_MAX_BYTES in mebibytes")
	}
	mebibytes, err := strconv.Atoi(string(match[1]))
	if err != nil {
		t.Fatalf("parse %q: %v", match[1], err)
	}
	if got := mebibytes << 20; got != MaxUploadBytes {
		t.Errorf("EPISODE_PAGES_UPLOAD_MAX_BYTES is %d bytes, want MaxUploadBytes, %d", got, MaxUploadBytes)
	}
}
