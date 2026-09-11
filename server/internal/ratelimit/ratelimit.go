// Package ratelimit bounds how often one subject may perform one action.
//
// It exists for the endpoints a stranger can reach without being vouched for:
// the ones a signed-in reader writes through, which are the first places on
// this platform where they can put text in front of everyone else, the forms
// that make a mail server send without having authenticated anyone, and the
// step-up checks that ask a caller already holding a session for the account's
// password again. Each of them needs an answer to "how often", and the answer
// has to be the same one whichever instance of a server happens to take the
// request.
//
// The mechanism knows nothing about comments or about mail: a caller names the
// subject it is charging and the rules to charge it against, so the next
// endpoint that needs a limit is a policy this package never has to learn.
package ratelimit

import (
	"context"
	"fmt"
	"time"
)

// Rule is one fixed window: at most Limit actions inside each Window. Several
// rules describe one action together — a burst rule per minute and a budget
// per day are the pair every reader-writable RPC starts with.
type Rule struct {
	Limit  int
	Window time.Duration
}

// Decision is Allow's answer. RetryAfter is what is left of the window that
// refused the action, so the reader can be told when to come back instead of
// being left to guess.
type Decision struct {
	Allowed    bool
	RetryAfter time.Duration
}

// Store keeps the counters. The counters are the entire state of a limiter, so
// the implementation in use is what decides whether a limit is shared by every
// instance of a server or held by each of them on its own.
type Store interface {
	// Incr adds one to the counter at key and returns the new count. A counter
	// that does not exist yet starts at one and expires after ttl.
	Incr(ctx context.Context, key string, ttl time.Duration) (int64, error)
	// Add stores key when it is absent, and reports whether this call is the one
	// that stored it. The entry expires after ttl.
	Add(ctx context.Context, key string, ttl time.Duration) (bool, error)
	// Forget removes key, so a claim whose action did not go through stops
	// standing for the rest of its window. It reports whether the removal
	// reached the counters: a store that could not drop the key leaves what it
	// held standing until the key's own expiry, and a caller told nothing could
	// not tell that apart from a removal that worked.
	Forget(ctx context.Context, key string) error
}

// Limiter charges actions against a Store.
type Limiter struct {
	store Store
	now   func() time.Time
}

// New returns a limiter that keeps its counters in store.
func New(store Store) *Limiter {
	return NewWithClock(store, time.Now)
}

// NewWithClock returns a limiter that reads the time from clock.
//
// A policy built on this package is tested by letting its windows pass, and a
// test that waited for a real one would either take a day or describe a policy
// nobody deploys. The clock is what lets such a test state the windows it
// actually charges against and then step over them.
func NewWithClock(store Store, clock func() time.Time) *Limiter {
	return &Limiter{store: store, now: clock}
}

// Allow charges one action by subject against every rule and reports the first
// rule that subject has exhausted.
//
// Charging stops at the rule that refuses: a reader held off by the per-minute
// burst rule does not also spend the day's budget, so hammering a refused
// endpoint cannot cost them the rest of the day.
func (l *Limiter) Allow(ctx context.Context, subject string, rules ...Rule) (Decision, error) {
	now := l.now()
	for _, rule := range rules {
		if rule.Limit < 1 || rule.Window <= 0 {
			return Decision{}, fmt.Errorf("ratelimit: rule for %q allows %d actions in %s, want at least one in a positive window", subject, rule.Limit, rule.Window)
		}
		key, remaining := bucket(subject, rule, now)
		count, err := l.store.Incr(ctx, key, remaining)
		if err != nil {
			return Decision{}, err
		}
		if count > int64(rule.Limit) {
			return Decision{RetryAfter: remaining}, nil
		}
	}
	return Decision{Allowed: true}, nil
}

// Claim records key for window and reports whether it was free. A caller told
// false is repeating something it already did inside that window.
func (l *Limiter) Claim(ctx context.Context, key string, window time.Duration) (bool, error) {
	if window <= 0 {
		return false, fmt.Errorf("ratelimit: claim window for %q is %s, want a positive one", key, window)
	}
	return l.store.Add(ctx, key, window)
}

// Release gives up a claim whose action did not go through, so a write that
// failed does not leave the caller refused for the rest of the window.
func (l *Limiter) Release(ctx context.Context, key string) {
	// Best effort, like Reset below: the store records a removal it could not
	// make, and there is nothing the caller of a give-back could do with the
	// error that the key expiring on its own does not already do.
	_ = l.store.Forget(ctx, key)
}

// Reset drops what subject has spent on every rule.
//
// It is for the limits that count attempts at something only the rightful
// caller can get right, where the count is there to bound the guessing rather
// than the asking: reaching the answer proves the caller was not guessing, and
// the attempts they made before it stop standing against them.
//
// A counter the store could not drop keeps what it held until the end of its
// own window, which is the same state the subject was in a moment earlier and
// no worse than it. So the store records such a failure and this reports none:
// refusing the action whose success is what earned the reset would turn a Redis
// that briefly would not delete into a password nobody can change.
func (l *Limiter) Reset(ctx context.Context, subject string, rules ...Rule) {
	now := l.now()
	for _, rule := range rules {
		if rule.Limit < 1 || rule.Window <= 0 {
			continue
		}
		key, _ := bucket(subject, rule, now)
		_ = l.store.Forget(ctx, key)
	}
}

// bucket names the counter for the window rule is in at now, and reports how
// long that window still has to run.
//
// The windows are fixed ones aligned to the epoch rather than ones starting at
// the subject's first action: the counter's name then follows from the clock
// alone, which is what lets several instances charge the same counter without
// having agreed on anything beforehand.
func bucket(subject string, rule Rule, now time.Time) (string, time.Duration) {
	window := rule.Window.Nanoseconds()
	index := now.UnixNano() / window
	return fmt.Sprintf("%s|%d|%d", subject, window, index), time.Duration((index+1)*window - now.UnixNano())
}
