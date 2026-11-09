package tenanterasure

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/imagecachekey"
	"github.com/publira/publira/server/internal/ratelimit"
)

// scanCount is the COUNT hint of one SCAN, and so about how many keys one
// round trip looks at and one UNLINK removes.
const scanCount = 1000

// RedisCache erases a tenant's entries from the Redis the API processes share:
// the renditions the image routes converted from its images, and the counters
// the rate limits charged on its behalf. What a process keeps in its own
// memory instead is out of reach here, and goes on its own: a rendition when
// its cache lifetime ends, a counter when its window does, and both unreachable
// before then, since the tenant's hosts answer as suspended and then as no
// tenant's.
type RedisCache struct {
	Client *redis.Client
}

// NewRedisCache is the RedisCache of the Redis at url, which redisurl.FromEnv
// answered. It connects on first use rather than here, so a Redis that is
// down when the worker starts fails the passes that need it, which are tried
// again, instead of leaving every later deletion without its cache.
func NewRedisCache(url string) (*RedisCache, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return &RedisCache{Client: redis.NewClient(opts)}, nil
}

// Close closes the connection.
func (c *RedisCache) Close() error {
	return c.Client.Close()
}

// EraseTenant deletes every entry kept for tenant.
func (c *RedisCache) EraseTenant(ctx context.Context, tenant dbmodels.Tenant) (int, error) {
	var erased int
	for _, match := range []string{
		imagecachekey.TenantMatch(tenant.PublicID),
		ratelimit.TenantKeyMatch(tenant.ID.String()),
	} {
		n, err := c.erase(ctx, match)
		erased += n
		if err != nil {
			return erased, err
		}
	}
	return erased, nil
}

// erase removes every key matching match. SCAN visits each key present for the
// whole walk at least once, and a key written after the walk began is the
// next pass's: a suspended tenant's hosts write no new ones.
func (c *RedisCache) erase(ctx context.Context, match string) (int, error) {
	var (
		cursor uint64
		erased int
	)
	for {
		keys, next, err := c.Client.Scan(ctx, cursor, match, scanCount).Result()
		if err != nil {
			return erased, fmt.Errorf("scan %s: %w", match, err)
		}
		if len(keys) > 0 {
			if err := c.Client.Unlink(ctx, keys...).Err(); err != nil {
				return erased, fmt.Errorf("unlink %s: %w", match, err)
			}
			erased += len(keys)
		}
		if next == 0 {
			return erased, nil
		}
		cursor = next
	}
}
