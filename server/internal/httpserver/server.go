// Package httpserver builds the http.Server used by long-lived HTTP
// process entrypoints (API and image servers), with the shared timeout
// and protocol policy.
//
// Timeouts:
//
//   - ReadHeaderTimeout is set so a client that never finishes sending
//     headers cannot hold the accepted connection (Slowloris). The handler
//     never runs for that connection, so no middleware can stop it.
//   - IdleTimeout reclaims keep-alive connections that go quiet after a
//     request. Without it (and with ReadTimeout left at zero) those
//     connections stay open indefinitely.
//   - ReadTimeout and WriteTimeout stay at zero (unlimited). A global
//     ReadTimeout covers the entire request body, and UploadEpisodeImages
//     accepts zip/epub archives of unbounded compressed size (each of up
//     to 1000 entries is capped at 20 MiB uncompressed). A timeout short
//     enough to stop a slow-body attack would fail legitimate uploads.
//     WriteTimeout similarly covers handler work plus the response: image
//     processing can run 15s per image, and the image servers stream
//     object bytes to the client. Per-route deadlines belong on the
//     handler once those paths have explicit budgets.
//   - ShutdownTimeout is the single deadline Serve uses after the process
//     is asked to stop: first drain in-flight requests, then run hooks
//     with whatever time remains. It is not a request deadline — handlers
//     still have no WriteTimeout — and it is not two stacked 30s windows.
//     Idle keep-alives are not in-flight work; Shutdown closes them
//     immediately and does not wait IdleTimeout.
package httpserver

import (
	"net/http"
	"time"
)

const (
	// ReadHeaderTimeout is how long a client may take to finish sending
	// request headers. 10s is long enough for high-latency clients and
	// short enough to reclaim a stalled accept promptly.
	ReadHeaderTimeout = 10 * time.Second

	// IdleTimeout is how long a keep-alive connection may sit unused
	// after a request. 120s matches common reverse-proxy defaults.
	IdleTimeout = 120 * time.Second

	// ShutdownTimeout is the total time Serve spends after the caller
	// cancels the serve context (SIGINT / SIGTERM): first draining
	// in-flight requests, then running hooks on the leftover time.
	// 30s is longer than a single image-processing pass (~15s) and
	// matches the common container stop grace period. Orchestrators
	// should allow a little more than this before SIGKILL so Close
	// can still run if a request holds the drain until the deadline.
	ShutdownTimeout = 30 * time.Second
)

// New returns an http.Server that serves handler on addr with the shared
// timeout policy and with HTTP/1.1 plus prior-knowledge unencrypted HTTP/2
// enabled (what Connect and gRPC clients use; HTTP/1.1 clients are unchanged).
func New(addr string, handler http.Handler) *http.Server {
	return newServer(addr, handler, ReadHeaderTimeout, IdleTimeout)
}

func newServer(addr string, handler http.Handler, readHeader, idle time.Duration) *http.Server {
	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)

	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		Protocols:         protocols,
		ReadHeaderTimeout: readHeader,
		IdleTimeout:       idle,
	}
}
