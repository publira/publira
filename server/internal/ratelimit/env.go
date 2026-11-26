package ratelimit

import (
	"errors"
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
	url, err := redisurl.FromEnv()
	if err != nil {
		if logger != nil {
			logger.Error("rate limiter: redis refused, limiting per instance", "error", err)
		}
		return New(memory)
	}
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

// ErrNoSharedCounters is what [OpenShared] answers for a deployment that names
// no Redis.
var ErrNoSharedCounters = errors.New(redisurl.Env + " names no Redis, so every server process keeps its counters in its own memory, out of reach of any other process")

// OpenShared returns a limiter over the counters every instance of a server
// shares and nothing else, for a process that acts on the counters the servers
// charge rather than charging its own: a limiter over this process's memory
// would act on nothing they hold. It fails with [ErrNoSharedCounters] when
// there is no Redis and with the reason when it cannot be reached, and the
// function it answers closes the connection.
func OpenShared() (*Limiter, func() error, error) {
	url, err := redisurl.FromEnv()
	if err != nil {
		return nil, nil, err
	}
	if url == "" {
		return nil, nil, ErrNoSharedCounters
	}
	store, err := newRedisStore(url)
	if err != nil {
		return nil, nil, err
	}
	return New(store), store.client.Close, nil
}
