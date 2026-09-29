package testutil

import (
	"math"
	"slices"
	"testing"
	"time"
)

const (
	// TimingWarmup is how many pairs run before the measurement. Warm-up calls
	// pass a negative sample number, from -1 down to -TimingWarmup.
	TimingWarmup  = 5
	timingSamples = 60
)

// timingFloor is the smallest gap a measurement is held to, which absorbs
// scheduler jitter on a loopback round trip.
const timingFloor = 500 * time.Microsecond

// timingTolerance is how far the median gap may stray from zero: three standard
// errors of that median, estimated from the spread of the gaps, and never less
// than the floor. The bcrypt hash a sign-up spends varies by milliseconds, so a
// fixed bound would either fail that form at random or pass anything the lighter
// forms do.
func timingTolerance(gaps []time.Duration) time.Duration {
	sorted := slices.Clone(gaps)
	slices.Sort(sorted)
	spread := sorted[len(sorted)*3/4] - sorted[len(sorted)/4]
	deviation := float64(spread) / 1.349
	standardError := 1.2533 * deviation / math.Sqrt(float64(len(gaps)))
	return max(timingFloor, time.Duration(3*standardError))
}

// AssertIndistinguishableTimings times a form over the loopback interface,
// where no network noise hides a difference, for a registered address and for
// an unknown one, and fails when the two take measurably different times. The
// two are alternated so a change in the machine's load falls on both alike.
func AssertIndistinguishableTimings(t *testing.T, registered, free func(sample int) error) {
	t.Helper()

	measure := func(call func(int) error, sample int) time.Duration {
		t.Helper()
		started := time.Now()
		if err := call(sample); err != nil {
			t.Fatalf("sample %d: %v", sample, err)
		}
		return time.Since(started)
	}
	for sample := range TimingWarmup {
		measure(registered, -1-sample)
		measure(free, -1-sample)
	}

	// Each pair is timed back to back, so what the gap between its halves
	// measures is the work behind the two answers rather than the machine's
	// load at the time.
	gaps := make([]time.Duration, 0, timingSamples)
	for sample := range timingSamples {
		var registeredTime, freeTime time.Duration
		if sample%2 == 0 {
			registeredTime = measure(registered, sample)
			freeTime = measure(free, sample)
		} else {
			freeTime = measure(free, sample)
			registeredTime = measure(registered, sample)
		}
		gaps = append(gaps, registeredTime-freeTime)
	}

	gap, tolerance := medianDuration(gaps), timingTolerance(gaps)
	t.Logf("median gap %v between the registered address and the free one (tolerance %v)", gap, tolerance)
	if gap > tolerance || gap < -tolerance {
		t.Fatalf("the registered address takes %v longer than the free one, past the %v tolerance", gap, tolerance)
	}
}

func medianDuration(samples []time.Duration) time.Duration {
	sorted := slices.Clone(samples)
	slices.Sort(sorted)
	return sorted[len(sorted)/2]
}
