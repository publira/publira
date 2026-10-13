package imageserver

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/tenantconn"
	"github.com/publira/publira/server/internal/usericon"
)

// uploadingStore is the bucket an icon is uploaded into and image-server reads
// it back from, so a test follows one object from the upload to the response.
type uploadingStore struct {
	*countingStore
}

func (s uploadingStore) Upload(_ context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.objects[req.ObjectKey] = storedObject{data: req.Data, contentType: req.ContentType}
	return storage.UploadResult{Provider: "s3", ObjectKey: req.ObjectKey, SizeBytes: int64(len(req.Data))}, nil
}

func iconPNG(t *testing.T) []byte {
	t.Helper()

	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 300, 300))); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	return buf.Bytes()
}

// A reader's icon goes from an upload to image-server through the rows and the
// row-level security of a real database, as the storefront's own login: it is
// served on its tenant's host while the account elects it, and on no other
// host, and it stops being served the moment its reader replaces or removes it.
func TestDBUserIconIsServedWhileTheAccountElectsIt(t *testing.T) {
	env := newPreviewDBEnv(t)
	other := env.pg.SeedTenant(t, "TENANTB", "tenant-b.example.com", "Tenant B")
	reader := env.pg.SeedEndUser(t, env.tenant.ID, "READER000001", "reader@example.com", "Reader")
	store := uploadingStore{env.store}

	publicDB := env.pg.OpenPublicDB(t)
	conn, release, err := tenantconn.Acquire(t.Context(), publicDB, env.tenant.ID, nil)
	if err != nil {
		t.Fatalf("acquire a connection for tenant A: %v", err)
	}
	t.Cleanup(release)
	queries := dbmodels.New(conn)
	account := usericon.Account{
		TenantID:       env.tenant.ID,
		TenantPublicID: env.tenant.PublicID,
		UserID:         reader.ID,
		UserPublicID:   reader.PublicID,
	}
	set := func() uuid.UUID {
		t.Helper()
		imageID, err := usericon.Set(t.Context(), queries, store, account, usericon.Upload{Data: iconPNG(t), ContentType: "image/png"})
		if err != nil {
			t.Fatalf("usericon.Set: %v", err)
		}
		return imageID
	}
	status := func(host string, imageID uuid.UUID) int {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/images/users/"+imageID.String(), nil)
		req.Host = host
		rec := httptest.NewRecorder()
		env.srv.ServeHTTP(rec, req)
		if rec.Code == http.StatusOK {
			if got := rec.Header().Get("Cache-Control"); got != publicImageCacheControl {
				t.Fatalf("Cache-Control = %q, want %q", got, publicImageCacheControl)
			}
		}
		return rec.Code
	}

	first := set()
	if got := status(env.tenant.Domain, first); got != http.StatusOK {
		t.Fatalf("the elected icon on its tenant's host: status = %d, want 200", got)
	}
	if got := status(other.Domain, first); got != http.StatusNotFound {
		t.Fatalf("the icon on another tenant's host: status = %d, want 404", got)
	}

	second := set()
	if got := status(env.tenant.Domain, second); got != http.StatusOK {
		t.Fatalf("the replacement icon: status = %d, want 200", got)
	}
	if got := status(env.tenant.Domain, first); got != http.StatusNotFound {
		t.Fatalf("the replaced icon: status = %d, want 404", got)
	}

	if err := usericon.Clear(t.Context(), queries, env.tenant.ID, reader.ID); err != nil {
		t.Fatalf("usericon.Clear: %v", err)
	}
	if got := status(env.tenant.Domain, second); got != http.StatusNotFound {
		t.Fatalf("the removed icon: status = %d, want 404", got)
	}

	// An account of another tenant is not one this connection can elect for,
	// even by naming its id.
	stranger := env.pg.SeedEndUser(t, other.ID, "READER000002", "stranger@example.com", "Stranger")
	if err := usericon.Clear(t.Context(), queries, env.tenant.ID, stranger.ID); !errors.Is(err, usericon.ErrAccountNotFound) {
		t.Fatalf("clearing another tenant's account: err = %v, want ErrAccountNotFound", err)
	}

	// An upload that is no icon writes nothing.
	before := countUserImages(t, env.pg.DB)
	if _, err := usericon.Set(t.Context(), queries, store, account, usericon.Upload{Data: []byte("not an image"), ContentType: "image/png"}); !errors.Is(err, usericon.ErrInvalidImage) {
		t.Fatalf("usericon.Set with an undecodable upload: err = %v, want ErrInvalidImage", err)
	}
	if after := countUserImages(t, env.pg.DB); after != before {
		t.Fatalf("user_images rows = %d after a refused upload, want %d", after, before)
	}
}

func countUserImages(t *testing.T, db *sql.DB) int {
	t.Helper()

	var count int
	if err := db.QueryRowContext(t.Context(), "SELECT count(*) FROM user_images").Scan(&count); err != nil {
		t.Fatalf("count user_images: %v", err)
	}
	return count
}
