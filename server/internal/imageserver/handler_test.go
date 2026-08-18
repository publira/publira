package imageserver

import (
	"bytes"
	"context"
	"database/sql"
	"image"
	"image/jpeg"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	dbmodels "github.com/publira/publira/server/internal/db"
)

type stubResolver struct {
	tenant dbmodels.Tenant
	err    error
}

func (s stubResolver) GetTenantByDomains(context.Context, []string) (dbmodels.Tenant, error) {
	return s.tenant, s.err
}

func (s stubResolver) GetAdminTenantByDomains(context.Context, []string) (dbmodels.Tenant, error) {
	return dbmodels.Tenant{}, sql.ErrNoRows
}

type stubTenantQueries struct {
	public     dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow
	publicErr  error
	creator    dbmodels.GetCreatorImageByIDForTenantRow
	creatorErr error
}

func (s stubTenantQueries) GetCreatorImageByIDForTenant(context.Context, dbmodels.GetCreatorImageByIDForTenantParams) (dbmodels.GetCreatorImageByIDForTenantRow, error) {
	return s.creator, s.creatorErr
}

func (s stubTenantQueries) GetLabelImageVariantByTypeAndWidthForTenant(context.Context, dbmodels.GetLabelImageVariantByTypeAndWidthForTenantParams) (dbmodels.GetLabelImageVariantByTypeAndWidthForTenantRow, error) {
	return dbmodels.GetLabelImageVariantByTypeAndWidthForTenantRow{}, sql.ErrNoRows
}

func (s stubTenantQueries) GetSeriesImageVariantByTypeAndWidthForTenant(context.Context, dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantParams) (dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantRow, error) {
	return dbmodels.GetSeriesImageVariantByTypeAndWidthForTenantRow{}, sql.ErrNoRows
}

func (s stubTenantQueries) GetEpisodeImageAccessByIDForUser(context.Context, dbmodels.GetEpisodeImageAccessByIDForUserParams) (dbmodels.GetEpisodeImageAccessByIDForUserRow, error) {
	return dbmodels.GetEpisodeImageAccessByIDForUserRow{}, sql.ErrNoRows
}

func (s stubTenantQueries) GetEpisodeImagePublicAccessByIDForTenant(context.Context, dbmodels.GetEpisodeImagePublicAccessByIDForTenantParams) (dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow, error) {
	return s.public, s.publicErr
}

func (s stubTenantQueries) GetUserByPublicIDForTenant(context.Context, dbmodels.GetUserByPublicIDForTenantParams) (dbmodels.GetUserByPublicIDForTenantRow, error) {
	return dbmodels.GetUserByPublicIDForTenantRow{}, sql.ErrNoRows
}

func (s stubTenantQueries) GetUserByID(context.Context, uuid.UUID) (dbmodels.User, error) {
	return dbmodels.User{}, sql.ErrNoRows
}

type stubFactory struct {
	q TenantScopedQuerier
}

func (s stubFactory) ForTenant(context.Context, uuid.UUID) (TenantScopedQuerier, func(), error) {
	return s.q, func() {}, nil
}

type storedObject struct {
	data        []byte
	contentType string
}

type countingStore struct {
	mu      sync.Mutex
	gets    int
	objects map[string]storedObject
}

func (s *countingStore) GetObject(_ context.Context, key string) (ObjectResult, error) {
	s.mu.Lock()
	s.gets++
	obj, ok := s.objects[key]
	s.mu.Unlock()
	if !ok {
		return ObjectResult{}, ErrObjectNotFound
	}
	return ObjectResult{
		Body:          io.NopCloser(bytes.NewReader(obj.data)),
		ContentType:   obj.contentType,
		ContentLength: int64(len(obj.data)),
	}, nil
}

func (s *countingStore) getCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.gets
}

func testJPEG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 32, 24))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

