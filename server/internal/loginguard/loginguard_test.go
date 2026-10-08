package loginguard

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/platformpolicy"
	"github.com/publira/publira/server/internal/ratelimit"
	"github.com/publira/publira/server/internal/testutil"
)

// The windows are aligned to the epoch, so a test that wants to sit inside one
// starts from an instant that is not itself a boundary.
var testStart = time.Date(2026, 9, 10, 12, 30, 30, 0, time.UTC)

type fakeClock struct {
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	return c.now
}

func (c *fakeClock) advance(d time.Duration) {
	c.now = c.now.Add(d)
}

var (
	openAccount = platformpolicy.MinuteDay{PerMinute: 1000, PerDay: 1000}
	openSource  = platformpolicy.HourDay{PerHour: 1000, PerDay: 1000}
)

// newTestGuard drives the guard and its counters from one clock, so a window
// passes exactly when the test says it does.
func newTestGuard(t *testing.T, perAccount platformpolicy.MinuteDay, perSource platformpolicy.HourDay) (*Guard, *fakeClock) {
	t.Helper()

	policy := platformpolicy.Defaults()
	policy.LoginAttemptsPerAccount = perAccount
	policy.LoginAttemptsPerSource = perSource
	clock := &fakeClock{now: testStart}
	limiter := ratelimit.NewWithClock(ratelimit.NewMemoryStoreWithClock(clock.Now), clock.Now)
	return New(limiter, platformpolicy.Fixed(policy), slog.Default()), clock
}

// callFrom is the context of an RPC the edge recorded as coming from source.
func callFrom(t *testing.T, source string) context.Context {
	t.Helper()
	ctx, info := testutil.NewServerContext(t.Context())
	info.RequestHeader().Set("X-Forwarded-For", source+", 10.0.0.1")
	return ctx
}

const (
	testScope      = "11111111-1111-4111-8111-111111111111"
	testOtherScope = "22222222-2222-4222-8222-222222222222"
	testAddress    = "member@example.com"
	testSource     = "203.0.113.10"
	testOtherSrc   = "198.51.100.7"
)

func TestGuardRefusesPastTheAccountAllowance(t *testing.T) {
	const allowance = 3
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: allowance, PerDay: 100}, openSource)

	for attempt := 1; attempt <= allowance; attempt++ {
		if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress); err != nil {
			t.Fatalf("attempt %d = %v, want the first %d allowed", attempt, err, allowance)
		}
	}

	_, err := guard.Begin(callFrom(t, testSource), testScope, testAddress)
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("attempt %d code = %v, want resource_exhausted (err=%v)", allowance+1, connect.CodeOf(err), err)
	}
	// Spreading the guesses over origins does not widen what one account may
	// be guessed at.
	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, testAddress); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the same account from another origin code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

// The daily budget is what a guesser pacing itself under the minute still runs
// into.
func TestGuardKeepsTheDailyBudgetAcrossWindows(t *testing.T) {
	guard, clock := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 1, PerDay: 2}, openSource)

	for minute := range 2 {
		if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress); err != nil {
			t.Fatalf("the attempt in minute %d = %v, want it allowed", minute, err)
		}
		clock.advance(time.Minute)
	}

	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress); err == nil {
		t.Fatal("the third attempt of the day = allowed, want the daily budget to refuse it")
	}
}

// A person who mistyped and then got it right is not held back: reaching the
// password proves they were not guessing.
func TestGuardVerifiedClearsTheAccountCount(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 3, PerDay: 3}, openSource)

	for typo := 1; typo <= 2; typo++ {
		if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress); err != nil {
			t.Fatalf("typo %d = %v, want it allowed", typo, err)
		}
	}
	attempt, err := guard.Begin(callFrom(t, testSource), testScope, testAddress)
	if err != nil {
		t.Fatalf("the right password on the last allowance = %v, want it allowed", err)
	}
	attempt.Verified(callFrom(t, testSource))

	for typo := 1; typo <= 3; typo++ {
		if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress); err != nil {
			t.Fatalf("typo %d after the right password = %v, want the count cleared", typo, err)
		}
	}
}

