package s3_test

import (
	"context"
	"testing"

	"github.com/publira/publira/server/internal/storage"
	"github.com/publira/publira/server/internal/storage/s3"
	"github.com/publira/publira/server/internal/testutil"
)

func TestS3Storage_Integration(t *testing.T) {
	env := testutil.StartRustFS(t)
	env.CreateBucket(t)

	// Initialize S3 storage
	s3Store, err := s3.New(context.Background(), s3.Config{
		Bucket:         env.Bucket,
		Region:         env.Region,
		Endpoint:       env.Endpoint,
		ForcePathStyle: true,
	})
	if err != nil {
		t.Fatalf("s3.New: %v", err)
	}

	// Upload object
	uploadReq := storage.UploadRequest{
		ObjectKey:   "test/hello.txt",
		Data:        []byte("Hello RustFS S3"),
		ContentType: "text/plain",
	}
	res, err := s3Store.Upload(context.Background(), uploadReq)
	if err != nil {
		t.Fatalf("s3Store.Upload: %v", err)
	}

	if res.Provider != "s3" {
		t.Errorf("got Provider %q, want %q", res.Provider, "s3")
	}
	if res.ObjectKey != "test/hello.txt" {
		t.Errorf("got ObjectKey %q, want %q", res.ObjectKey, "test/hello.txt")
	}
	if res.SizeBytes != int64(len(uploadReq.Data)) {
		t.Errorf("got SizeBytes %d, want %d", res.SizeBytes, len(uploadReq.Data))
	}
}
