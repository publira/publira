package loginguard

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auth"
	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/platformpolicy"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
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
	guard := New(limiter, platformpolicy.Fixed(policy), testutil.TokenManager(), slog.Default())
	guard.now = clock.Now
	return guard, clock
}

// callFrom is the context of an RPC whose client address was determined as
// source.
func callFrom(t *testing.T, source string) context.Context {
	t.Helper()
	ctx, _ := testutil.NewServerContext(t.Context())
	return clientip.NewContext(ctx, source)
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
		if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); err != nil {
			t.Fatalf("attempt %d = %v, want the first %d allowed", attempt, err, allowance)
		}
	}

	_, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, "")
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("attempt %d code = %v, want resource_exhausted (err=%v)", allowance+1, connect.CodeOf(err), err)
	}
}

// A stranger guessing from one origin spends the address's allowance at that
// origin and no other, so the owner signing in from anywhere else is not
// locked out by them.
func TestGuardLeavesTheAddressOpenAtOtherOrigins(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 100, PerDay: 3}, openSource)

	for guess := 1; guess <= 3; guess++ {
		if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); err != nil {
			t.Fatalf("guess %d = %v, want it allowed", guess, err)
		}
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a guess past the day's allowance code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, testAddress, ""); err != nil {
		t.Fatalf("the owner's attempt from another origin = %v, want an allowance of its own", err)
	}
}

// Spreading the guesses over origins still meets a bound: every device the
// address never signed in from shares one allowance, unseenOrigins origins'
// worth of the one each origin has.
func TestGuardBoundsTheGuessingSpreadOverOrigins(t *testing.T) {
	const perOrigin = 2
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 100, PerDay: perOrigin}, openSource)

	for origin := range unseenOrigins {
		source := fmt.Sprintf("203.0.113.%d", origin+1)
		for guess := 1; guess <= perOrigin; guess++ {
			if _, err := guard.Begin(callFrom(t, source), testScope, testAddress, ""); err != nil {
				t.Fatalf("guess %d from %s = %v, want it allowed", guess, source, err)
			}
		}
	}
	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, testAddress, ""); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("one more origin code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

// The device the owner signed in from before is not one of the devices that
// share the address's allowance, so nobody else spending it keeps them out.
func TestGuardLetsAKnownDeviceInPastTheSharedAllowance(t *testing.T) {
	const perOrigin = 2
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 100, PerDay: perOrigin}, openSource)
	device := signInOnce(t, guard, testOtherSrc)

	for origin := range unseenOrigins {
		source := fmt.Sprintf("203.0.113.%d", origin+1)
		for guess := 1; guess <= perOrigin; guess++ {
			if _, err := guard.Begin(callFrom(t, source), testScope, testAddress, ""); err != nil {
				t.Fatalf("guess %d from %s = %v, want it allowed", guess, source, err)
			}
		}
	}
	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, testAddress, ""); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a device never seen code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, testAddress, device.GetToken()); err != nil {
		t.Fatalf("the owner's device = %v, want its allowance of its own", err)
	}
	// Even at the origin a stranger exhausted: the device's allowance is not
	// the origin's.
	if _, err := guard.Begin(callFrom(t, "203.0.113.1"), testScope, testAddress, device.GetToken()); err != nil {
		t.Fatalf("the owner's device at the stranger's origin = %v, want its allowance of its own", err)
	}
}

// A device still has an allowance: a token taken from it buys a stranger no
// more guesses than the origin they guess from has.
func TestGuardRefusesAKnownDevicePastItsOwnAllowance(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 100, PerDay: 2}, openSource)
	device := signInOnce(t, guard, testSource)

	for guess := 1; guess <= 2; guess++ {
		if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, testAddress, device.GetToken()); err != nil {
			t.Fatalf("guess %d with the device = %v, want it allowed", guess, err)
		}
	}
	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, testAddress, device.GetToken()); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("a guess past the device's allowance code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
}

