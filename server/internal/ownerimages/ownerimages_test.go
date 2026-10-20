package ownerimages

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/storage"
)

// recorder stands in for an owner's generated queries, keeping every write
// in the order it was made alongside the uploads.
type recorder struct {
	calls    []string
	images   []Image
	variants []Variant
	listed   [][]uuid.UUID
	stored   []Variant
	failOn   string
}

func (r *recorder) record(call string) error {
	r.calls = append(r.calls, call)
	if call == r.failOn {
		return errors.New("database refused " + call)
	}
	return nil
}

var testOwner = Owner[*recorder]{
	Collection: "things",
	CreateImage: func(_ context.Context, q *recorder, image Image) error {
		q.images = append(q.images, image)
		return q.record("image")
	},
	CreateVariant: func(_ context.Context, q *recorder, variant Variant) error {
		q.variants = append(q.variants, variant)
		return q.record("variant")
	},
	ListVariants: func(_ context.Context, q *recorder, _ uuid.UUID, imageIDs []uuid.UUID) ([]Variant, error) {
		q.listed = append(q.listed, imageIDs)
		return q.stored, q.record("list")
	},
	DeleteVariantsOfType: func(_ context.Context, q *recorder, _ uuid.UUID, variantType string) error {
		return q.record("delete " + variantType)
	},
	TouchImage: func(_ context.Context, q *recorder, _ uuid.UUID) error {
		return q.record("touch")
	},
}

type recordingStore struct {
	q       *recorder
	uploads []storage.UploadRequest
	err     error
}

func (s *recordingStore) Upload(_ context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	s.q.calls = append(s.q.calls, "upload")
	if s.err != nil {
		return storage.UploadResult{}, s.err
	}
	s.uploads = append(s.uploads, req)
	return storage.UploadResult{Provider: "s3", ObjectKey: req.ObjectKey, SizeBytes: int64(len(req.Data))}, nil
}

// pinningStore answers every upload of one operation with the store Pin
// handed out, the way the store behind the platform's storage settings does.
type pinningStore struct {
	pinned *recordingStore
}

func (s *pinningStore) Upload(context.Context, storage.UploadRequest) (storage.UploadResult, error) {
	return storage.UploadResult{}, errors.New("upload went past the pinned store")
}

func (s *pinningStore) Pin(context.Context) (storage.Provider, error) {
	return s.pinned, nil
}

var testRef = Ref{
	TenantID:       uuid.MustParse("01900000-0000-7000-8000-000000000001"),
	TenantPublicID: "TENANT001",
	OwnerID:        uuid.MustParse("01900000-0000-7000-8000-000000000002"),
	OwnerPublicID:  "THING001",
}

func testVariants(variantType string, labels ...string) []imageproc.Variant {
	variants := make([]imageproc.Variant, 0, len(labels))
	for i, label := range labels {
		variants = append(variants, imageproc.Variant{
			VariantType: variantType,
			Label:       label,
			ContentType: "image/webp",
			Extension:   ".webp",
			Width:       480 * (i + 1),
			Height:      270 * (i + 1),
			Data:        []byte(strings.Repeat("x", i+1)),
		})
	}
	return variants
}

func TestStoreWritesTheImageThenEachVariantAfterItsObject(t *testing.T) {
	q := &recorder{}
	store := &recordingStore{q: q}

	imageID, err := Store(context.Background(), q, store, testOwner, testRef, testVariants("landscape", "w480", "w960"))
	if err != nil {
		t.Fatalf("Store: %v", err)
	}

	if want := []string{"image", "upload", "variant", "upload", "variant"}; !slices.Equal(q.calls, want) {
		t.Fatalf("calls = %v, want %v", q.calls, want)
	}
	if want := (Image{ID: imageID, TenantID: testRef.TenantID, OwnerID: testRef.OwnerID}); q.images[0] != want {
		t.Fatalf("image = %+v, want %+v", q.images[0], want)
	}
	for i, label := range []string{"w480", "w960"} {
		wantKey := fmt.Sprintf("tenants/TENANT001/things/THING001/%s-%s.webp", imageID, label)
		if got := store.uploads[i].ObjectKey; got != wantKey {
			t.Fatalf("object key %d = %q, want %q", i, got, wantKey)
		}
		variant := q.variants[i]
		if variant.ImageID != imageID || variant.TenantID != testRef.TenantID {
			t.Fatalf("variant %d belongs to image %s of tenant %s, want image %s of tenant %s", i, variant.ImageID, variant.TenantID, imageID, testRef.TenantID)
		}
		if variant.ObjectKey != wantKey || variant.StorageProvider != "s3" || variant.FileSizeBytes != int64(i+1) {
			t.Fatalf("variant %d = %+v, want the object it was uploaded as", i, variant)
		}
		if variant.VariantType != "landscape" || variant.Label != label || variant.Width != int32(480*(i+1)) || variant.Height != int32(270*(i+1)) {
			t.Fatalf("variant %d = %+v, want the cut it was made from", i, variant)
		}
	}
}

func TestStoreFilesAnImageWithoutAnOwnerDirectlyUnderTheCollection(t *testing.T) {
	q := &recorder{}
	store := &recordingStore{q: q}

	imageID, err := Store(context.Background(), q, store, testOwner, Ref{TenantID: testRef.TenantID, TenantPublicID: "TENANT001"}, testVariants("icon", "original"))
	if err != nil {
		t.Fatalf("Store: %v", err)
	}

	if want := fmt.Sprintf("tenants/TENANT001/things/%s-original.webp", imageID); store.uploads[0].ObjectKey != want {
		t.Fatalf("object key = %q, want %q", store.uploads[0].ObjectKey, want)
	}
}

