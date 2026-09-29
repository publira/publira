package ttlcache

import (
	"context"
	"errors"
	"testing"
	"time"
)

// clock is a time that a load can move forward, standing in for a read that
// takes a while.
type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

func TestGetKeepsTheValueForTheTTL(t *testing.T) {
	t.Parallel()

	c := &clock{now: time.Unix(0, 0)}
	loads := 0
	value := New(func(context.Context) (int, error) {
		loads++
		return loads, nil
	}, time.Minute, nil, "test value")
	value.Now = c.Now

	for _, advance := range []time.Duration{0, 59 * time.Second} {
		c.now = c.now.Add(advance)
		if got, err := value.Get(context.Background()); err != nil || got != 1 {
			t.Fatalf("Get = (%d, %v), want the first read", got, err)
		}
	}
	c.now = c.now.Add(time.Second)
	if got, err := value.Get(context.Background()); err != nil || got != 2 {
		t.Fatalf("Get past the TTL = (%d, %v), want a second read", got, err)
	}
}

// A read slower than the TTL still leaves a whole TTL before the next one, so
// a database that answers slowly is not asked again on every call.
func TestGetMeasuresTheTTLFromTheEndOfTheRead(t *testing.T) {
	t.Parallel()

	for name, fail := range map[string]bool{"a read that succeeds": false, "a read that fails": true} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			c := &clock{now: time.Unix(0, 0)}
			loads := 0
			value := New(func(context.Context) (int, error) {
				loads++
				if loads > 1 {
					c.now = c.now.Add(2 * time.Minute)
					if fail {
						return 0, errors.New("database is slow and then down")
					}
				}
				return loads, nil
			}, time.Minute, nil, "test value")
			value.Now = c.Now

			if _, err := value.Get(context.Background()); err != nil {
				t.Fatalf("Get: %v", err)
			}
			c.now = c.now.Add(time.Minute)
			if _, err := value.Get(context.Background()); err != nil {
				t.Fatalf("slow Get: %v", err)
			}
			if _, err := value.Get(context.Background()); err != nil {
				t.Fatalf("Get after the slow read: %v", err)
			}
			if loads != 2 {
				t.Fatalf("loads = %d, want the call after the slow read served from the cache", loads)
			}
		})
	}
}
