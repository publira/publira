package imageserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMemoryCacheRoundTrip(t *testing.T) {
	t.Parallel()

	c := newMemoryCache(time.Hour, defaultMemoryMaxBytes)
	ctx := context.Background()
	want := CacheEntry{ContentType: "image/webp", Data: []byte("webp-bytes")}

	if _, ok := c.Get(ctx, "missing"); ok {
		t.Fatal("Get(missing) = true, want false")
	}
	c.Set(ctx, "k", want)
	got, ok := c.Get(ctx, "k")
	if !ok {
		t.Fatal("Get after Set = false, want true")
	}
	if got.ContentType != want.ContentType || string(got.Data) != string(want.Data) {
		t.Fatalf("Get = %+v, want %+v", got, want)
	}
}

func TestMemoryCacheExpires(t *testing.T) {
	t.Parallel()

	c := newMemoryCache(10*time.Millisecond, defaultMemoryMaxBytes)
	ctx := context.Background()
	c.Set(ctx, "k", CacheEntry{ContentType: "image/webp", Data: []byte("x")})
	time.Sleep(20 * time.Millisecond)
	if _, ok := c.Get(ctx, "k"); ok {
		t.Fatal("Get after TTL = true, want false")
	}
}

func TestMemoryCacheEvictsWhenOverMax(t *testing.T) {
	t.Parallel()

	c := newMemoryCache(time.Hour, 32)
	ctx := context.Background()
	c.Set(ctx, "a", CacheEntry{ContentType: "t", Data: []byte("1234567890")})
	c.Set(ctx, "b", CacheEntry{ContentType: "t", Data: []byte("1234567890")})
	c.Set(ctx, "c", CacheEntry{ContentType: "t", Data: []byte("1234567890")})

	if c.bytes > c.maxBytes {
		t.Fatalf("bytes = %d, want <= %d", c.bytes, c.maxBytes)
	}
	if _, ok := c.Get(ctx, "c"); !ok {
		t.Fatal("newest entry missing after eviction")
	}
}

func TestCacheKeyIncludesAcceptAndTransform(t *testing.T) {
	t.Parallel()

	reqA := httptest.NewRequest(http.MethodGet, "/images/episodes/x?w=400", nil)
	reqA.Header.Set("Accept", "image/webp")
	reqB := httptest.NewRequest(http.MethodGet, "/images/episodes/x?w=400", nil)
	reqB.Header.Set("Accept", "image/avif")
	reqC := httptest.NewRequest(http.MethodGet, "/images/episodes/x?w=800", nil)
	reqC.Header.Set("Accept", "image/webp")

	keyA := cacheKey("obj", reqA)
	keyB := cacheKey("obj", reqB)
	keyC := cacheKey("obj", reqC)
	if keyA == keyB {
		t.Fatal("Accept change must change cache key")
	}
	if keyA == keyC {
		t.Fatal("w change must change cache key")
	}
	if cacheKey("obj", reqA) != keyA {
		t.Fatal("cache key must be stable")
	}
}

func TestJoinSplitCachePayload(t *testing.T) {
	t.Parallel()

	entry := CacheEntry{ContentType: "image/avif", Data: []byte{0, 1, 2, 0, 3}}
	raw := joinCachePayload(entry)
	ct, data, ok := splitCachePayload(raw)
	if !ok {
		t.Fatal("splitCachePayload = false")
	}
	if ct != entry.ContentType {
		t.Fatalf("content type = %q, want %q", ct, entry.ContentType)
	}
	if string(data) != string(entry.Data) {
		t.Fatalf("data = %v, want %v", data, entry.Data)
	}
	if _, _, ok := splitCachePayload([]byte("no-separator")); ok {
		t.Fatal("splitCachePayload(invalid) = true")
	}
}

func TestRedisURLEnabled(t *testing.T) {
	t.Parallel()

	cases := map[string]bool{
		"":                   false,
		"disabled":           false,
		"OFF":                false,
		"false":              false,
		"redis://redis:6379": true,
	}
	for raw, want := range cases {
		if got := redisURLEnabled(raw); got != want {
			t.Errorf("redisURLEnabled(%q) = %v, want %v", raw, got, want)
		}
	}
}
