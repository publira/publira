package imageserver

import (
	"bytes"
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const redisKeyPrefix = "publira:img:"

type redisCache struct {
	client *redis.Client
	ttl    time.Duration
}

func newRedisCache(url string, ttl time.Duration) (*redisCache, error) {
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
	if ttl <= 0 {
		ttl = defaultCacheTTL
	}
	return &redisCache{client: client, ttl: ttl}, nil
}

func (c *redisCache) Get(ctx context.Context, key string) (CacheEntry, bool) {
	raw, err := c.client.Get(ctx, redisKeyPrefix+key).Bytes()
	if err != nil {
		return CacheEntry{}, false
	}
	contentType, data, ok := splitCachePayload(raw)
	if !ok {
		return CacheEntry{}, false
	}
	return CacheEntry{ContentType: contentType, Data: data}, true
}

func (c *redisCache) Set(ctx context.Context, key string, entry CacheEntry) {
	_ = c.client.Set(ctx, redisKeyPrefix+key, joinCachePayload(entry), c.ttl).Err()
}

func joinCachePayload(entry CacheEntry) []byte {
	out := make([]byte, 0, len(entry.ContentType)+1+len(entry.Data))
	out = append(out, entry.ContentType...)
	out = append(out, 0)
	out = append(out, entry.Data...)
	return out
}

func splitCachePayload(raw []byte) (contentType string, data []byte, ok bool) {
	n := bytes.IndexByte(raw, 0)
	if n < 0 {
		return "", nil, false
	}
	return string(raw[:n]), raw[n+1:], true
}
