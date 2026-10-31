package imageserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/readguard"
	"github.com/publira/publira/server/internal/testutil"
)

// newReadGuardedImages serves the image routes behind the client address
// resolution the server runs every request through, answering every host as
// resolver says, with a guard whose clock stands still.
func newReadGuardedImages(t *testing.T, resolver ResolverQuerier) http.Handler {
	t.Helper()
	site := SiteDB{Resolver: resolver, Tenants: stubFactory{q: stubTenantQueries{}}, Objects: &countingStore{}}
	srv, err := NewHandler(site, site, nil, auth.NewTokenManager([]byte(testMediaJWTSecret)), readguard.New(testutil.Limiter(), platformpolicy.Fixed(platformpolicy.Defaults())))
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}
	t.Cleanup(func() {
		if err := srv.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	return clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies}).Middleware(srv)
}

// fetchFrom asks for an image the edge forwarded from client, or one a web app
// fetches as itself when client is empty.
func fetchFrom(handler http.Handler, client string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/images/creators/"+uuid.NewString(), nil)
	req.Host = "example.test"
	req.RemoteAddr = "10.0.0.2:41000"
	if client != "" {
		req.Header.Set("Forwarded", "for="+client)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestImagesRefuseAClientPastItsAllowance(t *testing.T) {
	tenant := dbmodels.Tenant{ID: uuid.New(), Domain: "example.test"}
	for _, host := range []struct {
		name     string
		resolver stubResolver
	}{
		{"a site host", stubResolver{tenant: tenant}},
		{"an image host", stubResolver{tenant: tenant, images: true}},
	} {
		t.Run(host.name, func(t *testing.T) {
			handler := newReadGuardedImages(t, host.resolver)
			limit := platformpolicy.Defaults().AnonymousReads.Images
			for i := range limit {
				if rec := fetchFrom(handler, "203.0.113.10"); rec.Code == http.StatusTooManyRequests {
					t.Fatalf("image %d of %d refused for its rate, want the whole allowance served", i+1, limit)
				}
			}
			rec := fetchFrom(handler, "203.0.113.10")
			if rec.Code != http.StatusTooManyRequests {
				t.Fatalf("image past the allowance: status = %d, want 429", rec.Code)
			}
			if rec.Header().Get("Retry-After") == "" {
				t.Fatal("the refusal carries no Retry-After, want the wait until the window passes")
			}
			if got := rec.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("the refusal's Cache-Control = %q, want no-store so no cache keeps answering it", got)
			}
			if rec := fetchFrom(handler, "198.51.100.7"); rec.Code == http.StatusTooManyRequests {
				t.Fatal("another client's image refused, want each client counted on its own")
			}
		})
	}
}

func TestImagesLeaveConsoleHostsAndTheInstallAlone(t *testing.T) {
	tenant := dbmodels.Tenant{ID: uuid.New(), Domain: "example.test"}
	for _, tt := range []struct {
		name     string
		resolver stubResolver
		client   string
	}{
		{"a console host", stubResolver{tenant: tenant, console: true}, "203.0.113.10"},
		{"a web app fetching as itself", stubResolver{tenant: tenant}, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			handler := newReadGuardedImages(t, tt.resolver)
			for i := range platformpolicy.Defaults().AnonymousReads.Images + 1 {
				if rec := fetchFrom(handler, tt.client); rec.Code == http.StatusTooManyRequests {
					t.Fatalf("image %d refused for its rate, want it never charged", i+1)
				}
			}
		})
	}
}
