package httpserver

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestServeDrainsInFlightRequest(t *testing.T) {
	t.Parallel()

	started := make(chan struct{})
	release := make(chan struct{})
	addr, cancel, errCh := startTestServe(t, 2*time.Second, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusNoContent)
	}))
	defer cancel()

	statusCh := make(chan int, 1)
	errGet := make(chan error, 1)
	go func() {
		resp, err := http.Get("http://" + addr + "/")
		if err != nil {
			errGet <- err
			return
		}
		defer resp.Body.Close() //nolint:errcheck
		_, _ = io.Copy(io.Discard, resp.Body)
		statusCh <- resp.StatusCode
	}()

	select {
	case <-started:
	case err := <-errGet:
		t.Fatalf("GET: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not start")
	}

	cancel()
	close(release)

	select {
	case err := <-errGet:
		t.Fatalf("GET after shutdown: %v", err)
	case status := <-statusCh:
		if status != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", status, http.StatusNoContent)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("in-flight request did not finish")
	}

	if err := waitServe(t, errCh); err != nil {
		t.Fatalf("Serve: %v", err)
	}
}

func TestServeClosesWhenGraceExpires(t *testing.T) {
	t.Parallel()

	started := make(chan struct{})
	addr, cancel, errCh := startTestServe(t, 150*time.Millisecond, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		close(started)
		// Never return. Shutdown must time out and Close the connection.
		time.Sleep(10 * time.Second)
	}))
	defer cancel()

	getErr := make(chan error, 1)
	go func() {
		resp, err := http.Get("http://" + addr + "/")
		if err != nil {
			getErr <- err
			return
		}
		defer resp.Body.Close() //nolint:errcheck
		_, _ = io.Copy(io.Discard, resp.Body)
		getErr <- nil
	}()

	select {
	case <-started:
	case err := <-getErr:
		t.Fatalf("GET: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not start")
	}

	cancel()

	waitStart := time.Now()
	if err := waitServe(t, errCh); err != nil {
		t.Fatalf("Serve: %v", err)
	}
	if elapsed := time.Since(waitStart); elapsed > 2*time.Second {
		t.Fatalf("Serve took %s after cancel; Close should have unblocked it", elapsed)
	}

	select {
	case err := <-getErr:
		if err == nil {
			t.Fatal("stuck request completed after Close; want a connection error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("client was not disconnected after Close")
	}
}

func TestServeRunsHooksInOrderAfterDrain(t *testing.T) {
	t.Parallel()

	var (
		mu    sync.Mutex
		steps []string
	)
	record := func(step string) {
		mu.Lock()
		steps = append(steps, step)
		mu.Unlock()
	}

	started := make(chan struct{})
	release := make(chan struct{})
	addr, cancel, errCh := startTestServe(t, 2*time.Second, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		record("handler")
		w.WriteHeader(http.StatusNoContent)
	}), func(context.Context) error {
		record("otel")
		return nil
	}, func(context.Context) error {
		record("db")
		return nil
	})
	defer cancel()

	go func() {
		resp, err := http.Get("http://" + addr + "/")
		if err != nil {
			t.Errorf("GET: %v", err)
			return
		}
		_ = resp.Body.Close()
	}()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not start")
	}

	cancel()
	close(release)

	if err := waitServe(t, errCh); err != nil {
		t.Fatalf("Serve: %v", err)
	}

	mu.Lock()
	got := append([]string(nil), steps...)
	mu.Unlock()
	want := []string{"handler", "otel", "db"}
	if len(got) != len(want) {
		t.Fatalf("steps = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("steps = %v, want %v", got, want)
		}
	}
}

func TestServeReturnsListenError(t *testing.T) {
	t.Parallel()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close() //nolint:errcheck

	srv := New(ln.Addr().String(), http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- Serve(ctx, discardLogger(), []*http.Server{srv})
	}()

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("Serve = nil, want a listen error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Serve did not return a listen error")
	}
}

func TestServeStopsEveryListener(t *testing.T) {
	t.Parallel()

	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	ln1, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen 1: %v", err)
	}
	ln2, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen 2: %v", err)
	}

	srv1 := New(ln1.Addr().String(), handler)
	srv2 := New(ln2.Addr().String(), handler)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- run(ctx, discardLogger(), 2*time.Second, []*http.Server{srv1, srv2}, []func() error{
			func() error { return srv1.Serve(ln1) },
			func() error { return srv2.Serve(ln2) },
		}, nil)
	}()

	for _, addr := range []string{ln1.Addr().String(), ln2.Addr().String()} {
		resp, err := http.Get("http://" + addr + "/")
		if err != nil {
			t.Fatalf("GET %s: %v", addr, err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("GET %s status = %d", addr, resp.StatusCode)
		}
	}

	cancel()
	if err := waitServe(t, errCh); err != nil {
		t.Fatalf("Serve: %v", err)
	}

	for _, addr := range []string{ln1.Addr().String(), ln2.Addr().String()} {
		if _, err := http.Get("http://" + addr + "/"); err == nil {
			t.Fatalf("GET %s succeeded after shutdown", addr)
		}
	}
}

func TestServeReportsHookError(t *testing.T) {
	t.Parallel()

	hookErr := errors.New("flush failed")
	addr, cancel, errCh := startTestServe(t, 2*time.Second, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), func(context.Context) error {
		return hookErr
	})
	defer cancel()

	resp, err := http.Get("http://" + addr + "/")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	_ = resp.Body.Close()

	cancel()
	if err := waitServe(t, errCh); !errors.Is(err, hookErr) {
		t.Fatalf("Serve = %v, want %v", err, hookErr)
	}
}

func startTestServe(t *testing.T, timeout time.Duration, handler http.Handler, hooks ...func(context.Context) error) (addr string, cancel context.CancelFunc, errCh <-chan error) {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := New(ln.Addr().String(), handler)
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan error, 1)
	go func() {
		ch <- run(ctx, discardLogger(), timeout, []*http.Server{srv}, []func() error{
			func() error { return srv.Serve(ln) },
		}, hooks)
	}()
	t.Cleanup(cancel)
	return ln.Addr().String(), cancel, ch
}

func waitServe(t *testing.T, errCh <-chan error) error {
	t.Helper()
	select {
	case err := <-errCh:
		return err
	case <-time.After(3 * time.Second):
		t.Fatal("Serve did not return")
		return nil
	}
}

func discardLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}
