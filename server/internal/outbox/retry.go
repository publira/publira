package outbox

import "time"

const (
	// DefaultMaxAttempts is the outbox retry budget. The next failure
	// after this many attempts marks the row dead. Under [RetryDelay] its
	// fifteen waits add up to about four hours: twelve that double from a
	// second to 34 minutes, then three of an hour. That outlasts an outage of
	// an SMTP server or a store's API that someone has to notice and fix,
	// where a budget of minutes would mark every event dead before anyone
	// had.
	DefaultMaxAttempts = 16

	defaultRetryBase = time.Second
	defaultRetryCap  = time.Hour
)

// RetryDelay is the default wait before a failed event becomes claimable
// again. attempts is the count after the failure is recorded (1 on the
// first retry). The sequence is 1s, 2s, 4s, … capped at 1 hour.
func RetryDelay(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	shift := attempts - 1
	if shift >= 63 {
		return defaultRetryCap
	}
	delay := defaultRetryBase << shift
	if delay > defaultRetryCap || delay <= 0 {
		return defaultRetryCap
	}
	return delay
}

// AttemptsWithin answers the largest retry budget whose last attempt still
// starts within window of the first, under [RetryDelay]. It is the budget of
// an event owed by a deadline, registered with [Registry.RegisterWithAttempts]:
// it keeps trying until the deadline has passed, and makes no attempt after.
func AttemptsWithin(window time.Duration) int {
	attempts := 1
	var elapsed time.Duration
	for {
		elapsed += RetryDelay(attempts)
		if elapsed > window {
			return attempts
		}
		attempts++
	}
}
