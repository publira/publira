package disposabledomains

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/publira/publira/server/internal/platformpolicy"
)

// listServer serves body with status, and counts the requests it answers.
type listServer struct {
	mu       sync.Mutex
	status   int
	body     string
	requests int
}

func (s *listServer) set(status int, body string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status, s.body = status, body
}

func (s *listServer) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.requests
}

func (s *listServer) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests++
	w.WriteHeader(s.status)
	_, _ = w.Write([]byte(s.body))
}

// clock is a time a test moves forward past the refresh interval.
type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// policySource answers a policy naming url, or err, and lets a test change
// either between lookups.
type policySource struct {
	mu  sync.Mutex
	url string
	err error
}

func (s *policySource) set(url string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.url, s.err = url, err
}

func (s *policySource) Policy(context.Context) (platformpolicy.Policy, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return platformpolicy.Policy{}, s.err
	}
	policy := platformpolicy.Defaults()
	policy.DisposableEmailDomainsURL = s.url
	return policy, nil
}

// newRemoteList returns a List whose policy names a server answering status
// and body, on a clock the test moves.
func newRemoteList(t *testing.T, status int, body string) (*List, *listServer, *clock) {
	t.Helper()
	list, server, _, c := newListWithPolicy(t, status, body)
	return list, server, c
}

func newListWithPolicy(t *testing.T, status int, body string) (*List, *listServer, *policySource, *clock) {
	t.Helper()
	server := &listServer{status: status, body: body}
	ts := httptest.NewServer(server)
	t.Cleanup(ts.Close)
	source := &policySource{url: ts.URL}
	list := New(source, ts.Client(), nil)
	c := &clock{now: time.Unix(0, 0)}
	list.Now = c.Now
	return list, server, source, c
}

// isDisposable is IsDisposable for a policy that answers.
func isDisposable(t *testing.T, list *List, domain string) bool {
	t.Helper()
	disposable, err := list.IsDisposable(context.Background(), domain)
	if err != nil {
		t.Fatalf("IsDisposable(%q): %v", domain, err)
	}
	return disposable
}

func TestIsDisposableNamesNothingWithNoURL(t *testing.T) {
	t.Parallel()

	list := New(platformpolicy.Fixed(platformpolicy.Defaults()), nil, nil)
	if isDisposable(t, list, "mailinator.com") {
		t.Fatal("IsDisposable(mailinator.com) = true with no URL, want no list")
	}
}

// A policy that cannot be read is the caller's to report: answering "not
// disposable" would quietly switch the list off for every tenant.
func TestIsDisposableReportsAPolicyItCannotRead(t *testing.T) {
	t.Parallel()

	list, server, source, _ := newListWithPolicy(t, http.StatusOK, "first.test\n")
	source.set("", errors.New("database is down"))
	if _, err := list.IsDisposable(context.Background(), "first.test"); err == nil {
		t.Fatal("IsDisposable with an unreadable policy = nil error, want the policy's")
	}
	if got := server.count(); got != 0 {
		t.Fatalf("requests = %d, want no list read without a policy", got)
	}
}

// A URL saved in place of another is read at once, and the list read from
// the old one stops answering.
func TestIsDisposableReadsANewURLAtOnce(t *testing.T) {
	t.Parallel()

	list, _, source, _ := newListWithPolicy(t, http.StatusOK, "first.test\n")
	if !isDisposable(t, list, "first.test") {
		t.Fatal("IsDisposable(first.test) = false, want the first URL's list")
	}

	second := &listServer{status: http.StatusOK, body: "second.test\n"}
	ts := httptest.NewServer(second)
	t.Cleanup(ts.Close)
	source.set(ts.URL, nil)
	if !isDisposable(t, list, "second.test") || isDisposable(t, list, "first.test") {
		t.Fatal("after the URL changed, want the new URL's list alone within the same interval")
	}

	source.set("", nil)
	if isDisposable(t, list, "second.test") {
		t.Fatal("IsDisposable(second.test) = true after the URL was cleared, want no list")
	}
}

func TestIsDisposableMatchesTheDomainAndItsSubdomains(t *testing.T) {
	t.Parallel()

	list, _, _ := newRemoteList(t, http.StatusOK, "# a comment\n\nthrowaway.test\nShouting.Test.\n")
	for domain, want := range map[string]bool{
		"throwaway.test":         true,
		"mx.throwaway.test":      true,
		"a.b.throwaway.test":     true,
		"THROWAWAY.TEST":         true,
		" throwaway.test. ":      true,
		"shouting.test":          true,
		"notthrowaway.test":      false,
		"throwaway.test.example": false,
		"test":                   false,
		"":                       false,
	} {
		if got := isDisposable(t, list, domain); got != want {
			t.Errorf("IsDisposable(%q) = %v, want %v", domain, got, want)
		}
	}
}

