package testutil

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
)

func testAWSConfig() aws.Config {
	cfg := aws.Config{
		Region:      defaultRustFSRegion,
		Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""),
	}
	return cfg
}

func TestAwaitWritableRetriesWhileTheStoreAnswers503(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) <= 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	client := newS3Client(testAWSConfig(), srv.URL)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()

	if err := awaitWritable(ctx, client, "publira-test", time.Millisecond); err != nil {
		t.Fatalf("awaitWritable: %v", err)
	}
	if got := calls.Load(); got != 4 {
		t.Fatalf("requests = %d, want 4", got)
	}
}

func TestAwaitWritableFailsOnceTheWaitEnds(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(srv.Close)

	client := newS3Client(testAWSConfig(), srv.URL)
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()

	err := awaitWritable(ctx, client, "publira-test", 10*time.Millisecond)
	if err == nil {
		t.Fatal("awaitWritable succeeded against a store that never stops answering 503")
	}
	if !strings.Contains(err.Error(), "503") || !strings.Contains(err.Error(), "deadline exceeded") {
		t.Fatalf("error = %v, want it to name the 503 and the deadline", err)
	}
}

func TestAwaitWritableFailsAtOnceOnAnErrorOtherThan503(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusForbidden)
	}))
	t.Cleanup(srv.Close)

	client := newS3Client(testAWSConfig(), srv.URL)
	if err := awaitWritable(t.Context(), client, "publira-test", time.Millisecond); err == nil {
		t.Fatal("awaitWritable succeeded against a store that answers 403")
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("requests = %d, want 1", got)
	}
}
