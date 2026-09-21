// Package ttlcache keeps a value read from the database for a fixed time, so a
// setting saved in one process reaches every other one within that time
// without a restart.
package ttlcache

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Value reads a value and keeps it for a TTL. A failed reread serves the last
// value and waits another TTL, so an outage costs one query per TTL.
type Value[T any] struct {
	load   func(ctx context.Context) (T, error)
	ttl    time.Duration
	logger *slog.Logger
	what   string

	// Now is the clock the TTL is measured on, replaceable by tests.
	Now func() time.Time

	mu         sync.Mutex
	value      T
	hasValue   bool
	nextReadAt time.Time
}

// New returns a Value that reads with load. what names the value in the
// warning an outage logs.
func New[T any](load func(ctx context.Context) (T, error), ttl time.Duration, logger *slog.Logger, what string) *Value[T] {
	if logger == nil {
		logger = slog.Default()
	}
	return &Value[T]{load: load, ttl: ttl, logger: logger, what: what, Now: time.Now}
}

// Get answers the kept value, reading it again once the TTL has passed. load
// runs under the Value's lock, so it may keep state of its own between reads.
func (c *Value[T]) Get(ctx context.Context) (T, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.hasValue && c.Now().Before(c.nextReadAt) {
		return c.value, nil
	}
	value, err := c.load(ctx)
	// Measured from when the read ended, so a read slower than the TTL still
	// leaves a TTL before the next one.
	now := c.Now()
	if err != nil {
		if c.hasValue {
			c.nextReadAt = now.Add(c.ttl)
			c.logger.WarnContext(ctx, "serving the last "+c.what+" read", "error", err)
			return c.value, nil
		}
		var zero T
		return zero, err
	}
	c.value, c.hasValue, c.nextReadAt = value, true, now.Add(c.ttl)
	return value, nil
}
