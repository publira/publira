package disposabledomains

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
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

// newRemoteList returns a List refreshing from a server answering status and
// body, on a clock the test moves.
func newRemoteList(t *testing.T, status int, body string) (*List, *listServer, *clock) {
	t.Helper()
	server := &listServer{status: status, body: body}
	ts := httptest.NewServer(server)
	t.Cleanup(ts.Close)
	list := New(Config{URL: ts.URL, HTTPClient: ts.Client()})
	c := &clock{now: time.Unix(0, 0)}
	list.remote.Now = c.Now
	return list, server, c
}

func TestIsDisposableNamesNothingWithNoURL(t *testing.T) {
	t.Parallel()

	if New(Config{}).IsDisposable(context.Background(), "mailinator.com") {
		t.Fatal("IsDisposable(mailinator.com) = true with no URL, want no list")
	}
}

func TestIsDisposableMatchesTheDomainAndItsSubdomains(t *testing.T) {
	t.Parallel()

	list, _, _ := newRemoteList(t, http.StatusOK, "# a comment\n\nthrowaway.test\nShouting.Test.\n")
	ctx := context.Background()
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
		if got := list.IsDisposable(ctx, domain); got != want {
			t.Errorf("IsDisposable(%q) = %v, want %v", domain, got, want)
		}
	}
}

// The list is written in ASCII, so a domain typed in Unicode is compared in
// the form its entry takes.
func TestIsDisposableComparesAUnicodeDomainInItsASCIIForm(t *testing.T) {
	t.Parallel()

	list, _, _ := newRemoteList(t, http.StatusOK, "xn--bcher-kva.test\n")
	if !list.IsDisposable(context.Background(), "mail.Bücher.test") {
		t.Fatal("IsDisposable(mail.Bücher.test) = false, want the entry for xn--bcher-kva.test to match")
	}
}

func TestIsDisposableAnswersFromTheFetchedListOnceItLoads(t *testing.T) {
	t.Parallel()

	list, server, c := newRemoteList(t, http.StatusOK, "first.test\n")
	ctx := context.Background()
	if !list.IsDisposable(ctx, "first.test") {
		t.Fatal("IsDisposable(first.test) = false, want the fetched list's answer")
	}

	server.set(http.StatusOK, "second.test\n")
	c.advance(refreshInterval - time.Second)
	if !list.IsDisposable(ctx, "first.test") || server.count() != 1 {
		t.Fatalf("within the interval: requests = %d, want the first list served without a fetch", server.count())
	}
	c.advance(time.Second)
	if !list.IsDisposable(ctx, "second.test") || list.IsDisposable(ctx, "first.test") {
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
			ctx := context.Background()
			if !list.IsDisposable(ctx, "first.test") {
				t.Fatal("IsDisposable(first.test) = false before the failure")
			}

			server.set(failure.status, failure.body)
			c.advance(refreshInterval)
			if !list.IsDisposable(ctx, "first.test") {
				t.Fatal("IsDisposable(first.test) = false, want the last good copy while the fetch fails")
			}
			if list.IsDisposable(ctx, "com") {
				t.Fatal("IsDisposable(com) = true, want a refused list never to answer")
			}
			if got := server.count(); got != 2 {
				t.Fatalf("requests = %d, want the failed fetch to wait an interval before the next", got)
			}

			server.set(http.StatusOK, "second.test\n")
			c.advance(refreshInterval)
			if !list.IsDisposable(ctx, "second.test") {
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
	ctx := context.Background()
	for range 2 {
		if list.IsDisposable(ctx, "first.test") {
			t.Fatal("IsDisposable(first.test) = true, want no list before a read succeeds")
		}
	}
	if got := server.count(); got != 1 {
		t.Fatalf("requests = %d, want the failed fetch to wait an interval before the next", got)
	}

	server.set(http.StatusOK, "first.test\n")
	c.advance(refreshInterval)
	if !list.IsDisposable(ctx, "first.test") {
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
	if !list.IsDisposable(ctx, "first.test") {
		t.Fatal("IsDisposable(first.test) = false, want the fetch to load despite the canceled context")
	}
}

func TestConfigFromEnv(t *testing.T) {
	for name, tc := range map[string]struct {
		value   string
		wantURL string
		wantErr bool
	}{
		"unset":           {value: "", wantURL: ""},
		"an https URL":    {value: " https://lists.example.com/disposable.conf ", wantURL: "https://lists.example.com/disposable.conf"},
		"a relative path": {value: "lists/disposable.conf", wantErr: true},
		"another scheme":  {value: "file:///etc/disposable.conf", wantErr: true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("PUBLIRA_DISPOSABLE_EMAIL_DOMAINS_URL", tc.value)
			cfg, err := ConfigFromEnv()
			if (err != nil) != tc.wantErr {
				t.Fatalf("ConfigFromEnv() error = %v, want an error: %v", err, tc.wantErr)
			}
			if cfg.URL != tc.wantURL {
				t.Fatalf("ConfigFromEnv().URL = %q, want %q", cfg.URL, tc.wantURL)
			}
		})
	}
}
