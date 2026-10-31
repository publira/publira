package readguard

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/ratelimit"
)

// instant is not at the start of a window, so a test's burst lands in one.
var instant = time.Date(2026, 9, 10, 12, 30, 31, 0, time.UTC)

func fixedClock() time.Time { return instant }

func guardOver(store ratelimit.Store) *Guard {
	return New(ratelimit.NewWithClock(store, fixedClock))
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
			limit := Rule(allowance).Limit
			for i := range limit {
				if !allow(t, guard, reader, allowance).Allowed {
					t.Fatalf("read %d of %d refused, want the whole allowance served", i+1, limit)
				}
			}
			refused := allow(t, guard, reader, allowance)
			if refused.Allowed {
				t.Fatalf("read %d allowed, want it refused past the allowance of %d", limit+1, limit)
			}
			if refused.RetryAfter <= 0 || refused.RetryAfter > window {
				t.Fatalf("RetryAfter = %s, want what is left of the %s window", refused.RetryAfter, window)
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
	for range Rule(Search).Limit + 1 {
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
	for i := range Rule(Search).Limit * 3 {
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
	limit := Rule(Search).Limit
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

// TestAllowancesAreNoTighterThanTheEdges reads the allowances the routing
// contract gives the edge, and fails when they and EdgeRates part, or when the
// server would refuse a client the edge still admits.
func TestAllowancesAreNoTighterThanTheEdges(t *testing.T) {
	file, err := os.Open("../../../infra/proxy/README.md")
	if err != nil {
		t.Fatalf("open the routing contract: %v", err)
	}
	defer file.Close() //nolint:errcheck

	rows := map[string]Allowance{
		"`/rpc/publira.v1.…`, except the search below":      PublicAPI,
		"`/rpc/publira.v1.CatalogService/SearchPublished…`": Search,
		"`/images…`": Images,
	}
	found := map[Allowance]Rate{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		cells := strings.Split(strings.Trim(scanner.Text(), "| "), " | ")
		if len(cells) != 4 {
			continue
		}
		allowance, ok := rows[cells[0]]
		if !ok {
			continue
		}
		burst, burstErr := strconv.Atoi(cells[2])
		perSecond, rateErr := strconv.Atoi(cells[3])
		if burstErr != nil || rateErr != nil {
			t.Fatalf("row %q does not name a burst and a rate", scanner.Text())
		}
		found[allowance] = Rate{Burst: burst, PerSecond: perSecond}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("read the routing contract: %v", err)
	}

	for allowance, want := range EdgeRates {
		got, ok := found[allowance]
		if !ok {
			t.Errorf("the routing contract has no row for %s", allowance)
			continue
		}
		if got != want {
			t.Errorf("the routing contract gives %s %+v, EdgeRates %+v", allowance, got, want)
		}
		// The most the edge admits in one of the server's windows.
		admitted := got.Burst + got.PerSecond*int(window/time.Second)
		if rule := Rule(allowance); rule.Limit < admitted {
			t.Errorf("%s allows %d reads in %s, fewer than the %d the edge admits", allowance, rule.Limit, rule.Window, admitted)
		}
	}
}
