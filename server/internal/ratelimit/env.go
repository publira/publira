package ratelimit

import (
	"log/slog"

	"github.com/publira/publira/server/internal/redisurl"
)

// NewFromEnv returns the limiter a server process uses.
//
// A deployment that has told this process where Redis is gets counters every
// instance shares; one that has not gets the in-process counters alone, which
// is what keeps a limit working out of the box in a local stack and in a test
// run. Redis being unreachable at startup is the same answer rather than a
// refusal to serve: the platform is better off answering readers with a looser
// limit than not answering them at all.
func NewFromEnv(logger *slog.Logger) *Limiter {
	memory := NewMemoryStore()
	url := redisurl.FromEnv()
	if url == "" {
		return New(memory)
	}
	remote, err := newRedisStore(url)
	if err != nil {
		if logger != nil {
			logger.Error("rate limiter: redis unavailable, limiting per instance", "error", err)
		}
		return New(memory)
	}
	return New(&tieredStore{memory: memory, remote: remote, logger: logger})
}
