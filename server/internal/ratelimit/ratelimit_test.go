package ratelimit

import (
	"context"
	"errors"
	"testing"
	"time"
)

// The windows are aligned to the epoch, so a test that wants to sit inside one
// starts from an instant that is not itself a boundary.
var testStart = time.Date(2026, 9, 8, 12, 0, 30, 0, time.UTC)

type fakeClock struct {
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	return c.now
}

func (c *fakeClock) advance(d time.Duration) {
	c.now = c.now.Add(d)
}

// newTestLimiter drives both the limiter and its counters from one clock, so a
// window passes exactly when the test says it does.
func newTestLimiter(t *testing.T) (*Limiter, *fakeClock) {
	t.Helper()

	clock := &fakeClock{now: testStart}
	store := NewMemoryStore()
	store.now = clock.Now
	limiter := New(store)
	limiter.now = clock.Now
	return limiter, clock
}

func mustAllow(t *testing.T, limiter *Limiter, subject string, rules ...Rule) Decision {
	t.Helper()

	decision, err := limiter.Allow(context.Background(), subject, rules...)
	if err != nil {
		t.Fatalf("Allow(%q): %v", subject, err)
	}
	return decision
}

func TestLimiterRefusesPastTheLimit(t *testing.T) {
	limiter, _ := newTestLimiter(t)
	rule := Rule{Limit: 3, Window: time.Minute}

	for attempt := 1; attempt <= rule.Limit; attempt++ {
		if decision := mustAllow(t, limiter, "reader", rule); !decision.Allowed {
			t.Fatalf("attempt %d = refused, want the first %d allowed", attempt, rule.Limit)
		}
	}

	decision := mustAllow(t, limiter, "reader", rule)
	if decision.Allowed {
		t.Fatal("attempt 4 = allowed, want a limit of 3 to refuse it")
	}
	// The window this subject is in started 30 seconds ago, so half of it is
	// what the caller may tell the reader to wait.
	if decision.RetryAfter != 30*time.Second {
		t.Fatalf("retry after = %s, want the 30s left of the window", decision.RetryAfter)
	}
}

func TestLimiterStartsAFreshWindowWhenTheOldOnePasses(t *testing.T) {
	limiter, clock := newTestLimiter(t)
	rule := Rule{Limit: 1, Window: time.Minute}

	if decision := mustAllow(t, limiter, "reader", rule); !decision.Allowed {
		t.Fatal("the first action = refused, want it allowed")
	}
	if decision := mustAllow(t, limiter, "reader", rule); decision.Allowed {
		t.Fatal("the second action in the window = allowed, want it refused")
	}

	// The window this subject started in runs to 12:01:00, so it is still the
	// same window one instant before that.
	clock.advance(30*time.Second - time.Nanosecond)
	if decision := mustAllow(t, limiter, "reader", rule); decision.Allowed {
		t.Fatal("an action at the last instant of the window = allowed, want it refused")
	}

	clock.advance(time.Nanosecond)
	if decision := mustAllow(t, limiter, "reader", rule); !decision.Allowed {
		t.Fatal("the first action of the next window = refused, want a fresh budget")
	}
}

func TestLimiterKeepsSubjectsApart(t *testing.T) {
	limiter, _ := newTestLimiter(t)
	rule := Rule{Limit: 1, Window: time.Minute}

	// One reader of one tenant spends their whole budget.
	if decision := mustAllow(t, limiter, "comment.post:tenant-a:reader-1", rule); !decision.Allowed {
		t.Fatal("the first reader's action = refused, want it allowed")
	}
	if decision := mustAllow(t, limiter, "comment.post:tenant-a:reader-1", rule); decision.Allowed {
		t.Fatal("the first reader's second action = allowed, want it refused")
	}

	// Another reader of the same tenant, and the same reader identifier under
	// another tenant, each still hold a full budget.
	for _, subject := range []string{
		"comment.post:tenant-a:reader-2",
		"comment.post:tenant-b:reader-1",
		"comment.report:tenant-a:reader-1",
	} {
		if decision := mustAllow(t, limiter, subject, rule); !decision.Allowed {
			t.Fatalf("%s = refused, want a budget of its own", subject)
		}
	}
}

func TestLimiterStopsChargingAtTheRuleThatRefuses(t *testing.T) {
	limiter, clock := newTestLimiter(t)
	perMinute := Rule{Limit: 2, Window: time.Minute}
	perDay := Rule{Limit: 3, Window: 24 * time.Hour}

	for attempt := 1; attempt <= 2; attempt++ {
		if decision := mustAllow(t, limiter, "reader", perMinute, perDay); !decision.Allowed {
			t.Fatalf("attempt %d = refused, want the minute's budget spent first", attempt)
		}
	}
	// Refused by the minute rule, which is the whole point: the day's budget
	// must not have been charged for it.
	if decision := mustAllow(t, limiter, "reader", perMinute, perDay); decision.Allowed {
		t.Fatal("the third action of the minute = allowed, want it refused")
	}

	clock.advance(time.Minute)
	if decision := mustAllow(t, limiter, "reader", perMinute, perDay); !decision.Allowed {
		t.Fatal("the first action of the next minute = refused, want the day's third action allowed")
	}
	decision := mustAllow(t, limiter, "reader", perMinute, perDay)
	if decision.Allowed {
		t.Fatal("the day's fourth action = allowed, want the daily rule to refuse it")
	}
	// The refusal is the daily rule's, so the wait is the rest of the day.
	if want := 11*time.Hour + 58*time.Minute + 30*time.Second; decision.RetryAfter != want {
		t.Fatalf("retry after = %s, want the %s left of the day", decision.RetryAfter, want)
	}
}

