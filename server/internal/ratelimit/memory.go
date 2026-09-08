package ratelimit

import (
	"context"
	"sync"
	"time"
)

// sweepInterval is how often an expired counter is collected. The counters are
// short-lived and small, so sweeping on a timer rather than on every write
// keeps the lock held for as little as possible while still bounding the map
// to the subjects that were active recently.
const sweepInterval = time.Minute

// MemoryStore keeps the counters in this process alone.
//
// It is what a deployment with no Redis gets, and what every deployment falls
// back to when Redis cannot be reached: a limit each instance enforces on its
// own is looser than a shared one by the number of instances, and far tighter
// than no limit at all.
type MemoryStore struct {
	mu        sync.Mutex
	entries   map[string]memoryEntry
	now       func() time.Time
	lastSweep time.Time
}

type memoryEntry struct {
	count     int64
	expiresAt time.Time
}

// NewMemoryStore returns an empty in-process store.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{entries: make(map[string]memoryEntry), now: time.Now}
}

func (s *MemoryStore) Incr(_ context.Context, key string, ttl time.Duration) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	s.sweep(now)
	entry, ok := s.entries[key]
	if !ok || !entry.expiresAt.After(now) {
		entry = memoryEntry{expiresAt: now.Add(ttl)}
	}
	entry.count++
	s.entries[key] = entry
	return entry.count, nil
}

func (s *MemoryStore) Add(_ context.Context, key string, ttl time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	s.sweep(now)
	if entry, ok := s.entries[key]; ok && entry.expiresAt.After(now) {
		return false, nil
	}
	s.entries[key] = memoryEntry{count: 1, expiresAt: now.Add(ttl)}
	return true, nil
}

func (s *MemoryStore) Forget(_ context.Context, key string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.entries, key)
}

// sweep drops the counters whose window has passed. The caller holds the lock.
func (s *MemoryStore) sweep(now time.Time) {
	if now.Sub(s.lastSweep) < sweepInterval {
		return
	}
	s.lastSweep = now
	for key, entry := range s.entries {
		if !entry.expiresAt.After(now) {
			delete(s.entries, key)
		}
	}
}
