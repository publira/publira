package imageserver

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

func TestCandidateFormatsFollowManaelsNegotiation(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		accept, contentType string
		want                string
	}{
		{"image/avif,image/webp,*/*", "image/jpeg", "image/avif"},
		{"image/webp,image/avif", "image/jpeg", "image/webp"},
		{"image/avif;q=0.9, image/webp", "image/png", "image/webp"},
		{"image/avif", "image/gif", ""},
		{"image/webp;x=1", "image/jpeg", "image/webp"},
		{"text/html, image/webp;x=2", "image/jpeg", "image/webp"},
		{"*/*", "image/jpeg", ""},
		{"", "image/jpeg", ""},
		{"image/avif,image/webp", "image/webp", ""},
		{"image/avif,image/webp", "image/svg+xml", ""},
		{"image/avif, text/html, image/webp", "", "image/avif,image/webp"},
		{"image/avif", "", "image/avif"},
		{"image/webp, image/avif", "", "image/webp"},
		{"text/html", "", ""},
	} {
		got := ""
		for i, format := range candidateFormats(tc.accept, tc.contentType) {
			if i > 0 {
				got += ","
			}
			got += format
		}
		if got != tc.want {
			t.Errorf("candidateFormats(%q, %q) = %q, want %q", tc.accept, tc.contentType, got, tc.want)
		}
	}
}

func TestQualityForStatesEachFormatsQuality(t *testing.T) {
	t.Parallel()

	webp := []string{formatWebP}
	both := []string{formatAVIF, formatWebP}
	for _, tc := range []struct {
		values  []string
		formats []string
		want    string
	}{
		{nil, webp, ""},
		{[]string{"80"}, webp, "webp:80"},
		{[]string{"080"}, webp, "webp:80"},
		{[]string{"+80"}, webp, "webp:80"},
		{[]string{"webp:70"}, webp, "webp:70"},
		{[]string{"WebP : 70"}, webp, "webp:70"},
		{[]string{"avif:60"}, webp, ""},
		{[]string{"80,webp:70"}, webp, "webp:70"},
		{[]string{"webp:70,80"}, webp, "webp:70"},
		{[]string{"avif:60", "webp:80"}, both, "avif:60,webp:80"},
		{[]string{"75"}, both, "avif:75,webp:75"},
		{[]string{"500"}, webp, "webp:100"},
		{[]string{"-3"}, webp, "webp:1"},
		{[]string{"abc", ",,", "jpeg:30"}, webp, ""},
	} {
		if got := qualityFor(tc.values, tc.formats); got != tc.want {
			t.Errorf("qualityFor(%q, %q) = %q, want %q", tc.values, tc.formats, got, tc.want)
		}
	}
}

func TestConversionRequestRefusesADimensionManaelWouldRefuse(t *testing.T) {
	t.Parallel()

	over := strconv.Itoa(maxResizeDimension + 1)
	for _, query := range []string{"w=0", "w=-16", "w=abc", "w=1.5", "h=" + over, "w=16&h=x"} {
		r := httptest.NewRequest(http.MethodGet, "/images/creators/x?"+query, nil)
		r.Header.Set("Accept", "image/webp")
		if _, err := conversionRequest(r, "image/jpeg"); err == nil {
			t.Errorf("%s: no error", query)
		}
	}
}

// Requests for the same rendition, spelled differently, are one conversion
// and one cache entry.
func TestEquivalentRequestsShareOneCacheEntry(t *testing.T) {
	for _, tc := range []struct {
		name     string
		requests []imageRequest
	}{
		{"accept parameters", []imageRequest{
			{"image/webp", "?w=16"},
			{"image/webp;x=1", "?w=16"},
			{"image/webp;x=2", "?w=16"},
			{"text/html, image/webp, */*", "?w=16"},
			{"image/webp, image/avif", "?w=16"},
		}},
		{"dimension spellings", []imageRequest{
			{"image/webp", "?w=16"},
			{"image/webp", "?w=016"},
			{"image/webp", "?w=%2B16"},
			{"image/webp", "?w=16&w=99"},
			{"image/webp", "?w=16&fit=cover&utm=x"},
		}},
		{"quality spellings", []imageRequest{
			{"image/webp", "?w=16&q=50"},
			{"image/webp", "?w=16&q=050"},
			{"image/webp", "?w=16&q=webp:50"},
			{"image/webp", "?w=16&q=avif:10,webp:50"},
			{"image/webp", "?w=16&q=90,webp:50"},
		}},
		{"quality for another format", []imageRequest{
			{"image/webp", "?w=16"},
			{"image/webp", "?w=16&q=avif:10"},
			{"image/webp", "?w=16&q=nonsense"},
		}},
		{"no format to convert to", []imageRequest{
			{"", ""},
			{"*/*", "?w=16"},
			{"text/html", "?w=8&q=10"},
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, store, path := newCreatorImageServer(t)
			for i, req := range tc.requests {
				rec := getImageAccepting(srv, path+req.query, req.accept)
				if rec.Code != http.StatusOK {
					t.Fatalf("%+v: status = %d, body = %q", req, rec.Code, rec.Body.String())
				}
				want := "hit"
				if i == 0 {
					want = "miss"
				}
				if got := rec.Header().Get(imageCacheHeader); got != want {
					t.Fatalf("%+v: %s = %q, want %q", req, imageCacheHeader, got, want)
				}
			}
			if got := store.getCount(); got != 1 {
				t.Fatalf("origin gets = %d, want 1", got)
			}
		})
	}
}

