package ratelimit

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// redisKeyPrefix keeps the counters apart from everything else sharing the
// deployment's Redis, so flushing them is a pattern an operator can name.
const redisKeyPrefix = "publira:rl:"

// minRedisTTL is the shortest expiry a counter is written with. Redis measures
// an expiry in milliseconds and drops a key whose expiry rounds to zero, which
// a counter created in the last moments of its window otherwise would: the key
// names its own window, so holding it a little past the end costs nothing.
const minRedisTTL = time.Second

type redisStore struct {
	client *redis.Client
}

func newRedisStore(url string) (*redisStore, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}
	return &redisStore{client: client}, nil
}

// Incr adds to the counter and sets its expiry in one round trip. The expiry is
// set only when the key has none, so a later action inside the same window
// cannot push the window's end further out.
func (s *redisStore) Incr(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	name := redisKeyPrefix + key
	pipe := s.client.Pipeline()
	incr := pipe.Incr(ctx, name)
	pipe.ExpireNX(ctx, name, max(ttl, minRedisTTL))
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return incr.Val(), nil
}

func (s *redisStore) Add(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	return s.client.SetNX(ctx, redisKeyPrefix+key, "", max(ttl, minRedisTTL)).Result()
}

func (s *redisStore) Forget(ctx context.Context, key string) {
	_ = s.client.Del(ctx, redisKeyPrefix+key).Err()
}
