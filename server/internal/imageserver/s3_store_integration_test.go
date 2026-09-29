package imageserver_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/publira/publira/server/internal/imageserver"
	"github.com/publira/publira/server/internal/testutil"
)

func TestS3Store_Integration(t *testing.T) {
	env := testutil.StartRustFS(t)
	env.CreateBucket(t)

	ctx := context.Background()

	// Create S3 client
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(env.Region),
	)
	if err != nil {
		t.Fatalf("awsconfig.LoadDefaultConfig: %v", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = true
		o.BaseEndpoint = aws.String(env.Endpoint)
	})

	// Put test image object into S3
	testKey := "episodes/1/page_1.png"
	testData := []byte("fake-png-image-content")
	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(env.Bucket),
		Key:         aws.String(testKey),
		Body:        bytes.NewReader(testData),
		ContentType: aws.String("image/png"),
	})
	if err != nil {
		t.Fatalf("client.PutObject: %v", err)
	}

	// Test imageserver.S3Store
	store := imageserver.NewS3Store(client, env.Bucket)

	// 1. Get existing object
	res, err := store.GetObject(ctx, testKey)
	if err != nil {
		t.Fatalf("store.GetObject: %v", err)
	}
	defer res.Body.Close() //nolint:errcheck

	if res.ContentType != "image/png" {
		t.Errorf("got ContentType %q, want %q", res.ContentType, "image/png")
	}
	if res.ContentLength != int64(len(testData)) {
		t.Errorf("got ContentLength %d, want %d", res.ContentLength, len(testData))
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("io.ReadAll: %v", err)
	}
	if !bytes.Equal(body, testData) {
		t.Errorf("got body %q, want %q", string(body), string(testData))
	}

	// 2. Get non-existent object
	_, err = store.GetObject(ctx, "non-existent-key.png")
	if err == nil {
		t.Fatal("expected error for non-existent key, got nil")
	}
	if !errors.Is(err, imageserver.ErrObjectNotFound) {
		t.Errorf("got error %v, want ErrObjectNotFound", err)
	}
}
