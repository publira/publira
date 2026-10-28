package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestHealthcheckSucceedsWhenEveryURLAnswers200(t *testing.T) {
	livez := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(livez.Close)
	readyz := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok","checks":{}}`))
	}))
	t.Cleanup(readyz.Close)

	var stderr strings.Builder
	if code := run([]string{"healthcheck", livez.URL + "/livez", readyz.URL + "/readyz"}, &stderr); code != 0 {
		t.Fatalf("exit code = %d, want 0; stderr = %q", code, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q, want nothing", stderr.String())
	}
}

// One URL that is not ready fails the probe, and what it answered is printed,
// since Docker keeps a healthcheck's output where `docker inspect` shows it.
func TestHealthcheckFailsWhenOneURLDoesNot(t *testing.T) {
	ready := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok","checks":{}}`))
	}))
	t.Cleanup(ready.Close)
	unavailable := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"status":"unavailable","checks":{"db.outbox":{"status":"error","error":"timeout"}}}`))
	}))
	t.Cleanup(unavailable.Close)

	var stderr strings.Builder
	if code := run([]string{"healthcheck", ready.URL + "/readyz", unavailable.URL + "/readyz"}, &stderr); code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	out := stderr.String()
	if !strings.Contains(out, unavailable.URL+"/readyz answered 503 Service Unavailable") || !strings.Contains(out, `"db.outbox"`) {
		t.Fatalf("stderr = %q, want the URL, its status, and its body", out)
	}
	if strings.Contains(out, ready.URL) {
		t.Fatalf("stderr = %q, want nothing about the URL that answered 200", out)
	}
}

func TestHealthcheckFailsWhenNothingAnswers(t *testing.T) {
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()

	var stderr strings.Builder
	if code := run([]string{"healthcheck", closed.URL + "/livez"}, &stderr); code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), closed.URL+"/livez") {
		t.Fatalf("stderr = %q, want the URL", stderr.String())
	}
}

// The URLs are asked side by side, so the probe takes as long as the slowest
// one rather than all of them together. Each answer here waits until every
// request has arrived, which never happens when they are asked one by one.
func TestHealthcheckAsksTheURLsSideBySide(t *testing.T) {
	const urls = 3
	var arrived sync.WaitGroup
	arrived.Add(urls)
	all := make(chan struct{})
	go func() {
		arrived.Wait()
		close(all)
	}()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		arrived.Done()
		select {
		case <-all:
			_, _ = w.Write([]byte("ok"))
		case <-time.After(5 * time.Second):
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	t.Cleanup(server.Close)

	var stderr strings.Builder
	if code := run([]string{"healthcheck", server.URL + "/a", server.URL + "/b", server.URL + "/c"}, &stderr); code != 0 {
		t.Fatalf("exit code = %d, want 0; stderr = %q", code, stderr.String())
	}
}
