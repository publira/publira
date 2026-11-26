package imageserver

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"slices"
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
	return fetchOn(handler, "example.test", client)
}

// fetchOn is fetchFrom on the host named.
func fetchOn(handler http.Handler, host, client string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/images/creators/"+uuid.NewString(), nil)
	req.Host = host
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
		{"a console host", stubResolver{tenant: tenant, console: true}},
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

// A console host's images are counted apart from the site's, so a member of
// staff who has spent the one still has the other.
func TestImagesCountAConsoleHostApartFromTheSite(t *testing.T) {
	tenant := dbmodels.Tenant{ID: uuid.New(), Domain: "example.test"}
	handler := newReadGuardedImages(t, hostResolver{tenant: tenant, console: "admin.example.test"})
	limit := platformpolicy.Defaults().AnonymousReads.Images
	for range limit {
		fetchOn(handler, "example.test", "203.0.113.10")
	}
	if rec := fetchOn(handler, "example.test", "203.0.113.10"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("site image past the allowance: status = %d, want 429", rec.Code)
	}
	if rec := fetchOn(handler, "admin.example.test", "203.0.113.10"); rec.Code == http.StatusTooManyRequests {
		t.Fatal("a console image refused once the site's allowance was spent, want the two counted apart")
	}
}

// hostResolver answers the tenant's site on its domain and its console on the
// console host named, so one server sees both.
type hostResolver struct {
	tenant  dbmodels.Tenant
	console string
}

func (s hostResolver) GetTenantByDomains(_ context.Context, domains []string) (dbmodels.Tenant, error) {
	if slices.Contains(domains, s.tenant.Domain) {
		return s.tenant, nil
	}
	return dbmodels.Tenant{}, sql.ErrNoRows
}

func (s hostResolver) GetAdminTenantByDomains(_ context.Context, domains []string) (dbmodels.Tenant, error) {
	if slices.Contains(domains, s.console) {
		return s.tenant, nil
	}
	return dbmodels.Tenant{}, sql.ErrNoRows
}

func (hostResolver) GetTenantByImageDomains(context.Context, []string) (dbmodels.Tenant, error) {
	return dbmodels.Tenant{}, sql.ErrNoRows
}

func TestImagesLeaveTheInstallAlone(t *testing.T) {
	tenant := dbmodels.Tenant{ID: uuid.New(), Domain: "example.test"}
	for _, resolver := range []stubResolver{{tenant: tenant}, {tenant: tenant, console: true}} {
		handler := newReadGuardedImages(t, resolver)
		for i := range platformpolicy.Defaults().AnonymousReads.Images + 1 {
			if rec := fetchFrom(handler, ""); rec.Code == http.StatusTooManyRequests {
				t.Fatalf("image %d a web app fetched as itself refused for its rate, want it never charged", i+1)
			}
		}
	}
}
