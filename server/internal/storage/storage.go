package storage

import (
	"context"
	"time"
)

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
