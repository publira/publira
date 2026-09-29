package testutil

import (
	"database/sql"
	"sync"
	"testing"
	"time"
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

// WaitForBlockedBackend waits until a connection to this database is waiting on
// a lock. A case that holds a row itself uses it to know the request it started
// has reached that row rather than merely been dispatched, which is what makes
// "the row changed while the request waited" a step rather than a race.
func WaitForBlockedBackend(t *testing.T, db *sql.DB) {
	t.Helper()

	WaitForBlockedBackends(t, db, 1)
}

// WaitForBlockedBackends is WaitForBlockedBackend for n requests queued behind
// the same held row, so a case can release them into the lock together only
// once every one of them has got past whatever it does before taking it.
func WaitForBlockedBackends(t *testing.T, db *sql.DB, n int) {
	t.Helper()

	deadline := time.Now().Add(10 * time.Second)
	blocked := 0
	for time.Now().Before(deadline) {
		if err := db.QueryRow(`
			SELECT count(*) FROM pg_stat_activity
			WHERE wait_event_type = 'Lock' AND state = 'active'
		`).Scan(&blocked); err != nil {
			t.Fatalf("read pg_stat_activity: %v", err)
		}
		if blocked >= n {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("%d of %d connections reached the held row before the timeout", blocked, n)
}
