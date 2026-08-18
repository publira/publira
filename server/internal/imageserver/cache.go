package imageserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultCacheTTL       = time.Hour
	defaultMemoryMaxBytes = 128 << 20
	cacheKeySep           = 0
)

// CacheEntry is a converted (or passed-through) image stored for reuse.
type CacheEntry struct {
	ContentType string
	Data        []byte
}

// ImageCache stores converted image bytes keyed by object and transform inputs.
type ImageCache interface {
	Get(ctx context.Context, key string) (CacheEntry, bool)
	Set(ctx context.Context, key string, entry CacheEntry)
}

type memoryEntry struct {
	entry CacheEntry
	exp   time.Time
	size  int64
}

type memoryCache struct {
	mu       sync.Mutex
	items    map[string]memoryEntry
	bytes    int64
	maxBytes int64
	ttl      time.Duration
}

func newMemoryCache(ttl time.Duration, maxBytes int64) *memoryCache {
	if ttl <= 0 {
		ttl = defaultCacheTTL
	}
	if maxBytes <= 0 {
		maxBytes = defaultMemoryMaxBytes
	}
	return &memoryCache{
		items:    make(map[string]memoryEntry),
		maxBytes: maxBytes,
		ttl:      ttl,
	}
}

func (c *memoryCache) Get(_ context.Context, key string) (CacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	item, ok := c.items[key]
	if !ok {
		return CacheEntry{}, false
	}
	if !item.exp.IsZero() && time.Now().After(item.exp) {
		c.removeLocked(key)
		return CacheEntry{}, false
	}
	return item.entry, true
}

func (c *memoryCache) Set(_ context.Context, key string, entry CacheEntry) {
	size := int64(len(entry.Data) + len(entry.ContentType))
	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.items[key]; ok {
		c.bytes -= existing.size
		delete(c.items, key)
	}
	c.evictExpiredLocked()
	for c.bytes+size > c.maxBytes && len(c.items) > 0 {
		c.evictOneLocked()
	}
	if size > c.maxBytes {
		return
	}
	c.items[key] = memoryEntry{
		entry: entry,
		exp:   time.Now().Add(c.ttl),
		size:  size,
	}
	c.bytes += size
}

func (c *memoryCache) evictExpiredLocked() {
	now := time.Now()
	for key, item := range c.items {
		if !item.exp.IsZero() && now.After(item.exp) {
			c.removeLocked(key)
		}
	}
}

func (c *memoryCache) evictOneLocked() {
	var oldestKey string
	var oldest time.Time
	first := true
	for key, item := range c.items {
		if first || item.exp.Before(oldest) {
			oldestKey = key
			oldest = item.exp
			first = false
		}
	}
	if oldestKey != "" {
		c.removeLocked(oldestKey)
	}
}

func (c *memoryCache) removeLocked(key string) {
	item, ok := c.items[key]
	if !ok {
		return
	}
	c.bytes -= item.size
	delete(c.items, key)
}

func cacheKey(objectKey string, r *http.Request) string {
	q := r.URL.Query()
	var b strings.Builder
	b.Grow(len(objectKey) + 64)
	b.WriteString(objectKey)
	b.WriteByte(cacheKeySep)
	b.WriteString(r.Header.Get("Accept"))
	b.WriteByte(cacheKeySep)
	b.WriteString(q.Get("w"))
	b.WriteByte(cacheKeySep)
	b.WriteString(q.Get("h"))
	b.WriteByte(cacheKeySep)
	b.WriteString(q.Get("fit"))
	b.WriteByte(cacheKeySep)
	b.WriteString(q.Get("q"))
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

func parseCacheTTL() time.Duration {
	raw := strings.TrimSpace(os.Getenv("PUBLIRA_IMAGE_CACHE_TTL"))
	if raw == "" {
		return defaultCacheTTL
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return d
	}
	if n, err := strconv.Atoi(raw); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	return defaultCacheTTL
}

func redisURLEnabled(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "disabled", "off", "false":
		return false
	default:
		return true
	}
}

func newImageCacheFromEnv(logger *slog.Logger) ImageCache {
	ttl := parseCacheTTL()
	mem := newMemoryCache(ttl, defaultMemoryMaxBytes)
	url := strings.TrimSpace(os.Getenv("PUBLIRA_REDIS_URL"))
	if !redisURLEnabled(url) {
		return mem
	}
	redisCache, err := newRedisCache(url, ttl)
	if err != nil {
		if logger != nil {
			logger.Error("image cache: redis unavailable, using memory only", "error", err)
		}
		return mem
	}
	return &tieredCache{memory: mem, remote: redisCache}
}

type tieredCache struct {
	memory *memoryCache
	remote ImageCache
}

func (c *tieredCache) Get(ctx context.Context, key string) (CacheEntry, bool) {
	if entry, ok := c.memory.Get(ctx, key); ok {
		return entry, true
	}
	entry, ok := c.remote.Get(ctx, key)
	if !ok {
		return CacheEntry{}, false
	}
	c.memory.Set(ctx, key, entry)
	return entry, true
}

func (c *tieredCache) Set(ctx context.Context, key string, entry CacheEntry) {
	c.memory.Set(ctx, key, entry)
	c.remote.Set(ctx, key, entry)
}
