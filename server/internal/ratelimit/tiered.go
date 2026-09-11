package ratelimit

import (
	"context"
	"log/slog"
	"sync/atomic"
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
	// degradedNow records whether the last exchange with Redis failed, so the
	// outage is logged when it starts and when it ends rather than once per
	// request. Every refused request reaches this store, so a caller repeating
	// one during an outage would otherwise decide how much this process logs.
	degradedNow atomic.Bool
}

func (s *tieredStore) Incr(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	local, err := s.memory.Incr(ctx, key, ttl)
	if err != nil {
		return 0, err
	}
	shared, err := s.remote.Incr(ctx, key, ttl)
	if err != nil {
		s.degraded(ctx, "failed to charge the shared rate limit counter", err)
		return local, nil
	}
	s.recovered(ctx)
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
		s.degraded(ctx, "failed to record the shared rate limit claim", err)
		return true, nil
	}
	s.recovered(ctx)
	if !shared {
		// Another instance holds the claim, and it started theirs first. Keeping
		// the entry this call just created would outlive the shared one by the
		// difference between them and go on refusing a caller nothing else does.
		_ = s.memory.Forget(ctx, key)
	}
	return shared, nil
}

// Forget drops the key from both stores. A Redis that will not delete is the
// same outage the other two methods fall back around, and it is recorded the
// same way: the shared counter then stands until its own expiry, so a caller
// that had earned its removal keeps whatever it had spent rather than being
// refused outright.
func (s *tieredStore) Forget(ctx context.Context, key string) error {
	if err := s.memory.Forget(ctx, key); err != nil {
		return err
	}
	if err := s.remote.Forget(ctx, key); err != nil {
		s.degraded(ctx, "failed to drop the shared rate limit counter", err)
		return err
	}
	s.recovered(ctx)
	return nil
}

// degraded reports that Redis did not answer. The key is deliberately left out
// of the record: it names the reader, the episode and a digest of what they
// wrote, none of which says anything about the outage.
func (s *tieredStore) degraded(ctx context.Context, msg string, err error) {
	if s.logger == nil || s.degradedNow.Swap(true) {
		return
	}
	s.logger.WarnContext(ctx, msg, "error", err)
}

// recovered reports that Redis is answering again, and says nothing while it
// has been answering all along.
func (s *tieredStore) recovered(ctx context.Context) {
	if s.logger == nil || !s.degradedNow.Swap(false) {
		return
	}
	s.logger.InfoContext(ctx, "rate limiter: the shared counters are reachable again")
}