// What the origin's allowance counts is guesses: an origin that signs people in
// all day long, a shared network say, is not refused for it.
func TestGuardVerifiedGivesTheOriginItsChargeBack(t *testing.T) {
	guard, _ := newTestGuard(t, openAccount, platformpolicy.HourDay{PerHour: 2, PerDay: 2})

	for signIn := 1; signIn <= 5; signIn++ {
		attempt, err := guard.Begin(callFrom(t, testSource), testScope, testAddress)
		if err != nil {
			t.Fatalf("sign-in %d = %v, want the origin's allowance untouched by the ones before", signIn, err)
		}
		attempt.Verified(callFrom(t, testSource))
	}
	for guess := 1; guess <= 2; guess++ {
		if _, err := guard.Begin(callFrom(t, testSource), testScope, "other@example.com"); err != nil {
			t.Fatalf("guess %d = %v, want it allowed", guess, err)
		}
	}
	// Signing in to an account it holds does not clear what the origin spent
	// guessing at another.
	attempt, err := guard.Begin(callFrom(t, testSource), testScope, testAddress)
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a sign-in after two guesses code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if attempt != nil {
		t.Fatal("a refused attempt was handed an Attempt to verify")
	}
}

// One account written two ways is one account.
func TestGuardTreatsOneAddressWrittenTwoWaysAsOne(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 1, PerDay: 100}, openSource)

	if _, err := guard.Begin(callFrom(t, testSource), testScope, " Member@Example.com "); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress); err == nil {
		t.Fatal("the same address in another spelling = allowed, want one allowance for one account")
	}
	// A tagged address is a different account, not another spelling of this one.
	if _, err := guard.Begin(callFrom(t, testSource), testScope, "member+news@example.com"); err != nil {
		t.Fatalf("a tagged address = %v, want an allowance of its own", err)
	}
}

// Guessing on one storefront must not lock the owner of the same address out of
// another, or out of the platform console.
func TestGuardKeepsScopesApart(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 1, PerDay: 100}, openSource)

	for _, scope := range []string{testScope, testOtherScope, PlatformScope} {
		if _, err := guard.Begin(callFrom(t, testSource), scope, testAddress); err != nil {
			t.Fatalf("the first attempt in scope %q = %v, want an allowance of its own", scope, err)
		}
	}
}

// What bounds one origin trying one password against many addresses is the
// origin's own allowance, which no scope is part of.
func TestGuardChargesOneOriginAcrossAddressesAndScopes(t *testing.T) {
	guard, _ := newTestGuard(t, openAccount, platformpolicy.HourDay{PerHour: 2, PerDay: 100})

	if _, err := guard.Begin(callFrom(t, testSource), testScope, "first@example.com"); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testOtherScope, "second@example.com"); err != nil {
		t.Fatalf("the second attempt = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), PlatformScope, "third@example.com"); err == nil {
		t.Fatal("a third address from the same origin = allowed, want the origin's allowance to refuse it")
	}
	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, "fourth@example.com"); err != nil {
		t.Fatalf("another origin's attempt = %v, want an allowance of its own", err)
	}
}

// A stranger held off by the origin's allowance must not have spent the
// allowance of every address they named on the way there, or refusing them
// would lock out the accounts they were guessing at.
func TestGuardDoesNotSpendTheAccountAllowanceOnARefusedOrigin(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 1, PerDay: 100}, platformpolicy.HourDay{PerHour: 1, PerDay: 100})

	if _, err := guard.Begin(callFrom(t, testSource), testScope, "first@example.com"); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress); err == nil {
		t.Fatal("a second attempt from the same origin = allowed, want it refused")
	}

	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, testAddress); err != nil {
		t.Fatalf("the account owner's own attempt = %v, want its allowance intact", err)
	}
}

// The refusal comes before anything looks the address up, and a refusal that
// differed by address would say which ones hold an account.
func TestGuardRefusesEveryAddressTheSameWay(t *testing.T) {
	guard, _ := newTestGuard(t, openAccount, platformpolicy.HourDay{PerHour: 1, PerDay: 100})

	if _, err := guard.Begin(callFrom(t, testSource), testScope, "registered@example.com"); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}

	_, registered := guard.Begin(callFrom(t, testSource), testScope, "registered@example.com")
	_, free := guard.Begin(callFrom(t, testSource), testScope, "free@example.com")
	if registered == nil || free == nil {
		t.Fatalf("refusals = %v and %v, want both refused", registered, free)
	}
	if registered.Error() != free.Error() || connect.CodeOf(registered) != connect.CodeOf(free) {
		t.Fatalf("the registered address is refused with %v and the free one with %v, want one answer", registered, free)
	}
}

// A refusal says how long the wait is, so a client can tell the person when to
// come back instead of repeating that the password is wrong.
func TestGuardSaysHowLongToWait(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 1, PerDay: 100}, openSource)

	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}
	ctx, info := testutil.NewServerContext(t.Context())
	info.RequestHeader().Set("X-Forwarded-For", testSource)
	_, err := guard.Begin(ctx, testScope, testAddress)
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	// The minute this attempt is in has half of itself left to run.
	if got := info.ResponseHeader().Get("Retry-After"); got != "30" {
		t.Fatalf("Retry-After = %q, want the 30s left of the window", got)
	}
}
