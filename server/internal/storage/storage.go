package storage

import "context"

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