func TestLimiterRejectsAnUnusableRule(t *testing.T) {
	limiter, _ := newTestLimiter(t)

	for _, rule := range []Rule{
		{Limit: 0, Window: time.Minute},
		{Limit: -1, Window: time.Minute},
		{Limit: 1, Window: 0},
		{Limit: 1, Window: -time.Minute},
	} {
		if _, err := limiter.Allow(context.Background(), "reader", rule); err == nil {
			t.Fatalf("Allow with %+v error = nil, want an error rather than a limit nobody can meet", rule)
		}
	}
}

func TestClaimRefusesARepeatInsideTheWindow(t *testing.T) {
	limiter, clock := newTestLimiter(t)
	ctx := context.Background()

	fresh, err := limiter.Claim(ctx, "same-body", 10*time.Minute)
	if err != nil || !fresh {
		t.Fatalf("first Claim = (%v, %v), want (true, nil)", fresh, err)
	}
	repeat, err := limiter.Claim(ctx, "same-body", 10*time.Minute)
	if err != nil || repeat {
		t.Fatalf("second Claim = (%v, %v), want (false, nil)", repeat, err)
	}
	if other, err := limiter.Claim(ctx, "other-body", 10*time.Minute); err != nil || !other {
		t.Fatalf("Claim of another body = (%v, %v), want (true, nil)", other, err)
	}

	clock.advance(10 * time.Minute)
	if again, err := limiter.Claim(ctx, "same-body", 10*time.Minute); err != nil || !again {
		t.Fatalf("Claim after the window = (%v, %v), want (true, nil)", again, err)
	}
}

func TestReleaseGivesBackAClaim(t *testing.T) {
	limiter, _ := newTestLimiter(t)
	ctx := context.Background()

	if _, err := limiter.Claim(ctx, "same-body", 10*time.Minute); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	limiter.Release(ctx, "same-body")
	// The write the claim stood for never happened, so repeating it is not a
	// repeat at all.
	if fresh, err := limiter.Claim(ctx, "same-body", 10*time.Minute); err != nil || !fresh {
		t.Fatalf("Claim after Release = (%v, %v), want (true, nil)", fresh, err)
	}
}

func TestResetGivesBackEveryRulesCount(t *testing.T) {
	limiter, _ := newTestLimiter(t)
	burst := Rule{Limit: 2, Window: time.Minute}
	budget := Rule{Limit: 3, Window: time.Hour}

	for attempt := 1; attempt <= burst.Limit; attempt++ {
		if decision := mustAllow(t, limiter, "reader", burst, budget); !decision.Allowed {
			t.Fatalf("attempt %d = refused, want the first %d allowed", attempt, burst.Limit)
		}
	}
	if decision := mustAllow(t, limiter, "reader", burst, budget); decision.Allowed {
		t.Fatal("the attempt past the burst rule = allowed, want refused")
	}

	limiter.Reset(context.Background(), "reader", burst, budget)

	// The rule that did the refusing is back. Charged on its own, so that the
	// assertion below still starts from the hourly counter the reset left.
	if decision := mustAllow(t, limiter, "reader", burst); !decision.Allowed {
		t.Fatal("the burst rule after the reset = refused, want its counter back")
	}

	// And so is the hourly one, which the burst rule stopped the last attempt
	// from ever reaching: two of its three were spent before the reset, so a
	// reset that missed it would refuse the third attempt here.
	for attempt := 1; attempt <= budget.Limit; attempt++ {
		if decision := mustAllow(t, limiter, "reader", budget); !decision.Allowed {
			t.Fatalf("attempt %d after the reset = refused, want the whole budget back", attempt)
		}
	}
}

func TestResetLeavesOtherSubjectsAlone(t *testing.T) {
	limiter, _ := newTestLimiter(t)
	rule := Rule{Limit: 1, Window: time.Minute}

	mustAllow(t, limiter, "reader", rule)
	mustAllow(t, limiter, "another reader", rule)

	limiter.Reset(context.Background(), "reader", rule)

	if decision := mustAllow(t, limiter, "reader", rule); !decision.Allowed {
		t.Fatal("the reset subject = refused, want their allowance back")
	}
	if decision := mustAllow(t, limiter, "another reader", rule); decision.Allowed {
		t.Fatal("another subject = allowed, want the reset to have left their count where it was")
	}
}

func TestClaimRejectsAnUnusableWindow(t *testing.T) {
	limiter, _ := newTestLimiter(t)

	if _, err := limiter.Claim(context.Background(), "same-body", 0); err == nil {
		t.Fatal("Claim with a window of zero error = nil, want an error")
	}
}

