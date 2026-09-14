package testutil

import (
	"sync"
	"testing"
)

// A case about a handler that must keep one row per account submits
// ConcurrentBursts bursts of ConcurrentRequests requests and checks the rows
// after every burst. Requests released together overlap inside the transaction
// only some of the time, so a single burst lets a missing lock through often
// enough to be no guard at all.
const (
	ConcurrentRequests = 5
	ConcurrentBursts   = 8
)

// RunConcurrently releases n copies of one request together and fails the test
// if any of them errors.
func RunConcurrently(t *testing.T, n int, request func() error) {
	t.Helper()

	start := make(chan struct{})
	errs := make(chan error, n)
	var wg sync.WaitGroup
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			errs <- request()
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("one of %d concurrent requests failed: %v", n, err)
		}
	}
}