// A token that does not vouch for this address is no token: it is not
// refused, which would tell a caller something about it, and it buys nothing.
func TestGuardTreatsAForeignDeviceTokenAsNone(t *testing.T) {
	guard, clock := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 100, PerDay: 1}, openSource)
	otherAddress := mustVerify(t, guard, testSource, testScope, "other@example.com")
	otherScope := mustVerify(t, guard, testSource, testOtherScope, testAddress)
	forged, _, err := auth.NewTokenManager([]byte("a-secret-this-deployment-never-held")).IssueLoginDeviceToken(addressName(testScope, testAddress), clock.now)
	if err != nil {
		t.Fatalf("IssueLoginDeviceToken: %v", err)
	}
	accessToken, _, err := testutil.TokenManager().Issue("USER0000001", auth.AudiencePublic, testScope, "", 1, clock.now)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	for name, token := range map[string]string{
		"another address's":  otherAddress.GetToken(),
		"another scope's":    otherScope.GetToken(),
		"forged":             forged,
		"an access token as": accessToken,
		"malformed":          "not-a-token",
	} {
		t.Run(name, func(t *testing.T) {
			source := "192.0.2." + strconv.Itoa(len(name))
			if _, err := guard.Begin(callFrom(t, source), testScope, testAddress, token); err != nil {
				t.Fatalf("the first attempt = %v, want it allowed as one from a device never seen", err)
			}
			if _, err := guard.Begin(callFrom(t, source), testScope, testAddress, token); connect.CodeOf(err) != connect.CodeResourceExhausted {
				t.Fatalf("the second attempt code = %v, want the origin's allowance to refuse it (err=%v)", connect.CodeOf(err), err)
			}
		})
	}
}

// A device token runs out, and the device is then one never seen.
func TestGuardForgetsADeviceOnceItsTokenExpires(t *testing.T) {
	guard, clock := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 100, PerDay: 1}, openSource)
	device := signInOnce(t, guard, testSource)

	clock.advance(auth.LoginDeviceTTL + time.Minute)
	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, device.GetToken()); err != nil {
		t.Fatalf("the first attempt after expiry = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, device.GetToken()); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second attempt after expiry code = %v, want the origin's allowance to refuse it (err=%v)", connect.CodeOf(err), err)
	}
}

// Every sign-in answers a device of its own, so the device a stranger spent
// does not stay spent for the owner once they sign in again.
func TestGuardVerifiedAnswersAFreshDevice(t *testing.T) {
	guard, clock := newTestGuard(t, openAccount, openSource)

	first := signInOnce(t, guard, testSource)
	second := signInOnce(t, guard, testSource)
	if first.GetToken() == "" || second.GetToken() == "" || first.GetToken() == second.GetToken() {
		t.Fatalf("device tokens = %q and %q, want two different ones", first.GetToken(), second.GetToken())
	}
	want := clock.now.Add(auth.LoginDeviceTTL).UTC().Format(time.RFC3339)
	if second.GetExpiresAt() != want {
		t.Fatalf("expires_at = %q, want %q", second.GetExpiresAt(), want)
	}
}

// A guard with nothing to sign devices with treats every attempt as one from a
// device never seen, and answers none.
func TestGuardWithoutTokensSignsNoDevice(t *testing.T) {
	limiter := ratelimit.New(ratelimit.NewMemoryStore())
	guard := New(limiter, platformpolicy.Fixed(platformpolicy.Defaults()), nil, slog.Default())

	attempt, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, "")
	if err != nil {
		t.Fatalf("Begin = %v, want it allowed", err)
	}
	if device := attempt.Verified(callFrom(t, testSource)); device != nil {
		t.Fatalf("Verified = %v, want no device", device)
	}
}

