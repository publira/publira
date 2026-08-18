package httpserver

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// Serve listens on each server until ctx is cancelled or a listener
// fails, then stops them together.
//
// On stop it calls Shutdown with [ShutdownTimeout] so in-flight
// requests can finish. A server that has not drained by then is
// Close'd so the process still exits. After every listener has
// returned, hooks run in order on a fresh budget of ShutdownTimeout:
// flush telemetry first, then close the database pool. Callers that
// still defer db.Close keep that as a safety net for the paths that
// never reach Serve; Close on *sql.DB is a no-op the second time.
func Serve(ctx context.Context, logger *slog.Logger, servers []*http.Server, hooks ...func(context.Context) error) error {
	starts := make([]func() error, len(servers))
	for i, srv := range servers {
		starts[i] = srv.ListenAndServe
	}
	return run(ctx, logger, ShutdownTimeout, servers, starts, hooks)
}

func run(ctx context.Context, logger *slog.Logger, timeout time.Duration, servers []*http.Server, starts []func() error, hooks []func(context.Context) error) error {
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

	shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

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

	hookCtx, hookCancel := context.WithTimeout(context.Background(), timeout)
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