func newTestServer(t *testing.T, resolver ResolverQuerier, factory TenantScopedQuerierFactory, store ObjectStore) *Server {
	t.Helper()
	t.Setenv("PUBLIRA_REDIS_URL", "disabled")
	srv, err := NewHandler(resolver, factory, store, nil, nil, (*auth.TokenManager)(nil))
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}
	t.Cleanup(func() {
		if err := srv.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	return srv
}

func TestEpisodeImageConvertsToWebPAndCaches(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	jpegBytes := testJPEG()
	store := &countingStore{
		objects: map[string]storedObject{
			"episodes/page.jpg": {data: jpegBytes, contentType: "image/jpeg"},
		},
	}
	queries := stubTenantQueries{
		public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
			ID:              mediaID,
			ObjectKey:       "episodes/page.jpg",
			ContentType:     "image/jpeg",
			IsPublished:     sql.NullBool{Bool: true, Valid: true},
			HasPublicAccess: true,
		},
	}
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: queries},
		store,
	)

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String(), nil)
	req.Host = "example.test"
	req.Header.Set("Accept", "image/webp,image/*,*/*;q=0.8")

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("first Content-Type = %q, want image/webp", got)
	}
	if got := rec.Header().Get(imageCacheHeader); got != "miss" {
		t.Fatalf("first %s = %q, want miss", imageCacheHeader, got)
	}
	if rec.Body.Len() == 0 {
		t.Fatal("first body is empty")
	}
	if store.getCount() != 1 {
		t.Fatalf("origin gets after miss = %d, want 1", store.getCount())
	}

	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, req.Clone(context.Background()))
	if rec2.Code != http.StatusOK {
		t.Fatalf("second status = %d", rec2.Code)
	}
	if got := rec2.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("second Content-Type = %q, want image/webp", got)
	}
	if got := rec2.Header().Get(imageCacheHeader); got != "hit" {
		t.Fatalf("second %s = %q, want hit", imageCacheHeader, got)
	}
	if !bytes.Equal(rec.Body.Bytes(), rec2.Body.Bytes()) {
		t.Fatal("cached body differs from converted body")
	}
	if store.getCount() != 1 {
		t.Fatalf("origin gets after hit = %d, want 1", store.getCount())
	}
}

func TestEpisodeImageResizeQuery(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	jpegBytes := testJPEG()
	store := &countingStore{
		objects: map[string]storedObject{
			"episodes/page.jpg": {data: jpegBytes, contentType: "image/jpeg"},
		},
	}
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
				ID:              mediaID,
				ObjectKey:       "episodes/page.jpg",
				ContentType:     "image/jpeg",
				IsPublished:     sql.NullBool{Bool: true, Valid: true},
				HasPublicAccess: true,
			},
		}},
		store,
	)

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String()+"?w=16", nil)
	req.Host = "example.test"
	req.Header.Set("Accept", "image/webp")

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("Content-Type = %q, want image/webp", got)
	}
	if rec.Body.Len() == 0 {
		t.Fatal("resized body is empty")
	}
}

func TestEpisodeImageForbiddenWhenNotPublic(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
				ID:              mediaID,
				ObjectKey:       "episodes/page.jpg",
				IsPublished:     sql.NullBool{Bool: true, Valid: true},
				HasPublicAccess: false,
			},
		}},
		&countingStore{objects: map[string]storedObject{}},
	)

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String(), nil)
	req.Host = "example.test"
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestCreatorImageConvertsToWebP(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	jpegBytes := testJPEG()
	store := &countingStore{
		objects: map[string]storedObject{
			"creators/avatar.jpg": {data: jpegBytes, contentType: "image/jpeg"},
		},
	}
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			creator: dbmodels.GetCreatorImageByIDForTenantRow{
				ObjectKey:   "creators/avatar.jpg",
				ContentType: "image/jpeg",
			},
		}},
		store,
	)

	req := httptest.NewRequest(http.MethodGet, "/images/creators/"+mediaID.String(), nil)
	req.Host = "example.test"
	req.Header.Set("Accept", "image/webp")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("Content-Type = %q, want image/webp", got)
	}
}

func TestRewriteOriginRequestDropsClientOriginContentType(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/x", nil)
	req.Header.Set(originContentTypeHeader, "text/html")

	cleared := rewriteOriginRequest(req, "obj", "")
	if got := cleared.Header.Get(originContentTypeHeader); got != "" {
		t.Fatalf("empty fallback left client header %q", got)
	}

	replaced := rewriteOriginRequest(req, "obj", "image/jpeg")
	if got := replaced.Header.Get(originContentTypeHeader); got != "image/jpeg" {
		t.Fatalf("header = %q, want image/jpeg", got)
	}
}

func TestEpisodeImageMissingObjectIsNotPubliclyCacheable(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			public: dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
				ID:              mediaID,
				ObjectKey:       "episodes/missing.jpg",
				ContentType:     "image/jpeg",
				IsPublished:     sql.NullBool{Bool: true, Valid: true},
				HasPublicAccess: true,
			},
		}},
		&countingStore{objects: map[string]storedObject{}},
	)

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String(), nil)
	req.Host = "example.test"
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}

func TestServeConvertedRejectsOversizeConversion(t *testing.T) {
	t.Parallel()

	h := &Handler{
		cache:        newMemoryCache(time.Hour, defaultMemoryMaxBytes),
		maxConverted: 8,
		logger:       slog.Default(),
		proxy: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "image/webp")
			_, _ = w.Write([]byte("0123456789"))
		}),
	}
	req := httptest.NewRequest(http.MethodGet, "/images/episodes/x", nil)
	rec := httptest.NewRecorder()
	h.serveConverted(rec, req, "obj", "image/jpeg", "public, max-age=3600")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if _, ok := h.cache.Get(context.Background(), cacheKey("obj", req)); ok {
		t.Fatal("oversized conversion was cached")
	}
}
