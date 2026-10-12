package httpserver

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"
)

// Listener is one http.Server and the name the startup log gives it.
type Listener struct {
	Name   string
	Server *http.Server
}

// Serve listens on each server until ctx is cancelled or a listener
// fails, then stops them together.
//
// Every address is bound before any server starts, and the startup log
// names the address that was bound rather than the one that was asked
// for: an Addr with port 0 is given whatever port the kernel picks, and
// the log line is the only place that port is reported. A failure to
// bind is handled like a server that failed while serving.
//
// On stop it calls Shutdown against a deadline of [ShutdownTimeout]
// so in-flight requests can finish. A server that has not drained
// by then is Close'd so the process still exits. Each of stops starts
// at that same moment, beside the drain and against the same deadline:
// it is for work no request feeds, such as a job queue, which would
// otherwise begin to stop only once the slowest request had finished
// and find the deadline mostly spent. Serve waits for every stop
// before the hooks run. Hooks then run in order against the same
// deadline — leftover time is theirs, not a second ShutdownTimeout —
// and are for what the requests feed: an audit log flush, a telemetry
// flush, the database pools. Callers that still defer db.Close keep
// that as a safety net for the paths that never reach Serve; Close on
// *sql.DB is a no-op the second time.
func Serve(ctx context.Context, logger *slog.Logger, listeners []Listener, stops []func(context.Context) error, hooks ...func(context.Context) error) error {
	if logger == nil {
		logger = slog.Default()
	}
	servers := make([]*http.Server, len(listeners))
	starts := make([]func() error, len(listeners))
	for i, l := range listeners {
		servers[i] = l.Server
		addr := l.Server.Addr
		if addr == "" {
			// What ListenAndServe would have listened on.
			addr = ":http"
		}
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			starts[i] = func() error { return err }
			continue
		}
		logger.Info("starting "+l.Name, "addr", ln.Addr().String())
		starts[i] = func() error { return l.Server.Serve(ln) }
	}
	return run(ctx, logger, ShutdownTimeout, servers, starts, stops, hooks)
}

func run(ctx context.Context, logger *slog.Logger, timeout time.Duration, servers []*http.Server, starts []func() error, stops, hooks []func(context.Context) error) error {
	if logger == nil {
		logger = slog.Default()
	}
	if timeout <= 0 {
		timeout = ShutdownTimeout
	}

	var (
		mu       sync.Mutex
		firstErr error
	)
	setErr := func(err error) {
		if err == nil {
			return
		}
		mu.Lock()
		if firstErr == nil {
			firstErr = err
		}
		mu.Unlock()
	}

	serveErrs := make(chan error, len(starts))
	var wg sync.WaitGroup
	for i, start := range starts {
		if start == nil {
			continue
		}
		wg.Add(1)
		go func(start func() error, srv *http.Server) {
			defer wg.Done()
			err := start()
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				if srv != nil {
					logger.Error("http server failed", "addr", srv.Addr, "error", err)
				} else {
					logger.Error("http server failed", "error", err)
				}
				serveErrs <- err
			}
		}(start, serverAt(servers, i))
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutting down http servers", "timeout", timeout)
	case err := <-serveErrs:
		setErr(err)
	case <-done:
	}

	deadline := time.Now().Add(timeout)
	shutdownCtx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()

	var stopWG sync.WaitGroup
	for _, stop := range stops {
		if stop == nil {
			continue
		}
		stopWG.Add(1)
		go func(stop func(context.Context) error) {
			defer stopWG.Done()
			if err := stop(shutdownCtx); err != nil {
				logger.Error("shutdown stop failed", "error", err)
				setErr(err)
			}
		}(stop)
	}

	var shutdownWG sync.WaitGroup
	for _, srv := range servers {
		if srv == nil {
			continue
		}
		shutdownWG.Add(1)
		go func(srv *http.Server) {
			defer shutdownWG.Done()
			if err := srv.Shutdown(shutdownCtx); err != nil {
				logger.Error("http shutdown exceeded grace period; closing", "addr", srv.Addr, "error", err)
				if closeErr := srv.Close(); closeErr != nil {
					logger.Error("http server close failed", "addr", srv.Addr, "error", closeErr)
					setErr(closeErr)
				}
			}
		}(srv)
	}
	shutdownWG.Wait()
	<-done
	drainErrs(serveErrs, setErr)
	stopWG.Wait()

	hookCtx, hookCancel := context.WithDeadline(context.Background(), deadline)
	defer hookCancel()
	for _, hook := range hooks {
		if hook == nil {
			continue
		}
		if err := hook(hookCtx); err != nil {
			logger.Error("shutdown hook failed", "error", err)
			setErr(err)
		}
	}

	return firstErr
}

func serverAt(servers []*http.Server, i int) *http.Server {
	if i < 0 || i >= len(servers) {
		return nil
	}
	return servers[i]
}

func drainErrs(errs <-chan error, setErr func(error)) {
	for {
		select {
		case err := <-errs:
			setErr(err)
		default:
			return
		}
	}
}
