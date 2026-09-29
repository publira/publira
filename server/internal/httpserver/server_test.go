package httpserver

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewAppliesSharedPolicy(t *testing.T) {
	t.Parallel()

	handler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	srv := New("127.0.0.1:0", handler)

	if srv.Addr != "127.0.0.1:0" {
		t.Fatalf("Addr = %q", srv.Addr)
	}
	if srv.Handler == nil {
		t.Fatal("Handler is nil")
	}
	if srv.ReadHeaderTimeout != ReadHeaderTimeout {
		t.Fatalf("ReadHeaderTimeout = %s, want %s", srv.ReadHeaderTimeout, ReadHeaderTimeout)
	}
	if srv.IdleTimeout != IdleTimeout {
		t.Fatalf("IdleTimeout = %s, want %s", srv.IdleTimeout, IdleTimeout)
	}
	if srv.ReadTimeout != 0 {
		t.Fatalf("ReadTimeout = %s, want 0 (unlimited; see package comment)", srv.ReadTimeout)
	}
	if srv.WriteTimeout != 0 {
		t.Fatalf("WriteTimeout = %s, want 0 (unlimited; see package comment)", srv.WriteTimeout)
	}
	if srv.Protocols == nil {
		t.Fatal("Protocols is nil")
	}
	if !srv.Protocols.HTTP1() {
		t.Fatal("HTTP/1.1 is disabled")
	}
	if !srv.Protocols.UnencryptedHTTP2() {
		t.Fatal("unencrypted HTTP/2 is disabled")
	}
}

func TestNewServesCompleteRequest(t *testing.T) {
	t.Parallel()

	addr := startServer(t, New("127.0.0.1:0", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))

	resp, err := http.Get("http://" + addr + "/")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close() //nolint:errcheck
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}
}

func TestReadHeaderTimeoutClosesSlowClient(t *testing.T) {
	t.Parallel()

	var handlerReached atomic.Bool
	headerTimeout := 150 * time.Millisecond
	addr := startServer(t, newServer("127.0.0.1:0", http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		handlerReached.Store(true)
	}), headerTimeout, 0))

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close() //nolint:errcheck

	// Incomplete headers: the request line only, then stall.
	if _, err := conn.Write([]byte("GET / HTTP/1.1\r\n")); err != nil {
		t.Fatalf("write: %v", err)
	}

	assertConnClosed(t, conn)
	if handlerReached.Load() {
		t.Fatal("handler ran for a request whose headers never finished")
	}
}

func TestIdleTimeoutClosesKeepAlive(t *testing.T) {
	t.Parallel()

	idle := 150 * time.Millisecond
	addr := startServer(t, newServer("127.0.0.1:0", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), 0, idle))

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close() //nolint:errcheck

	if _, err := conn.Write([]byte("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := readHTTPResponse(conn); err != nil {
		t.Fatalf("read response: %v", err)
	}

	assertConnClosed(t, conn)
}

func startServer(t *testing.T, srv *http.Server) string {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.Serve(ln)
	}()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			t.Errorf("Shutdown: %v", err)
		}
		err := <-errCh
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.Errorf("Serve: %v", err)
		}
	})
	return ln.Addr().String()
}

func assertConnClosed(t *testing.T, conn net.Conn) {
	t.Helper()

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 8)
	n, err := conn.Read(buf)
	if err == nil {
		t.Fatalf("connection still readable: %q", buf[:n])
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatal("server did not close the connection before the read deadline")
	}
	if !errors.Is(err, io.EOF) && !isConnClosed(err) {
		t.Fatalf("read error = %v, want EOF or a closed connection", err)
	}
}

func readHTTPResponse(conn net.Conn) error {
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close() //nolint:errcheck
	_, err = io.Copy(io.Discard, resp.Body)
	return err
}

func isConnClosed(err error) bool {
	var opErr *net.OpError
	return errors.As(err, &opErr)
}
