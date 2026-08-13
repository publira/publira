// Package httpserver builds the http.Server used by the API process
// entrypoints, with the shared timeout and protocol policy.
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
//     WriteTimeout similarly covers handler work plus the response; image
//     processing alone can run 15s per image. Per-route deadlines belong
//     on the handler once those RPCs have explicit budgets.
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
)

// New returns an http.Server that serves handler on addr with the shared
// timeout policy and with HTTP/1.1 plus prior-knowledge unencrypted HTTP/2
// enabled (what Connect and gRPC clients in this stack use).
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