// What an operator lifts is every allowance of the address, at every origin and
// on every device, and nothing of any other address or of the origins.
func TestLiftStartsTheAddressAfresh(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 100, PerDay: 1}, platformpolicy.HourDay{PerHour: 100, PerDay: 100})
	device := signInOnce(t, guard, testSource)

	for origin := range unseenOrigins {
		source := fmt.Sprintf("203.0.113.%d", origin+1)
		if _, err := guard.Begin(callFrom(t, source), testScope, testAddress, ""); err != nil {
			t.Fatalf("the guess from %s = %v, want it allowed", source, err)
		}
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, device.GetToken()); err != nil {
		t.Fatalf("the device's one attempt = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, "other@example.com", ""); err != nil {
		t.Fatalf("another address = %v, want it allowed", err)
	}

	if err := Lift(t.Context(), guard.limiter, testScope, testAddress); err != nil {
		t.Fatalf("Lift: %v", err)
	}

	if _, err := guard.Begin(callFrom(t, "203.0.113.1"), testScope, testAddress, ""); err != nil {
		t.Fatalf("a guessing origin after the lift = %v, want the address's allowance there afresh", err)
	}
	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, testAddress, ""); err != nil {
		t.Fatalf("an origin never seen after the lift = %v, want the shared allowance afresh", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, device.GetToken()); err != nil {
		t.Fatalf("the device after the lift = %v, want its allowance afresh", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, "other@example.com", ""); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("another address after the lift code = %v, want what it spent to stand (err=%v)", connect.CodeOf(err), err)
	}
}

// signInOnce signs in to testAddress within testScope from source with the
// right password, and answers the device the sign-in hands back.
func signInOnce(t *testing.T, guard *Guard, source string) *publirattypesv1.LoginDevice {
	t.Helper()
	return mustVerify(t, guard, source, testScope, testAddress)
}

func mustVerify(t *testing.T, guard *Guard, source, scope, address string) *publirattypesv1.LoginDevice {
	t.Helper()
	attempt, err := guard.Begin(callFrom(t, source), scope, address, "")
	if err != nil {
		t.Fatalf("the sign-in to %s = %v, want it allowed", address, err)
	}
	device := attempt.Verified(callFrom(t, source))
	if device.GetToken() == "" {
		t.Fatalf("the sign-in to %s answered no device", address)
	}
	return device
}

// The daily budget is what a guesser pacing itself under the minute still runs
// into.
func TestGuardKeepsTheDailyBudgetAcrossWindows(t *testing.T) {
	guard, clock := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 1, PerDay: 2}, openSource)

	for minute := range 2 {
		if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); err != nil {
			t.Fatalf("the attempt in minute %d = %v, want it allowed", minute, err)
		}
		clock.advance(time.Minute)
	}

	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); err == nil {
		t.Fatal("the third attempt of the day = allowed, want the daily budget to refuse it")
	}
}

// A person who mistyped and then got it right is not held back: reaching the
// password proves they were not guessing.
func TestGuardVerifiedClearsTheAccountCount(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 3, PerDay: 3}, openSource)

	for typo := 1; typo <= 2; typo++ {
		if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); err != nil {
			t.Fatalf("typo %d = %v, want it allowed", typo, err)
		}
	}
	attempt, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, "")
	if err != nil {
		t.Fatalf("the right password on the last allowance = %v, want it allowed", err)
	}
	attempt.Verified(callFrom(t, testSource))

	for typo := 1; typo <= 3; typo++ {
		if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); err != nil {
			t.Fatalf("typo %d after the right password = %v, want the count cleared", typo, err)
		}
	}
}

