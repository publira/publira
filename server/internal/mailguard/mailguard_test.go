package mailguard

import (
	"errors"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/ratelimit"
)

// The windows are aligned to the epoch, so a test that wants to sit inside one
// starts from an instant that is not itself a boundary.
var testStart = time.Date(2026, 9, 10, 12, 30, 0, 0, time.UTC)

type fakeClock struct {
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	return c.now
}

func (c *fakeClock) advance(d time.Duration) {
	c.now = c.now.Add(d)
}

// newTestGuard drives the guard and its counters from one clock, so a window
// passes exactly when the test says it does.
func newTestGuard(t *testing.T, perAddress, perSource []ratelimit.Rule) (*Guard, *fakeClock) {
	t.Helper()

	clock := &fakeClock{now: testStart}
	limiter := ratelimit.NewWithClock(ratelimit.NewMemoryStoreWithClock(clock.Now), clock.Now)
	return New(limiter, perAddress, perSource, slog.Default()), clock
}

// request stands for one submission of a form, arriving from source through the
// edge that records it.
func request(source string) connect.AnyRequest {
	req := connect.NewRequest(&struct{}{})
	if source != "" {
		req.Header().Set("X-Forwarded-For", source+", 10.0.0.1")
	}
	return req
}

const (
	testScope      = "11111111-1111-4111-8111-111111111111"
	testOtherScope = "22222222-2222-4222-8222-222222222222"
	testAddress    = "member@example.com"
	testSource     = "203.0.113.10"
)

func TestGuardRefusesPastTheMailboxAllowance(t *testing.T) {
	const allowance = 3
	guard, _ := newTestGuard(t, Rules(allowance, 100), Rules(1000, 1000))

	for attempt := 1; attempt <= allowance; attempt++ {
		if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err != nil {
			t.Fatalf("attempt %d = %v, want the first %d allowed", attempt, err, allowance)
		}
	}

	err := guard.Allow(t.Context(), request(testSource), testScope, testAddress)
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("attempt %d code = %v, want resource_exhausted (err=%v)", allowance+1, connect.CodeOf(err), err)
	}
}

func TestGuardStartsAFreshAllowanceWhenTheWindowPasses(t *testing.T) {
	guard, clock := newTestGuard(t, Rules(1, 100), Rules(1000, 1000))

	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err != nil {
		t.Fatalf("the first request = %v, want it allowed", err)
	}
	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err == nil {
		t.Fatal("the second request in the window = allowed, want it refused")
	}

	// The hour this address started in runs to 13:00, so it is still the same
	// hour one instant before that.
	clock.advance(30*time.Minute - time.Nanosecond)
	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err == nil {
		t.Fatal("a request at the last instant of the window = allowed, want it refused")
	}

	clock.advance(time.Nanosecond)
	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err != nil {
		t.Fatalf("the first request of the next window = %v, want a fresh allowance", err)
	}
}

// The daily budget is what a caller pacing itself under the hourly one still
// runs into.
func TestGuardKeepsTheDailyBudgetAcrossWindows(t *testing.T) {
	guard, clock := newTestGuard(t, Rules(1, 2), Rules(1000, 1000))

	for hour := range 2 {
		if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err != nil {
			t.Fatalf("the request in hour %d = %v, want it allowed", hour, err)
		}
		clock.advance(time.Hour)
	}

	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err == nil {
		t.Fatal("the third request of the day = allowed, want the daily budget to refuse it")
	}
}

// One mailbox holds one inbox however it is spelled, so the allowance follows
// the mailbox rather than the spelling.
func TestGuardTreatsOneMailboxWrittenTwoWaysAsOne(t *testing.T) {
	guard, _ := newTestGuard(t, Rules(1, 100), Rules(1000, 1000))

	if err := guard.Allow(t.Context(), request(testSource), testScope, " Member@Example.com "); err != nil {
		t.Fatalf("the first request = %v, want it allowed", err)
	}
	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err == nil {
		t.Fatal("the same mailbox in another spelling = allowed, want one allowance for one inbox")
	}
}

// A storefront's traffic must not spend the allowance the reader of another one
// needs for their own password reset.
func TestGuardKeepsScopesApart(t *testing.T) {
	guard, _ := newTestGuard(t, Rules(1, 100), Rules(1000, 1000))

	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err != nil {
		t.Fatalf("the first scope's request = %v, want it allowed", err)
	}
	if err := guard.Allow(t.Context(), request(testSource), testOtherScope, testAddress); err != nil {
		t.Fatalf("another scope's request = %v, want an allowance of its own", err)
	}
	if err := guard.Allow(t.Context(), request(testSource), PlatformScope, testAddress); err != nil {
		t.Fatalf("the platform console's request = %v, want an allowance of its own", err)
	}
}

// What bounds one origin spreading itself over addresses and scopes is the
// origin's own allowance, which no scope is part of.
func TestGuardChargesOneOriginAcrossAddressesAndScopes(t *testing.T) {
	guard, _ := newTestGuard(t, Rules(1000, 1000), Rules(2, 100))

	if err := guard.Allow(t.Context(), request(testSource), testScope, "first@example.com"); err != nil {
		t.Fatalf("the first request = %v, want it allowed", err)
	}
	if err := guard.Allow(t.Context(), request(testSource), testOtherScope, "second@example.com"); err != nil {
		t.Fatalf("the second request = %v, want it allowed", err)
	}
	if err := guard.Allow(t.Context(), request(testSource), PlatformScope, "third@example.com"); err == nil {
		t.Fatal("a third address from the same origin = allowed, want the origin's allowance to refuse it")
	}
	if err := guard.Allow(t.Context(), request("198.51.100.7"), testScope, "fourth@example.com"); err != nil {
		t.Fatalf("another origin's request = %v, want an allowance of its own", err)
	}
}