func TestMemoryStoreDropsCountersWhoseWindowPassed(t *testing.T) {
	clock := &fakeClock{now: testStart}
	store := NewMemoryStore()
	store.now = clock.Now
	ctx := context.Background()

	if _, err := store.Incr(ctx, "reader", time.Minute); err != nil {
		t.Fatalf("Incr: %v", err)
	}
	clock.advance(2 * time.Minute)
	if _, err := store.Incr(ctx, "another-reader", time.Minute); err != nil {
		t.Fatalf("Incr: %v", err)
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	if _, ok := store.entries["reader"]; ok {
		t.Fatal("the expired counter is still held, want the sweep to have dropped it")
	}
	if len(store.entries) != 1 {
		t.Fatalf("held counters = %d, want only the live one", len(store.entries))
	}
}

// failingStore stands in for a Redis that has stopped answering.
type failingStore struct {
	err error
}

func (s *failingStore) Incr(context.Context, string, time.Duration) (int64, error) {
	return 0, s.err
}

func (s *failingStore) Add(context.Context, string, time.Duration) (bool, error) {
	return false, s.err
}

func (s *failingStore) Forget(context.Context, string) error { return nil }

func TestTieredStoreKeepsLimitingWhenTheSharedCounterIsGone(t *testing.T) {
	clock := &fakeClock{now: testStart}
	memory := NewMemoryStore()
	memory.now = clock.Now
	limiter := New(&tieredStore{memory: memory, remote: &failingStore{err: errors.New("redis is down")}})
	limiter.now = clock.Now
	rule := Rule{Limit: 1, Window: time.Minute}

	if decision := mustAllow(t, limiter, "reader", rule); !decision.Allowed {
		t.Fatal("the first action = refused, want it allowed")
	}
	// Failing open here would turn the outage into the flood the limit exists
	// to stop, so the in-process counter has to answer on its own.
	if decision := mustAllow(t, limiter, "reader", rule); decision.Allowed {
		t.Fatal("the second action = allowed, want the in-process counter to refuse it")
	}
	fresh, err := limiter.Claim(context.Background(), "same-body", time.Minute)
	if err != nil || !fresh {
		t.Fatalf("Claim = (%v, %v), want (true, nil)", fresh, err)
	}
	if repeat, err := limiter.Claim(context.Background(), "same-body", time.Minute); err != nil || repeat {
		t.Fatalf("repeated Claim = (%v, %v), want (false, nil)", repeat, err)
	}
}

// takenStore stands in for a Redis whose claim another instance made first.
type takenStore struct {
	freeAfter time.Time
	now       func() time.Time
}

func (s *takenStore) Incr(context.Context, string, time.Duration) (int64, error) {
	return 1, nil
}

func (s *takenStore) Add(context.Context, string, time.Duration) (bool, error) {
	return !s.now().Before(s.freeAfter), nil
}

func (s *takenStore) Forget(context.Context, string) error { return nil }

func TestTieredStoreDoesNotOutlastTheSharedClaim(t *testing.T) {
	clock := &fakeClock{now: testStart}
	memory := NewMemoryStore()
	memory.now = clock.Now
	// The shared claim was made a minute before this instance saw the body, so
	// it runs out a minute before this instance's own window would.
	limiter := New(&tieredStore{
		memory: memory,
		remote: &takenStore{freeAfter: testStart.Add(9 * time.Minute), now: clock.Now},
	})
	limiter.now = clock.Now
	ctx := context.Background()

	if taken, err := limiter.Claim(ctx, "same-body", 10*time.Minute); err != nil || taken {
		t.Fatalf("Claim against a held shared claim = (%v, %v), want (false, nil)", taken, err)
	}

	clock.advance(9 * time.Minute)
	// The shared claim has run out. Nothing else is refusing this body, so an
	// entry this instance kept from the refused call would be refusing it alone.
	if fresh, err := limiter.Claim(ctx, "same-body", 10*time.Minute); err != nil || !fresh {
		t.Fatalf("Claim after the shared claim expired = (%v, %v), want (true, nil)", fresh, err)
	}
}

// sharedStore stands in for a Redis that other instances have already charged.
type sharedStore struct {
	count int64
}

func (s *sharedStore) Incr(context.Context, string, time.Duration) (int64, error) {
	s.count++
	return s.count, nil
}

func (s *sharedStore) Add(context.Context, string, time.Duration) (bool, error) {
	return true, nil
}

func (s *sharedStore) Forget(context.Context, string) error { return nil }

func TestTieredStoreChargesWhatEveryInstanceSpentTogether(t *testing.T) {
	clock := &fakeClock{now: testStart}
	memory := NewMemoryStore()
	memory.now = clock.Now
	// Three actions this instance never saw have already been charged elsewhere.
	limiter := New(&tieredStore{memory: memory, remote: &sharedStore{count: 3}})
	limiter.now = clock.Now

	if decision := mustAllow(t, limiter, "reader", Rule{Limit: 3, Window: time.Minute}); decision.Allowed {
		t.Fatal("an action past the shared count = allowed, want the shared counter to decide")
	}
}
