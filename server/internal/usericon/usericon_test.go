package usericon

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"slices"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
	"github.com/publira/publira/server/internal/storage"
)

// recordingQuerier keeps every write in the order it was made, and answers an
// election for the accounts it was told exist.
type recordingQuerier struct {
	calls    []string
	images   []dbmodels.CreateUserImageParams
	variants []dbmodels.CreateUserImageVariantParams
	elected  []dbmodels.SetUserIconImageParams
	accounts []uuid.UUID
}

func (q *recordingQuerier) CreateUserImage(_ context.Context, arg dbmodels.CreateUserImageParams) (dbmodels.UserImage, error) {
	q.calls = append(q.calls, "image")
	q.images = append(q.images, arg)
	return dbmodels.UserImage{ID: arg.ID, TenantID: arg.TenantID, UserID: arg.UserID}, nil
}

func (q *recordingQuerier) CreateUserImageVariant(_ context.Context, arg dbmodels.CreateUserImageVariantParams) (dbmodels.UserImageVariant, error) {
	q.calls = append(q.calls, "variant")
	q.variants = append(q.variants, arg)
	return dbmodels.UserImageVariant{ID: arg.ID}, nil
}

func (q *recordingQuerier) SetUserIconPreset(_ context.Context, arg dbmodels.SetUserIconPresetParams) (int64, error) {
	q.calls = append(q.calls, "elect preset")
	if !slices.Contains(q.accounts, arg.ID) {
		return 0, nil
	}
	return 1, nil
}

func (q *recordingQuerier) SetUserIconImage(_ context.Context, arg dbmodels.SetUserIconImageParams) (int64, error) {
	q.calls = append(q.calls, "elect")
	q.elected = append(q.elected, arg)
	if !slices.Contains(q.accounts, arg.ID) {
		return 0, nil
	}
	return 1, nil
}

type recordingStore struct {
	calls   *[]string
	uploads []storage.UploadRequest
	err     error
}

func (s *recordingStore) Upload(_ context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	*s.calls = append(*s.calls, "upload")
	if s.err != nil {
		return storage.UploadResult{}, s.err
	}
	s.uploads = append(s.uploads, req)
	return storage.UploadResult{Provider: "s3", ObjectKey: req.ObjectKey, SizeBytes: int64(len(req.Data))}, nil
}

func iconPNG(t *testing.T, width, height int) []byte {
	t.Helper()

	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, width, height))); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

var testAccount = Account{
	TenantID:       uuid.MustParse("11111111-1111-1111-1111-111111111111"),
	TenantPublicID: "TENANT001",
	UserID:         uuid.MustParse("22222222-2222-2222-2222-222222222222"),
	UserPublicID:   "READER000001",
}

// The image row exists before its object, so the object is always under a
// row the sweep can tell apart from an upload still in flight, and the
// account elects the image only once its variant names the object.
func TestSetStoresTheIconUnderTheTenantPrefixAndElectsIt(t *testing.T) {
	q := &recordingQuerier{accounts: []uuid.UUID{testAccount.UserID}}
	store := &recordingStore{calls: &q.calls}

	imageID, err := Set(t.Context(), q, store, testAccount, Upload{Data: iconPNG(t, 400, 300), ContentType: "image/png"})
	if err != nil {
		t.Fatalf("Set: %v", err)
	}

	if want := []string{"image", "upload", "variant", "elect"}; !slices.Equal(q.calls, want) {
		t.Fatalf("calls = %v, want %v", q.calls, want)
	}
	if q.images[0].ID != imageID || q.images[0].TenantID != testAccount.TenantID || q.images[0].UserID != testAccount.UserID {
		t.Fatalf("image row = %+v, want image %s of the account", q.images[0], imageID)
	}

	key := store.uploads[0].ObjectKey
	if want := "tenants/TENANT001/users/READER000001/" + imageID.String() + "-original.png"; key != want {
		t.Fatalf("object key = %q, want %q", key, want)
	}
	variant := q.variants[0]
	if variant.ObjectKey != key || variant.UserImageID != imageID || variant.TenantID != testAccount.TenantID {
		t.Fatalf("variant row = %+v, want the uploaded key under image %s", variant, imageID)
	}
	if variant.Width != 300 || variant.Height != 300 || variant.ContentType != "image/png" {
		t.Fatalf("variant = %dx%d %s, want the 300x300 PNG square", variant.Width, variant.Height, variant.ContentType)
	}

	elected := q.elected[0]
	if !elected.IconImageID.Valid || elected.IconImageID.UUID != imageID {
		t.Fatalf("elected = %v, want %s", elected.IconImageID, imageID)
	}
	if elected.TenantID.UUID != testAccount.TenantID || elected.ID != testAccount.UserID {
		t.Fatalf("elected for %v/%s, want the account", elected.TenantID, elected.ID)
	}
}

