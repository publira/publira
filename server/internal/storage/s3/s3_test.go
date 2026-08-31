package s3

import (
	"context"
	"errors"
	"testing"
	"time"

	awss3 "github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/publira/publira/server/internal/storage"
)

type blockingPutObjectClient struct{}

func (blockingPutObjectClient) PutObject(ctx context.Context, _ *awss3.PutObjectInput, _ ...func(*awss3.Options)) (*awss3.PutObjectOutput, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestStorageUploadTimesOut(t *testing.T) {
	store := Storage{
		client:        blockingPutObjectClient{},
		bucket:        "test-bucket",
		uploadTimeout: 10 * time.Millisecond,
	}

	startedAt := time.Now()
	_, err := store.Upload(t.Context(), storage.UploadRequest{ObjectKey: "test/object"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Upload error = %v, want context.DeadlineExceeded", err)
	}
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("Upload returned after %v, want it to respect the timeout", elapsed)
	}
}
