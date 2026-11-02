// Package storagetest holds a bucket kept in memory, for the tests of code
// that stores objects, reads them back, and deletes them.
package storagetest

import (
	"bytes"
	"context"
	"io"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/publira/publira/server/internal/storage"
)

// Memory is a bucket kept in memory. It is a storage.Provider, a
// storage.Opener, a storage.Reclaimer, and the storage.ReclaimerSource that
// resolves to itself.
type Memory struct {
	mu       sync.Mutex
	objects  map[string][]byte
	modified map[string]time.Time
}

// NewMemory is an empty bucket.
func NewMemory() *Memory {
	return &Memory{objects: map[string][]byte{}, modified: map[string]time.Time{}}
}

// Upload implements storage.Provider.
func (m *Memory) Upload(_ context.Context, req storage.UploadRequest) (storage.UploadResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[req.ObjectKey] = slices.Clone(req.Data)
	m.modified[req.ObjectKey] = time.Now()
	return storage.UploadResult{Provider: "memory", ObjectKey: req.ObjectKey, SizeBytes: int64(len(req.Data))}, nil
}

// Open implements storage.Opener.
func (m *Memory) Open(_ context.Context, objectKey string) (io.ReadCloser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.objects[objectKey]
	if !ok {
		return nil, storage.ErrObjectNotFound
	}
	return io.NopCloser(bytes.NewReader(slices.Clone(data))), nil
}

// List implements storage.Reclaimer, in one page.
func (m *Memory) List(_ context.Context, req storage.ListRequest) (storage.ListResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var result storage.ListResult
	for key, data := range m.objects {
		if strings.HasPrefix(key, req.Prefix) {
			result.Objects = append(result.Objects, storage.Object{ObjectKey: key, LastModified: m.modified[key], SizeBytes: int64(len(data))})
		}
	}
	return result, nil
}

// Delete implements storage.Reclaimer.
func (m *Memory) Delete(_ context.Context, objectKeys []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, key := range objectKeys {
		delete(m.objects, key)
		delete(m.modified, key)
	}
	return nil
}

// Reclaimer implements storage.ReclaimerSource.
func (m *Memory) Reclaimer(context.Context) (storage.Reclaimer, string, error) {
	return m, "memory", nil
}

// Object answers what is stored under objectKey.
func (m *Memory) Object(objectKey string) ([]byte, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.objects[objectKey]
	return slices.Clone(data), ok
}

// Keys answers every key stored, sorted.
func (m *Memory) Keys() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	keys := make([]string, 0, len(m.objects))
	for key := range m.objects {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}
