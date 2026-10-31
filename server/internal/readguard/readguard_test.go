package readguard

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/ratelimit"
)

// instant is not at the start of a window, so a test's burst lands in one.
var instant = time.Date(2026, 9, 10, 12, 30, 31, 0, time.UTC)

func fixedClock() time.Time { return instant }

func guardOver(store ratelimit.Store) *Guard {
	return New(ratelimit.NewWithClock(store, fixedClock), platformpolicy.Fixed(platformpolicy.Defaults()))
}

// defaultLimit is the reads of allowance a platform that saved no policy
// gives one client in a window.
func defaultLimit(allowance Allowance) int {
	return Limit(platformpolicy.Defaults().AnonymousReads, allowance)
}

// requestFrom returns the context of a request the edge forwarded from client,
// or of a call a web app made as itself when client is empty, as the server's
// own middleware resolves it.
func requestFrom(t *testing.T, client string) context.Context {
	t.Helper()
	var ctx context.Context
	handler := clientip.New(clientip.Config{TrustedProxies: clientip.DefaultTrustedProxies}).Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		ctx = r.Context()
	}))
	req := httptest.NewRequest(http.MethodPost, "/rpc/publira.v1.CatalogService/ListPublishedSeries", nil)
	req.RemoteAddr = "10.0.0.2:41000"
	if client != "" {
		req.Header.Set("Forwarded", "for="+client)
	}
	handler.ServeHTTP(httptest.NewRecorder(), req)
	return ctx
}

func allow(t *testing.T, guard *Guard, ctx context.Context, allowance Allowance) ratelimit.Decision {
	t.Helper()
	decision, err := guard.Allow(ctx, allowance)
	if err != nil {
		t.Fatalf("Allow(%s) error = %v", allowance, err)
	}
	return decision
}

func TestGuardRefusesAClientPastItsAllowanceAndServesAnother(t *testing.T) {
	for _, allowance := range []Allowance{PublicAPI, Search, Images} {
		t.Run(string(allowance), func(t *testing.T) {
			guard := guardOver(ratelimit.NewMemoryStoreWithClock(fixedClock))
			reader := requestFrom(t, "203.0.113.10")
			limit := defaultLimit(allowance)
			for i := range limit {
				if !allow(t, guard, reader, allowance).Allowed {
					t.Fatalf("read %d of %d refused, want the whole allowance served", i+1, limit)
				}
			}
			refused := allow(t, guard, reader, allowance)
			if refused.Allowed {
				t.Fatalf("read %d allowed, want it refused past the allowance of %d", limit+1, limit)
			}
			if refused.RetryAfter <= 0 || refused.RetryAfter > platformpolicy.ReadWindow {
				t.Fatalf("RetryAfter = %s, want what is left of the %s window", refused.RetryAfter, platformpolicy.ReadWindow)
			}
			if !allow(t, guard, requestFrom(t, "198.51.100.7"), allowance).Allowed {
				t.Fatal("another client refused, want each client counted on its own")
			}
		})
	}
}

func TestGuardKeepsTheAllowancesApart(t *testing.T) {
	guard := guardOver(ratelimit.NewMemoryStoreWithClock(fixedClock))
	reader := requestFrom(t, "203.0.113.10")
	for range defaultLimit(Search) + 1 {
		allow(t, guard, reader, Search)
	}
	if !allow(t, guard, reader, PublicAPI).Allowed {
		t.Fatal("the public API refused a client that spent only the search's allowance")
	}
	if !allow(t, guard, reader, Images).Allowed {
		t.Fatal("the images refused a client that spent only the search's allowance")
	}
}

func TestGuardLeavesCallsFromInsideTheInstallAlone(t *testing.T) {
	guard := guardOver(ratelimit.NewMemoryStoreWithClock(fixedClock))
	app := requestFrom(t, "")
	for i := range defaultLimit(Search) * 3 {
		if !allow(t, guard, app, Search).Allowed {
			t.Fatalf("call %d a web app made as itself refused, want it never charged", i+1)
		}
	}
}

func TestInstancesSharingCountersCountAClientTogether(t *testing.T) {
	// The store stands in for the Redis both instances name: each has a guard
	// and a limiter of its own, and only the counters are shared.
	shared := ratelimit.NewMemoryStoreWithClock(fixedClock)
	first, second := guardOver(shared), guardOver(shared)
	reader := requestFrom(t, "203.0.113.10")
	limit := defaultLimit(Search)
	for i := range limit {
		guard := first
		if i%2 == 1 {
			guard = second
		}
		if !allow(t, guard, reader, Search).Allowed {
			t.Fatalf("read %d of %d refused, want the whole allowance served across both instances", i+1, limit)
		}
	}
	if allow(t, first, reader, Search).Allowed || allow(t, second, reader, Search).Allowed {
		t.Fatal("a read past the allowance spent across both instances allowed, want them to count the client together")
	}
}

func TestGuardChargesThePolicysLimits(t *testing.T) {
	limits := platformpolicy.ReadLimits{PublicAPI: 7, Search: 3, Images: 5}
	policy := platformpolicy.Defaults()
	policy.AnonymousReads = limits
	guard := New(ratelimit.NewWithClock(ratelimit.NewMemoryStoreWithClock(fixedClock), fixedClock), platformpolicy.Fixed(policy))
	reader := requestFrom(t, "203.0.113.10")
	for _, allowance := range []Allowance{PublicAPI, Search, Images} {
		limit := Limit(limits, allowance)
		for i := range limit {
			if !allow(t, guard, reader, allowance).Allowed {
				t.Fatalf("%s read %d of %d refused, want the policy's whole allowance served", allowance, i+1, limit)
			}
		}
		if allow(t, guard, reader, allowance).Allowed {
			t.Fatalf("%s read %d allowed, want it refused past the policy's %d", allowance, limit+1, limit)
		}
	}
}

func TestGuardFailsWhenThePolicyCannotBeRead(t *testing.T) {
	guard := New(ratelimit.NewWithClock(ratelimit.NewMemoryStoreWithClock(fixedClock), fixedClock), unreadablePolicy{})
	if _, err := guard.Allow(requestFrom(t, "203.0.113.10"), Search); err == nil {
		t.Fatal("Allow over a policy that cannot be read succeeded, want the error rather than a limit nobody set")
	}
}

type unreadablePolicy struct{}

func (unreadablePolicy) Policy(context.Context) (platformpolicy.Policy, error) {
	return platformpolicy.Policy{}, errors.New("the database is down")
}
