package ratelimit

import (
	"context"
	"log/slog"
	"time"
)

// tieredStore charges Redis and this process at once.
//
// Redis is what makes a limit mean what it says: the API servers run several
// instances behind the edge, and a counter each of them kept privately would
// multiply every limit by the number of instances. Keeping the in-process
// counters alongside it rather than instead of it is what a Redis outage falls
// back to, so losing Redis narrows a limit to one instance instead of removing
// it — a rate limiter that fails open is one an outage turns into the flood it
// was there to stop.
//
// The shared count is the higher of the two whenever Redis answers, since this
// instance can only ever have charged part of what every instance together has.
type tieredStore struct {
	memory *MemoryStore
	remote Store
	logger *slog.Logger
}

func (s *tieredStore) Incr(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	local, err := s.memory.Incr(ctx, key, ttl)
	if err != nil {
		return 0, err
	}
	shared, err := s.remote.Incr(ctx, key, ttl)
	if err != nil {
		s.degraded(ctx, "failed to charge the shared rate limit counter", err, key)
		return local, nil
	}
	return max(local, shared), nil
}

// Add holds a claim only when both stores were free. A claim this instance has
// already recorded stands even if Redis has since lost it, which is what makes
// a restarted Redis loosen the window rather than reopen it. A key this
// instance is already refusing is not offered to Redis at all: writing it there
// again would restart the window every time the caller repeats itself.
func (s *tieredStore) Add(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	local, err := s.memory.Add(ctx, key, ttl)
	if err != nil {
		return false, err
	}
	if !local {
		return false, nil
	}
	shared, err := s.remote.Add(ctx, key, ttl)
	if err != nil {
		s.degraded(ctx, "failed to record the shared rate limit claim", err, key)
		return true, nil
	}
	return shared, nil
}

func (s *tieredStore) Forget(ctx context.Context, key string) {
	s.memory.Forget(ctx, key)
	s.remote.Forget(ctx, key)
}

func (s *tieredStore) degraded(ctx context.Context, msg string, err error, key string) {
	if s.logger == nil {
		return
	}
	s.logger.WarnContext(ctx, msg, "error", err, "key", key)
}