// The forms this guards answer a registered address exactly as they answer a
// free one, and a refusal that named one of them would give that away.
func TestGuardRefusesEveryAddressTheSameWay(t *testing.T) {
	guard, _ := newTestGuard(t, Rules(1000, 1000), Rules(1, 100))

	if err := guard.Allow(t.Context(), request(testSource), testScope, "registered@example.com"); err != nil {
		t.Fatalf("the first request = %v, want it allowed", err)
	}

	registered := guard.Allow(t.Context(), request(testSource), testScope, "registered@example.com")
	free := guard.Allow(t.Context(), request(testSource), testScope, "free@example.com")
	if registered == nil || free == nil {
		t.Fatalf("refusals = %v and %v, want both refused", registered, free)
	}
	if registered.Error() != free.Error() {
		t.Fatalf("the registered address is refused with %q and the free one with %q, want one answer", registered, free)
	}
	if connect.CodeOf(registered) != connect.CodeOf(free) {
		t.Fatalf("codes = %v and %v, want one answer", connect.CodeOf(registered), connect.CodeOf(free))
	}
}

// A stranger held off by the origin's allowance must not have spent the mailbox
// allowance of every address they named on the way there, or refusing them
// would itself be the flood the mailbox rule exists to stop.
func TestGuardDoesNotSpendTheMailboxAllowanceOnARefusedOrigin(t *testing.T) {
	guard, _ := newTestGuard(t, Rules(1, 100), Rules(1, 100))

	if err := guard.Allow(t.Context(), request(testSource), testScope, "first@example.com"); err != nil {
		t.Fatalf("the first request = %v, want it allowed", err)
	}
	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err == nil {
		t.Fatal("a second request from the same origin = allowed, want it refused")
	}

	// The mailbox that request named received nothing, so its own allowance is
	// untouched when it asks from somewhere else.
	if err := guard.Allow(t.Context(), request("198.51.100.7"), testScope, testAddress); err != nil {
		t.Fatalf("the mailbox's own request = %v, want its allowance intact", err)
	}
}

// A refusal says how long the wait is, so a reader can be told when to come
// back instead of being left to guess.
func TestGuardSaysHowLongToWait(t *testing.T) {
	guard, _ := newTestGuard(t, Rules(1, 100), Rules(1000, 1000))

	if err := guard.Allow(t.Context(), request(testSource), testScope, testAddress); err != nil {
		t.Fatalf("the first request = %v, want it allowed", err)
	}
	err := guard.Allow(t.Context(), request(testSource), testScope, testAddress)
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("error %v is not a connect error", err)
	}
	// The hour this address is in has half of itself left to run.
	if got := connectErr.Meta().Get("Retry-After"); got != "1800" {
		t.Fatalf("Retry-After = %q, want the 1800s left of the window", got)
	}
}

// A request that reached a server without passing the edge still has an origin,
// and every connection from it is that one origin rather than a fresh one.
func TestGuardChargesThePeerWhenTheEdgeRecordedNothing(t *testing.T) {
	guard, _ := newTestGuard(t, Rules(1000, 1000), Rules(1, 100))

	if err := guard.Allow(t.Context(), peerRequest("192.0.2.5:41000"), testScope, "first@example.com"); err != nil {
		t.Fatalf("the first request = %v, want it allowed", err)
	}
	if err := guard.Allow(t.Context(), peerRequest("192.0.2.5:41001"), testScope, "second@example.com"); err == nil {
		t.Fatal("another connection from the same peer = allowed, want one origin to hold one allowance")
	}
}

func TestSourcePrefersTheAddressTheEdgeRecorded(t *testing.T) {
	req := connect.NewRequest(&struct{}{})
	req.Header().Set("X-Forwarded-For", " 203.0.113.10 , 10.0.0.1 ")
	if got := source(req); got != "203.0.113.10" {
		t.Fatalf("source = %q, want the first entry of X-Forwarded-For", got)
	}
}

func TestRulesPairAnHourlyBurstWithADailyBudget(t *testing.T) {
	rules := Rules(5, 20)

	want := []ratelimit.Rule{
		{Limit: 5, Window: time.Hour},
		{Limit: 20, Window: 24 * time.Hour},
	}
	if fmt.Sprint(rules) != fmt.Sprint(want) {
		t.Fatalf("rules = %v, want %v", rules, want)
	}
}

// peerRequest stands for a request that reached a server without passing an
// edge, so the connection it arrived on is all there is to charge.
func peerRequest(addr string) connect.AnyRequest {
	return peerOnlyRequest{Request: connect.NewRequest(&struct{}{}), addr: addr}
}

type peerOnlyRequest struct {
	*connect.Request[struct{}]
	addr string
}

func (r peerOnlyRequest) Peer() connect.Peer {
	return connect.Peer{Addr: r.addr}
}