// What the origin's allowance counts is guesses: an origin that signs people in
// all day long, a shared network say, is not refused for it.
func TestGuardVerifiedGivesTheOriginItsChargeBack(t *testing.T) {
	guard, _ := newTestGuard(t, openAccount, platformpolicy.HourDay{PerHour: 2, PerDay: 2})

	for signIn := 1; signIn <= 5; signIn++ {
		attempt, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, "")
		if err != nil {
			t.Fatalf("sign-in %d = %v, want the origin's allowance untouched by the ones before", signIn, err)
		}
		attempt.Verified(callFrom(t, testSource))
	}
	for guess := 1; guess <= 2; guess++ {
		if _, err := guard.Begin(callFrom(t, testSource), testScope, "other@example.com", ""); err != nil {
			t.Fatalf("guess %d = %v, want it allowed", guess, err)
		}
	}
	// Signing in to an account it holds does not clear what the origin spent
	// guessing at another.
	attempt, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, "")
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

	if _, err := guard.Begin(callFrom(t, testSource), testScope, " Member@Example.com ", ""); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); err == nil {
		t.Fatal("the same address in another spelling = allowed, want one allowance for one account")
	}
	// A tagged address is a different account, not another spelling of this one.
	if _, err := guard.Begin(callFrom(t, testSource), testScope, "member+news@example.com", ""); err != nil {
		t.Fatalf("a tagged address = %v, want an allowance of its own", err)
	}
}

// Guessing on one storefront must not lock the owner of the same address out of
// another, or out of the platform console.
func TestGuardKeepsScopesApart(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 1, PerDay: 100}, openSource)

	for _, scope := range []string{testScope, testOtherScope, PlatformScope} {
		if _, err := guard.Begin(callFrom(t, testSource), scope, testAddress, ""); err != nil {
			t.Fatalf("the first attempt in scope %q = %v, want an allowance of its own", scope, err)
		}
	}
}

// What bounds one origin trying one password against many addresses is the
// origin's own allowance, which no scope is part of.
func TestGuardChargesOneOriginAcrossAddressesAndScopes(t *testing.T) {
	guard, _ := newTestGuard(t, openAccount, platformpolicy.HourDay{PerHour: 2, PerDay: 100})

	if _, err := guard.Begin(callFrom(t, testSource), testScope, "first@example.com", ""); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testOtherScope, "second@example.com", ""); err != nil {
		t.Fatalf("the second attempt = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), PlatformScope, "third@example.com", ""); err == nil {
		t.Fatal("a third address from the same origin = allowed, want the origin's allowance to refuse it")
	}
	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, "fourth@example.com", ""); err != nil {
		t.Fatalf("another origin's attempt = %v, want an allowance of its own", err)
	}
}

// A stranger held off by the origin's allowance must not have spent the
// allowance of every address they named on the way there, or refusing them
// would lock out the accounts they were guessing at.
func TestGuardDoesNotSpendTheAccountAllowanceOnARefusedOrigin(t *testing.T) {
	guard, _ := newTestGuard(t, platformpolicy.MinuteDay{PerMinute: 1, PerDay: 100}, platformpolicy.HourDay{PerHour: 1, PerDay: 100})

	if _, err := guard.Begin(callFrom(t, testSource), testScope, "first@example.com", ""); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); err == nil {
		t.Fatal("a second attempt from the same origin = allowed, want it refused")
	}

	if _, err := guard.Begin(callFrom(t, testOtherSrc), testScope, testAddress, ""); err != nil {
		t.Fatalf("the account owner's own attempt = %v, want its allowance intact", err)
	}
}

// The refusal comes before anything looks the address up, and a refusal that
// differed by address would say which ones hold an account.
func TestGuardRefusesEveryAddressTheSameWay(t *testing.T) {
	guard, _ := newTestGuard(t, openAccount, platformpolicy.HourDay{PerHour: 1, PerDay: 100})

	if _, err := guard.Begin(callFrom(t, testSource), testScope, "registered@example.com", ""); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}

	_, registered := guard.Begin(callFrom(t, testSource), testScope, "registered@example.com", "")
	_, free := guard.Begin(callFrom(t, testSource), testScope, "free@example.com", "")
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

	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); err != nil {
		t.Fatalf("the first attempt = %v, want it allowed", err)
	}
	ctx, info := testutil.NewServerContext(t.Context())
	_, err := guard.Begin(clientip.NewContext(ctx, testSource), testScope, testAddress, "")
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	// The minute this attempt is in has half of itself left to run.
	if got := info.ResponseHeader().Get("Retry-After"); got != "30" {
		t.Fatalf("Retry-After = %q, want the 30s left of the window", got)
	}
}

