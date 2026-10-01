package imageserver

import (
	"bytes"
	"context"
	"database/sql"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/ageverification"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imageproc"
)

// pageJPEG encodes a page-sized JPEG, large enough that its preview is a
// reduction of it rather than the page at its own size.
func pageJPEG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 600, 900))
	for y := range 900 {
		for x := range 600 {
			img.Set(x, y, color.RGBA{R: uint8(x % 255), G: uint8(y % 255), B: 120, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("jpeg.Encode: %v", err)
	}
	return buf.Bytes()
}

// withheldPageQueries describes the opening page of a published episode whose
// full-size body the anonymous path refuses. Without a rating it is priced and
// unbought; with one it is free, and the tenant's rule covers the rating.
func withheldPageQueries(mediaID, episodeID uuid.UUID, rating, rule string) stubTenantQueries {
	public := dbmodels.GetEpisodeImagePublicAccessByIDForTenantRow{
		ID:              mediaID,
		EpisodeID:       episodeID,
		ObjectKey:       "episodes/page.jpg",
		ContentType:     "image/jpeg",
		IsPublished:     sql.NullBool{Bool: true, Valid: true},
		HasPublicAccess: rating != "",
	}
	if rating != "" {
		public.AgeRating = sql.NullString{String: rating, Valid: true}
		public.AgeVerification = sql.NullString{String: rule, Valid: true}
	}
	return stubTenantQueries{
		public: public,
		preview: dbmodels.GetEpisodePreviewImageByIDForTenantRow{
			ID:          mediaID,
			EpisodeID:   episodeID,
			ObjectKey:   "episodes/page.jpg",
			ContentType: "image/jpeg",
			IsPublished: sql.NullBool{Bool: true, Valid: true},
		},
	}
}

func TestEpisodePreviewServesAWithheldPageAsASmallRendition(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	episodeID := uuid.MustParse("33333333-3333-3333-3333-333333333333")

	cases := []struct {
		name   string
		rating string
		rule   string
	}{
		// Priced, no grant, and no rating: the full-size page is refused
		// because nobody has paid for it.
		{name: "a locked page"},
		// Free, but the tenant's rule covers the rating: the full-size page is
		// refused because the path names no reader who has proven an age.
		{name: "an age-restricted page", rating: ageverification.RatingR18, rule: ageverification.R18},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			queries := withheldPageQueries(mediaID, episodeID, tc.rating, tc.rule)
			store := &countingStore{objects: map[string]storedObject{
				"episodes/page.jpg": {data: pageJPEG(t), contentType: "image/jpeg"},
			}}
			srv := newTestServer(t,
				stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test", Timezone: "UTC"}},
				stubFactory{q: queries},
				store,
			)

			full := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String(), nil)
			full.Host = "example.test"
			fullRec := httptest.NewRecorder()
			srv.ServeHTTP(fullRec, full)
			if fullRec.Code != http.StatusForbidden {
				t.Fatalf("full-size status = %d, want %d", fullRec.Code, http.StatusForbidden)
			}

			req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String()+"/preview", nil)
			req.Host = "example.test"
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("preview status = %d, body = %q", rec.Code, rec.Body.String())
			}
			if got := rec.Header().Get("Content-Type"); got != imageproc.EpisodePreviewContentType {
				t.Fatalf("Content-Type = %q, want %q", got, imageproc.EpisodePreviewContentType)
			}
			// The rendition is the same for every reader, so it is neither
			// encrypted nor kept out of shared caches.
			if got := rec.Header().Get(imageEncryptionHeader); got != "" {
				t.Fatalf("%s = %q, want a plaintext rendition", imageEncryptionHeader, got)
			}
			if got := rec.Header().Get("Cache-Control"); got != publicImageCacheControl {
				t.Fatalf("Cache-Control = %q, want %q", got, publicImageCacheControl)
			}
			decoded, _, err := image.Decode(bytes.NewReader(rec.Body.Bytes()))
			if err != nil {
				t.Fatalf("decode preview: %v", err)
			}
			wantWidth, wantHeight := imageproc.EpisodePreviewSize(600, 900)
			if got := decoded.Bounds(); got.Dx() != wantWidth || got.Dy() != wantHeight {
				t.Fatalf("preview size = %dx%d, want %dx%d", got.Dx(), got.Dy(), wantWidth, wantHeight)
			}
		})
	}
}

func TestEpisodePreviewIsRenderedOnceAndCached(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	episodeID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	store := &countingStore{objects: map[string]storedObject{
		"episodes/page.jpg": {data: pageJPEG(t), contentType: "image/jpeg"},
	}}
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: withheldPageQueries(mediaID, episodeID, "", "")},
		store,
	)

	req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+mediaID.String()+"/preview", nil)
	req.Host = "example.test"
	first := httptest.NewRecorder()
	srv.ServeHTTP(first, req)
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d", first.Code)
	}
	if got := first.Header().Get(imageCacheHeader); got != "miss" {
		t.Fatalf("first %s = %q, want miss", imageCacheHeader, got)
	}

	// A size or a format asked for changes nothing: there is one rendition,
	// and a parameter that reached the converter would be a way to a larger
	// one.
	again := req.Clone(context.Background())
	again.URL.RawQuery = "w=1200&h=1800&q=100"
	again.Header.Set("Accept", "image/avif,image/webp")
	second := httptest.NewRecorder()
	srv.ServeHTTP(second, again)
	if second.Code != http.StatusOK {
		t.Fatalf("second status = %d", second.Code)
	}
	if got := second.Header().Get(imageCacheHeader); got != "hit" {
		t.Fatalf("second %s = %q, want hit", imageCacheHeader, got)
	}
	if !bytes.Equal(first.Body.Bytes(), second.Body.Bytes()) {
		t.Fatal("the second response differs from the rendition cached by the first")
	}
	if store.getCount() != 1 {
		t.Fatalf("object store reads = %d, want 1", store.getCount())
	}
}

func TestEpisodePreviewRefusesWhatIsNotAnOpeningPageOfAPublishedEpisode(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	laterPageID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	episodeID := uuid.MustParse("33333333-3333-3333-3333-333333333333")

	unpublished := withheldPageQueries(mediaID, episodeID, "", "")
	unpublished.preview.IsPublished = sql.NullBool{Bool: false, Valid: true}

	cases := []struct {
		name       string
		queries    stubTenantQueries
		mediaID    uuid.UUID
		wantStatus int
	}{
		{
			name:       "a page of an episode nobody may see yet",
			queries:    unpublished,
			mediaID:    mediaID,
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "a page past the opening ones",
			queries:    withheldPageQueries(mediaID, episodeID, "", ""),
			mediaID:    laterPageID,
			wantStatus: http.StatusNotFound,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &countingStore{objects: map[string]storedObject{
				"episodes/page.jpg": {data: pageJPEG(t), contentType: "image/jpeg"},
			}}
			srv := newTestServer(t,
				stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
				stubFactory{q: tc.queries},
				store,
			)

			req := httptest.NewRequest(http.MethodGet, "/images/episodes/"+tc.mediaID.String()+"/preview", nil)
			req.Host = "example.test"
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if store.getCount() != 0 {
				t.Fatalf("object store reads = %d, want none for a refused page", store.getCount())
			}
		})
	}
}
