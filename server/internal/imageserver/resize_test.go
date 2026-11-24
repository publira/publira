package imageserver

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"golang.org/x/image/webp"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// newCreatorImageServer serves testJPEG (32×24) as a creator image, which
// anyone may fetch and which is never encrypted, so a test reads the
// converted bytes as they are.
func newCreatorImageServer(t *testing.T) (*Server, *countingStore, string) {
	t.Helper()
	tenantID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	mediaID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	store := &countingStore{
		objects: map[string]storedObject{
			"creators/avatar.jpg": {data: testJPEG(), contentType: "image/jpeg"},
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
	return srv, store, "/images/creators/" + mediaID.String()
}

func getImage(srv *Server, target string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Host = "example.test"
	req.Header.Set("Accept", "image/webp")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

func TestResizeAboveTheLimitIsRefusedBeforeTheOriginalIsRead(t *testing.T) {
	over := strconv.Itoa(maxResizeDimension + 1)
	for _, query := range []string{"w=" + over, "h=" + over, "w=" + over + "&fit=scale-down"} {
		t.Run(query, func(t *testing.T) {
			srv, store, path := newCreatorImageServer(t)
			rec := getImage(srv, path+"?"+query)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
			}
			if got := store.getCount(); got != 0 {
				t.Fatalf("origin gets = %d, want 0", got)
			}
		})
	}
}

func TestResizeAtTheLimitIsAnswered(t *testing.T) {
	srv, _, path := newCreatorImageServer(t)
	limit := strconv.Itoa(maxResizeDimension)
	rec := getImage(srv, path+"?w="+limit+"&h="+limit)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
}

func TestResizeNeverEnlargesTheOriginal(t *testing.T) {
	for _, fit := range []string{"", "contain", "cover", "scale-down"} {
		t.Run("fit="+fit, func(t *testing.T) {
			srv, _, path := newCreatorImageServer(t)
			query := "?w=4000&h=4000"
			if fit != "" {
				query += "&fit=" + fit
			}
			rec := getImage(srv, path+query)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
			}
			cfg, err := webp.DecodeConfig(bytes.NewReader(rec.Body.Bytes()))
			if err != nil {
				t.Fatalf("decode converted image: %v", err)
			}
			if cfg.Width != 32 || cfg.Height != 24 {
				t.Fatalf("converted size = %d×%d, want the original 32×24", cfg.Width, cfg.Height)
			}
		})
	}
}

func TestResizeStillScalesDown(t *testing.T) {
	srv, _, path := newCreatorImageServer(t)
	rec := getImage(srv, path+"?w=16")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	cfg, err := webp.DecodeConfig(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("decode converted image: %v", err)
	}
	if cfg.Width != 16 || cfg.Height != 12 {
		t.Fatalf("converted size = %d×%d, want 16×12", cfg.Width, cfg.Height)
	}
}

// Every fit is converted as scale-down, so they are one rendition and one
// cache entry rather than one conversion each.
func TestResizeFitsShareOneCacheEntry(t *testing.T) {
	srv, store, path := newCreatorImageServer(t)
	for i, query := range []string{"?w=16&fit=scale-down", "?w=16", "?w=16&fit=contain", "?w=16&fit=cover"} {
		rec := getImage(srv, path+query)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d", query, rec.Code)
		}
		want := "hit"
		if i == 0 {
			want = "miss"
		}
		if got := rec.Header().Get(imageCacheHeader); got != want {
			t.Fatalf("%s: %s = %q, want %q", query, imageCacheHeader, got, want)
		}
	}
	if got := store.getCount(); got != 1 {
		t.Fatalf("origin gets = %d, want 1", got)
	}
}

func TestConversionsRunNoMoreThanTheSlotsAtOnce(t *testing.T) {
	const slots = 2
	var (
		mu      sync.Mutex
		running int
		peak    int
	)
	release := make(chan struct{})
	h := &Handler{
		conversions: make(chan struct{}, slots),
		proxy: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			mu.Lock()
			running++
			peak = max(peak, running)
			mu.Unlock()
			<-release
			mu.Lock()
			running--
			mu.Unlock()
		}),
	}

	var wg sync.WaitGroup
	for range slots + 3 {
		wg.Go(func() {
			if !h.convert(newLimitedRecorder(0), httptest.NewRequest(http.MethodGet, "/", nil)) {
				t.Error("convert reported a cancellation nobody made")
			}
		})
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		mu.Lock()
		n := running
		mu.Unlock()
		if n == slots || time.Now().After(deadline) {
			break
		}
		time.Sleep(time.Millisecond)
	}
	// The waiting conversions get a moment to take a slot they should not.
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()
	if peak != slots {
		t.Fatalf("peak concurrent conversions = %d, want %d", peak, slots)
	}
}

func TestConversionCanceledWhileWaitingConvertsNothing(t *testing.T) {
	called := false
	h := &Handler{
		conversions: make(chan struct{}, 1),
		proxy: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			called = true
		}),
	}
	h.conversions <- struct{}{}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
	if h.convert(newLimitedRecorder(0), req) {
		t.Fatal("convert ran with every slot taken and the request canceled")
	}
	if called {
		t.Fatal("the proxy was reached")
	}
}
