package testutil

import (
	"time"

	"github.com/publira/publira/server/internal/ratelimit"
)

// limiterInstant is the moment a Limiter's clock stays at. It is not the start
// of an hour or a minute, so nothing about it depends on which side of a
// boundary the counters were charged.
var limiterInstant = time.Date(2026, 9, 10, 12, 30, 30, 0, time.UTC)

// Limiter is a limiter over in-process counters whose clock never moves. The
// windows are fixed and aligned to the epoch, so a limiter on the wall clock
// charges a case that runs across a boundary against two sets of counters, and
// the request the case expects to be refused finds a fresh allowance.
func Limiter() *ratelimit.Limiter {
	now := func() time.Time { return limiterInstant }
	return ratelimit.NewWithClock(ratelimit.NewMemoryStoreWithClock(now), now)
}
