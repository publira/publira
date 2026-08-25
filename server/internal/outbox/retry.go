package outbox

import "time"

const (
	// DefaultMaxAttempts is the Epic #287 retry budget. The next failure
	// after this many attempts marks the row dead.
	DefaultMaxAttempts = 10

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
