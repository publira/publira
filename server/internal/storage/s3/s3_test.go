package s3

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awss3 "github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/publira/publira/server/internal/storage"
)

// blockingClient never answers, so every call ends at its context's deadline.
type blockingClient struct{}

func (blockingClient) PutObject(ctx context.Context, _ *awss3.PutObjectInput, _ ...func(*awss3.Options)) (*awss3.PutObjectOutput, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func (blockingClient) ListObjectsV2(ctx context.Context, _ *awss3.ListObjectsV2Input, _ ...func(*awss3.Options)) (*awss3.ListObjectsV2Output, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func (blockingClient) DeleteObjects(ctx context.Context, _ *awss3.DeleteObjectsInput, _ ...func(*awss3.Options)) (*awss3.DeleteObjectsOutput, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestStorageUploadTimesOut(t *testing.T) {
	store := Storage{
		client:        blockingClient{},
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

func TestStorageListTimesOut(t *testing.T) {
	store := Storage{
		client:         blockingClient{},
		bucket:         "test-bucket",
		reclaimTimeout: 10 * time.Millisecond,
	}

	startedAt := time.Now()
	_, err := store.List(t.Context(), storage.ListRequest{Prefix: "tenants/"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("List error = %v, want context.DeadlineExceeded", err)
	}
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("List returned after %v, want it to respect the timeout", elapsed)
	}
}

func TestStorageDeleteTimesOut(t *testing.T) {
	store := Storage{
		client:         blockingClient{},
		bucket:         "test-bucket",
		reclaimTimeout: 10 * time.Millisecond,
	}

	startedAt := time.Now()
	err := store.Delete(t.Context(), []string{"test/object"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Delete error = %v, want context.DeadlineExceeded", err)
	}
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("Delete returned after %v, want it to respect the timeout", elapsed)
	}
}

// TestStorageDeleteReportsPerKeyFailures covers the shape a batch delete uses
// for a key it refused: HTTP 200 with the failure in the response body, which
// a caller that only checked the request error would read as a success.
func TestStorageDeleteReportsPerKeyFailures(t *testing.T) {
	store := Storage{
		client: refusingDeleteClient{key: "tenants/a/icons/denied.webp", message: "AccessDenied"},
		bucket: "test-bucket",
	}

	err := store.Delete(t.Context(), []string{"tenants/a/icons/denied.webp"})
	if err == nil {
		t.Fatal("Delete error = nil, want the refused key reported")
	}
	if !strings.Contains(err.Error(), "tenants/a/icons/denied.webp") || !strings.Contains(err.Error(), "AccessDenied") {
		t.Fatalf("Delete error = %v, want it to name the refused key and reason", err)
	}
}

// refusingDeleteClient answers a batch delete the way S3 reports a key it
// would not remove.
type refusingDeleteClient struct {
	blockingClient
	key     string
	message string
}

func (c refusingDeleteClient) DeleteObjects(_ context.Context, _ *awss3.DeleteObjectsInput, _ ...func(*awss3.Options)) (*awss3.DeleteObjectsOutput, error) {
	return &awss3.DeleteObjectsOutput{
		Errors: []s3types.Error{{Key: aws.String(c.key), Message: aws.String(c.message)}},
	}, nil
}