// newStepUpGuard is a guard whose step-up allowance is perAccount.
func newStepUpGuard(t *testing.T, perAccount platformpolicy.MinuteDay) *Guard {
	t.Helper()

	policy := platformpolicy.Defaults()
	policy.PasswordVerification = perAccount
	clock := &fakeClock{now: testStart}
	limiter := ratelimit.NewWithClock(ratelimit.NewMemoryStoreWithClock(clock.Now), clock.Now)
	return New(limiter, platformpolicy.Fixed(policy), nil, slog.Default())
}

const (
	testAccount      = "33333333-3333-4333-8333-333333333333"
	testOtherAccount = "44444444-4444-4444-8444-444444444444"
)

func TestStepUpRefusesPastTheAccountAllowance(t *testing.T) {
	const allowance = 3
	guard := newStepUpGuard(t, platformpolicy.MinuteDay{PerMinute: allowance, PerDay: 100})

	for attempt := 1; attempt <= allowance; attempt++ {
		if err := guard.ChargeStepUp(callFrom(t, testSource), testScope, testAccount); err != nil {
			t.Fatalf("attempt %d = %v, want the first %d allowed", attempt, err, allowance)
		}
	}
	err := guard.ChargeStepUp(callFrom(t, testSource), testScope, testAccount)
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("attempt %d code = %v, want resource_exhausted (err=%v)", allowance+1, connect.CodeOf(err), err)
	}
	// The allowance is the account's, so a second origin does not widen it.
	if err := guard.ChargeStepUp(callFrom(t, testOtherSrc), testScope, testAccount); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the same account from another origin code = %v, want resource_exhausted (err=%v)", connect.CodeOf(err), err)
	}
	// Nor is another account, or the same id in another scope, held back.
	if err := guard.ChargeStepUp(callFrom(t, testSource), testScope, testOtherAccount); err != nil {
		t.Fatalf("another account = %v, want it allowed", err)
	}
	if err := guard.ChargeStepUp(callFrom(t, testSource), testOtherScope, testAccount); err != nil {
		t.Fatalf("the same id in another scope = %v, want it allowed", err)
	}
}

// The step-up allowance and the sign-in allowance are two counts: a session
// that guessed its way through one has not spent the other.
func TestStepUpIsKeptApartFromSignIn(t *testing.T) {
	guard := newStepUpGuard(t, platformpolicy.MinuteDay{PerMinute: 1, PerDay: 1})

	if err := guard.ChargeStepUp(callFrom(t, testSource), testScope, testAccount); err != nil {
		t.Fatalf("the step-up check = %v, want it allowed", err)
	}
	if _, err := guard.Begin(callFrom(t, testSource), testScope, testAddress, ""); err != nil {
		t.Fatalf("a sign-in after the step-up allowance ran out = %v, want it allowed", err)
	}
}

// Someone who mistyped their password and then got it right is not held back.
func TestStepUpVerifiedClearsTheCount(t *testing.T) {
	guard := newStepUpGuard(t, platformpolicy.MinuteDay{PerMinute: 3, PerDay: 3})

	for typo := 1; typo <= 2; typo++ {
		if err := guard.ChargeStepUp(callFrom(t, testSource), PlatformScope, testAccount); err != nil {
			t.Fatalf("typo %d = %v, want it allowed", typo, err)
		}
	}
	if err := guard.ChargeStepUp(callFrom(t, testSource), PlatformScope, testAccount); err != nil {
		t.Fatalf("the right password on the last allowance = %v, want it allowed", err)
	}
	guard.ClearStepUp(callFrom(t, testSource), PlatformScope, testAccount)

	for typo := 1; typo <= 3; typo++ {
		if err := guard.ChargeStepUp(callFrom(t, testSource), PlatformScope, testAccount); err != nil {
			t.Fatalf("typo %d after the right password = %v, want the count cleared", typo, err)
		}
	}
}