func TestStoreUploadsEveryVariantToTheStorePinAnswers(t *testing.T) {
	q := &recorder{}
	pinned := &recordingStore{q: q}

	if _, err := Store(context.Background(), q, &pinningStore{pinned: pinned}, testOwner, testRef, testVariants("square", "w480", "w960")); err != nil {
		t.Fatalf("Store: %v", err)
	}
	if len(pinned.uploads) != 2 {
		t.Fatalf("pinned store received %d uploads, want 2", len(pinned.uploads))
	}
}

func TestStoreReportsAMissingStoreAsAnUploadError(t *testing.T) {
	q := &recorder{}

	_, err := Store(context.Background(), q, nil, testOwner, testRef, testVariants("square", "w480"))

	if _, ok := errors.AsType[*UploadError](err); !ok {
		t.Fatalf("err = %v, want an UploadError", err)
	}
	if !errors.Is(err, storage.ErrNotConfigured) {
		t.Fatalf("err = %v, want storage.ErrNotConfigured", err)
	}
}

func TestStoreReportsAFailedUploadInTheStoragesOwnWords(t *testing.T) {
	q := &recorder{}
	store := &recordingStore{q: q, err: errors.New("bucket is read-only")}

	_, err := Store(context.Background(), q, store, testOwner, testRef, testVariants("square", "w480"))

	uploadErr, ok := errors.AsType[*UploadError](err)
	if !ok {
		t.Fatalf("err = %v, want an UploadError", err)
	}
	if uploadErr.Error() != "bucket is read-only" {
		t.Fatalf("message = %q, want the storage's own", uploadErr.Error())
	}
	if len(q.variants) != 0 {
		t.Fatalf("variants = %+v, want none for an object that was not written", q.variants)
	}
}

func TestStoreReportsAFailedRowAsNoUploadError(t *testing.T) {
	q := &recorder{failOn: "variant"}
	store := &recordingStore{q: q}

	_, err := Store(context.Background(), q, store, testOwner, testRef, testVariants("square", "w480"))

	if err == nil {
		t.Fatal("Store succeeded, want the database's refusal")
	}
	if _, ok := errors.AsType[*UploadError](err); ok {
		t.Fatalf("err = %v, want a database error rather than an UploadError", err)
	}
}

func TestReplaceTypeClearsTheRatioThenWritesItUnderNewKeys(t *testing.T) {
	imageID := uuid.MustParse("01900000-0000-7000-8000-000000000003")
	q := &recorder{}
	store := &recordingStore{q: q}

	for range 2 {
		if err := ReplaceType(context.Background(), q, store, testOwner, testRef, imageID, "portrait", testVariants("portrait", "w480", "w960")); err != nil {
			t.Fatalf("ReplaceType: %v", err)
		}
	}

	replace := []string{"delete portrait", "upload", "variant", "upload", "variant", "touch"}
	if want := slices.Concat(replace, replace); !slices.Equal(q.calls, want) {
		t.Fatalf("calls = %v, want %v", q.calls, want)
	}
	prefix := fmt.Sprintf("tenants/TENANT001/things/THING001/%s-", imageID)
	uploadIDs := make([]string, 0, len(store.uploads))
	for i, upload := range store.uploads {
		rest, ok := strings.CutPrefix(upload.ObjectKey, prefix)
		if !ok {
			t.Fatalf("object key %d = %q, want it under %q", i, upload.ObjectKey, prefix)
		}
		uploadID, label, ok := strings.Cut(rest, "-w")
		if !ok || !strings.HasSuffix(label, ".webp") {
			t.Fatalf("object key %d = %q, want <upload id>-<label>.webp after the image id", i, upload.ObjectKey)
		}
		if q.variants[i].ImageID != imageID {
			t.Fatalf("variant %d belongs to image %s, want %s", i, q.variants[i].ImageID, imageID)
		}
		uploadIDs = append(uploadIDs, uploadID)
	}
	if uploadIDs[0] != uploadIDs[1] {
		t.Fatalf("one replacement wrote under upload ids %q and %q, want one", uploadIDs[0], uploadIDs[1])
	}
	if uploadIDs[0] == uploadIDs[2] {
		t.Fatalf("two replacements both wrote under upload id %q, want a new one each", uploadIDs[0])
	}
}

func TestLoadGroupsVariantsByImage(t *testing.T) {
	first := uuid.MustParse("01900000-0000-7000-8000-000000000004")
	second := uuid.MustParse("01900000-0000-7000-8000-000000000005")
	q := &recorder{stored: []Variant{
		{ID: uuid.New(), ImageID: first, Label: "w480"},
		{ID: uuid.New(), ImageID: second, Label: "w480"},
		{ID: uuid.New(), ImageID: first, Label: "w960"},
	}}

	grouped, err := Load(context.Background(), q, testOwner, testRef.TenantID, []uuid.UUID{first, second})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	labels := func(variants []Variant) []string {
		out := make([]string, 0, len(variants))
		for _, variant := range variants {
			out = append(out, variant.Label)
		}
		return out
	}
	if got := labels(grouped[first]); !slices.Equal(got, []string{"w480", "w960"}) {
		t.Fatalf("first image = %v, want [w480 w960] in the order they were read", got)
	}
	if got := labels(grouped[second]); !slices.Equal(got, []string{"w480"}) {
		t.Fatalf("second image = %v, want [w480]", got)
	}
}

func TestLoadReadsNothingForNoImages(t *testing.T) {
	q := &recorder{}

	grouped, err := Load(context.Background(), q, testOwner, testRef.TenantID, nil)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(grouped) != 0 || len(q.listed) != 0 {
		t.Fatalf("grouped = %v after %d reads, want nothing read", grouped, len(q.listed))
	}
}