// The list is written in ASCII, so a domain typed in Unicode is compared in
// the form its entry takes.
func TestIsDisposableComparesAUnicodeDomainInItsASCIIForm(t *testing.T) {
	t.Parallel()

	list, _, _ := newRemoteList(t, http.StatusOK, "xn--bcher-kva.test\n")
	if !isDisposable(t, list, "mail.Bücher.test") {
		t.Fatal("IsDisposable(mail.Bücher.test) = false, want the entry for xn--bcher-kva.test to match")
	}
}

func TestIsDisposableAnswersFromTheFetchedListOnceItLoads(t *testing.T) {
	t.Parallel()

	list, server, c := newRemoteList(t, http.StatusOK, "first.test\n")
	if !isDisposable(t, list, "first.test") {
		t.Fatal("IsDisposable(first.test) = false, want the fetched list's answer")
	}

	server.set(http.StatusOK, "second.test\n")
	c.advance(refreshInterval - time.Second)
	if !isDisposable(t, list, "first.test") || server.count() != 1 {
		t.Fatalf("within the interval: requests = %d, want the first list served without a fetch", server.count())
	}
	c.advance(time.Second)
	if !isDisposable(t, list, "second.test") || isDisposable(t, list, "first.test") {
		t.Fatal("past the interval, want the list fetched again and replaced wholesale")
	}
}

func TestIsDisposableKeepsTheLastGoodCopyWhileAFetchFails(t *testing.T) {
	t.Parallel()

	for name, failure := range map[string]struct {
		status int
		body   string
	}{
		"an error status":            {http.StatusServiceUnavailable, "try later"},
		"a page that is no list":     {http.StatusOK, "<!doctype html>\n<p>Not here</p>\n"},
		"an empty list":              {http.StatusOK, "# nothing yet\n"},
		"a whole top-level domain":   {http.StatusOK, "first.test\ncom\n"},
		"a list past the size limit": {http.StatusOK, strings.Repeat("x", maxListBytes) + ".test\n"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			list, server, c := newRemoteList(t, http.StatusOK, "first.test\n")
			if !isDisposable(t, list, "first.test") {
				t.Fatal("IsDisposable(first.test) = false before the failure")
			}

			server.set(failure.status, failure.body)
			c.advance(refreshInterval)
			if !isDisposable(t, list, "first.test") {
				t.Fatal("IsDisposable(first.test) = false, want the last good copy while the fetch fails")
			}
			if isDisposable(t, list, "com") {
				t.Fatal("IsDisposable(com) = true, want a refused list never to answer")
			}
			if got := server.count(); got != 2 {
				t.Fatalf("requests = %d, want the failed fetch to wait an interval before the next", got)
			}

			server.set(http.StatusOK, "second.test\n")
			c.advance(refreshInterval)
			if !isDisposable(t, list, "second.test") {
				t.Fatal("IsDisposable(second.test) = false, want the list that loads after the failure")
			}
		})
	}
}

// Until the first read succeeds there is no list, and a failed read waits an
// interval before the next one rather than costing every sign-up a request.
func TestIsDisposableNamesNothingUntilTheFirstFetchSucceeds(t *testing.T) {
	t.Parallel()

	list, server, c := newRemoteList(t, http.StatusBadGateway, "")
	for range 2 {
		if isDisposable(t, list, "first.test") {
			t.Fatal("IsDisposable(first.test) = true, want no list before a read succeeds")
		}
	}
	if got := server.count(); got != 1 {
		t.Fatalf("requests = %d, want the failed fetch to wait an interval before the next", got)
	}

	server.set(http.StatusOK, "first.test\n")
	c.advance(refreshInterval)
	if !isDisposable(t, list, "first.test") {
		t.Fatal("IsDisposable(first.test) = false, want the list once it loads")
	}
}

// A sign-up whose reader gave up must not cut the read short, or the stale
// list would stay in place for another whole interval.
func TestIsDisposableFinishesTheFetchForACanceledCaller(t *testing.T) {
	t.Parallel()

	list, _, _ := newRemoteList(t, http.StatusOK, "first.test\n")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if disposable, err := list.IsDisposable(ctx, "first.test"); err != nil || !disposable {
		t.Fatalf("IsDisposable(first.test) = %v, %v; want the fetch to load despite the canceled context", disposable, err)
	}
}