func TestSetRefusesAnUploadThatIsNoIconBeforeWritingAnything(t *testing.T) {
	for name, upload := range map[string]Upload{
		"undecodable":            {Data: []byte("not an image"), ContentType: "image/png"},
		"too small":              {Data: iconPNG(t, 64, 64), ContentType: "image/png"},
		"crop outside the image": {Data: iconPNG(t, 300, 300), ContentType: "image/png", Crop: &imageproc.CropRect{X: 200, Y: 0, Width: 300, Height: 300}},
	} {
		t.Run(name, func(t *testing.T) {
			q := &recordingQuerier{accounts: []uuid.UUID{testAccount.UserID}}
			store := &recordingStore{calls: &q.calls}

			_, err := Set(t.Context(), q, store, testAccount, upload)
			if !errors.Is(err, ErrInvalidImage) {
				t.Fatalf("err = %v, want ErrInvalidImage", err)
			}
			if upload.Crop != nil && !errors.Is(err, imageproc.ErrInvalidCrop) {
				t.Fatalf("err = %v, want the crop named as well", err)
			}
			if len(q.calls) != 0 {
				t.Fatalf("calls = %v, want nothing written", q.calls)
			}
		})
	}
}

func TestSetWithoutAStoreIsNotConfigured(t *testing.T) {
	q := &recordingQuerier{accounts: []uuid.UUID{testAccount.UserID}}

	_, err := Set(t.Context(), q, nil, testAccount, Upload{Data: iconPNG(t, 300, 300), ContentType: "image/png"})
	if !errors.Is(err, storage.ErrNotConfigured) {
		t.Fatalf("err = %v, want storage.ErrNotConfigured", err)
	}
	if len(q.calls) != 0 {
		t.Fatalf("calls = %v, want nothing written", q.calls)
	}
}

// A failed upload stops before any variant names the object, so the image row
// it leaves is one nothing elects.
func TestSetStopsAtAFailedUpload(t *testing.T) {
	q := &recordingQuerier{accounts: []uuid.UUID{testAccount.UserID}}
	store := &recordingStore{calls: &q.calls, err: storage.ErrNotConfigured}

	_, err := Set(t.Context(), q, store, testAccount, Upload{Data: iconPNG(t, 300, 300), ContentType: "image/png"})
	if !errors.Is(err, storage.ErrNotConfigured) {
		t.Fatalf("err = %v, want the storage error", err)
	}
	if want := []string{"image", "upload"}; !slices.Equal(q.calls, want) {
		t.Fatalf("calls = %v, want %v", q.calls, want)
	}
}

func TestClearElectsNothing(t *testing.T) {
	q := &recordingQuerier{accounts: []uuid.UUID{testAccount.UserID}}

	if err := Clear(t.Context(), q, testAccount.TenantID, testAccount.UserID); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if len(q.elected) != 1 || q.elected[0].IconImageID.Valid {
		t.Fatalf("elected = %+v, want one election of nothing", q.elected)
	}
}

func TestAnAccountTheTenantDoesNotHoldIsNotFound(t *testing.T) {
	q := &recordingQuerier{}

	if err := Clear(t.Context(), q, testAccount.TenantID, testAccount.UserID); !errors.Is(err, ErrAccountNotFound) {
		t.Fatalf("err = %v, want ErrAccountNotFound", err)
	}
}
