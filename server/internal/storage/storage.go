package storage

import (
	"context"
	"errors"
	"time"
)

// ErrNotConfigured is what a storage operation answers on an installation
// whose operator has saved no object store yet. It is a state the Platform
// Console resolves, not a fault a retry can, so a caller reports it as such.
var ErrNotConfigured = errors.New("object storage is not configured")

type UploadRequest struct {
	ObjectKey   string
	ContentType string
	Data        []byte
}

type UploadResult struct {
	Provider  string
	ObjectKey string
	URL       string
	SizeBytes int64
}

type Provider interface {
	Upload(ctx context.Context, req UploadRequest) (UploadResult, error)
}

// Pinner is a Provider whose store can change between uploads. Pin answers
// the store as it is now, for an operation that writes several objects.
type Pinner interface {
	Pin(ctx context.Context) (Provider, error)
}

// Pin answers the provider every upload of one operation should go to, so the
// variants of one image cannot be split across a configuration change. A
// provider that cannot change is its own answer.
func Pin(ctx context.Context, provider Provider) (Provider, error) {
	if pinner, ok := provider.(Pinner); ok {
		return pinner.Pin(ctx)
	}
	return provider, nil
}

// Object is one stored object as a listing reports it.
type Object struct {
	ObjectKey    string
	LastModified time.Time
	SizeBytes    int64
}

// ListRequest asks for one page of the objects stored under Prefix. Cursor is
// empty for the first page and otherwise the NextCursor the previous page
// returned.
type ListRequest struct {
	Prefix string
	Cursor string
	Limit  int32
}

// ListResult is one page of a listing. NextCursor is empty on the last page.
type ListResult struct {
	Objects    []Object
	NextCursor string
}

// Reclaimer is the half of a storage backend that orphan reclamation needs:
// walking what is stored, and removing what nothing points at. It is kept
// apart from Provider because the upload paths have no business deleting
// anything, and the handler test doubles that stand in for Provider should not
// have to grow the methods that would let them.
type Reclaimer interface {
	List(ctx context.Context, req ListRequest) (ListResult, error)
	Delete(ctx context.Context, objectKeys []string) error
}

// ReclaimerSource resolves the bucket an orphan sweep reclaims, and the name
// its log calls it by. A pass resolves it once, so a configuration saved
// mid-pass cannot list one bucket and delete from another.
type ReclaimerSource interface {
	Reclaimer(ctx context.Context) (Reclaimer, string, error)
}