// An original Manael does not convert is passed through as it is, so no
// transform asked of it makes a second copy.
func TestPassedThroughOriginalIsOneCacheEntry(t *testing.T) {
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	store := &countingStore{
		objects: map[string]storedObject{
			"creators/avatar.webp": {data: []byte("RIFF-not-converted"), contentType: "image/webp"},
		},
	}
	srv := newTestServer(t,
		stubResolver{tenant: dbmodels.Tenant{ID: tenantID, Domain: "example.test"}},
		stubFactory{q: stubTenantQueries{
			creator: dbmodels.GetCreatorImageByIDForTenantRow{
				ObjectKey:   "creators/avatar.webp",
				ContentType: "image/webp",
			},
		}},
		store,
	)
	path := "/images/creators/" + mediaID.String()
	for i, req := range []imageRequest{
		{"image/webp", ""},
		{"image/avif,image/webp", "?w=16"},
		{"image/webp", "?w=17&q=40"},
		{"", "?h=3"},
	} {
		rec := getImageAccepting(srv, path+req.query, req.accept)
		if rec.Code != http.StatusOK {
			t.Fatalf("%+v: status = %d, body = %q", req, rec.Code, rec.Body.String())
		}
		want := "hit"
		if i == 0 {
			want = "miss"
		}
		if got := rec.Header().Get(imageCacheHeader); got != want {
			t.Fatalf("%+v: %s = %q, want %q", req, imageCacheHeader, got, want)
		}
	}
	if got := store.getCount(); got != 1 {
		t.Fatalf("origin gets = %d, want 1", got)
	}
}

// Requests whose conversions differ keep entries of their own.
func TestDistinctRenditionsKeepEntriesOfTheirOwn(t *testing.T) {
	srv, store, path := newCreatorImageServer(t)
	requests := []imageRequest{
		{"image/webp", "?w=16"},
		{"image/webp", "?w=8"},
		{"image/webp", "?h=12"},
		{"image/webp", "?w=16&q=50"},
		{"image/webp", "?w=16&q=60"},
		{"image/avif", "?w=16"},
		{"", "?w=16"},
	}
	for _, req := range requests {
		rec := getImageAccepting(srv, path+req.query, req.accept)
		if rec.Code != http.StatusOK {
			t.Fatalf("%+v: status = %d, body = %q", req, rec.Code, rec.Body.String())
		}
		if got := rec.Header().Get(imageCacheHeader); got != "miss" {
			t.Fatalf("%+v: %s = %q, want miss", req, imageCacheHeader, got)
		}
	}
	if got := store.getCount(); got != len(requests) {
		t.Fatalf("origin gets = %d, want %d", got, len(requests))
	}
}

type imageRequest struct {
	accept, query string
}

func getImageAccepting(srv *Server, target, accept string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Host = "example.test"
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

// The quality conversionRequest restates still reaches the encoder.
func TestRestatedQualityReachesTheEncoder(t *testing.T) {
	srv, _, path := newCreatorImageServer(t)
	low := getImageAccepting(srv, path+"?q=1", "image/webp")
	high := getImageAccepting(srv, path+"?q=100", "image/webp")
	if low.Code != http.StatusOK || high.Code != http.StatusOK {
		t.Fatalf("status = %d, %d", low.Code, high.Code)
	}
	if bytes.Equal(low.Body.Bytes(), high.Body.Bytes()) {
		t.Fatal("q=1 and q=100 encoded the same bytes")
	}
}
