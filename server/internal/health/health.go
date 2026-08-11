// Package health provides shared liveness (/livez) and readiness (/readyz) HTTP handlers.
//
// Probe conventions (Kubernetes-style):
//   - GET /livez  — process is up; always 200 when the handler is reachable.
//   - GET /readyz — dependencies are healthy; 200 when ready, 503 otherwise.
//
// /readyz response body is JSON:
//
//	{"status":"ok|unavailable|starting","checks":{"db":{"status":"ok|error","error":"..."}}}
//
// Status values:
//   - ok          — all checks passed (HTTP 200)
//   - unavailable — at least one dependency check failed (HTTP 503)
//   - starting    — process is not yet ready to accept traffic (HTTP 503);
//     set via WithReady when a readiness gate is closed
//
// Public error categories on checks (never raw dependency messages):
//   - not configured
//   - timeout
//   - dependency_failed
//   - duplicate checker name
package health

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"
)

const (
	StatusOK          = "ok"
	StatusUnavailable = "unavailable"
	StatusStarting    = "starting"
	StatusError       = "error"

	// Public /readyz error categories (stable; no internal host/URL detail).
	ErrorNotConfigured    = "not configured"
	ErrorTimeout          = "timeout"
	ErrorDependencyFailed = "dependency_failed"
	ErrorDuplicateChecker = "duplicate checker name"

	defaultCheckTimeout = 2 * time.Second
)

// Checker is a named readiness dependency check.
type Checker interface {
	Name() string
	Check(ctx context.Context) error
}

// DBChecker pings a *sql.DB.
type DBChecker struct {
	DB *sql.DB
}

// Name returns the check name used in /readyz JSON.
func (c *DBChecker) Name() string { return "db" }

// Check pings the database within the request context.
func (c *DBChecker) Check(ctx context.Context) error {
	if c == nil || c.DB == nil {
		return errNotConfigured
	}
	return c.DB.PingContext(ctx)
}

type notConfiguredError struct{}

func (notConfiguredError) Error() string { return ErrorNotConfigured }

var errNotConfigured = notConfiguredError{}

// Options configures probe registration.
type Options struct {
	Checkers []Checker
	// Ready, when non-nil and returning false, makes /readyz respond with
	// status "starting" and HTTP 503 even if dependency checks pass.
	Ready func() bool
	// CheckTimeout bounds each dependency check. Zero means defaultCheckTimeout.
	CheckTimeout time.Duration
}

// Option mutates Options.
type Option func(*Options)

// WithDB registers a database ping check. A nil db is reported as not configured.
func WithDB(db *sql.DB) Option {
	return func(o *Options) {
		o.Checkers = append(o.Checkers, &DBChecker{DB: db})
	}
}

// WithChecker registers an additional readiness check.
func WithChecker(c Checker) Option {
	return func(o *Options) {
		if c != nil {
			o.Checkers = append(o.Checkers, c)
		}
	}
}

// WithReady sets a readiness gate. While Ready returns false, /readyz is "starting".
func WithReady(ready func() bool) Option {
	return func(o *Options) {
		o.Ready = ready
	}
}

// WithCheckTimeout overrides the per-check timeout.
func WithCheckTimeout(d time.Duration) Option {
	return func(o *Options) {
		o.CheckTimeout = d
	}
}

// Register mounts GET /livez and GET /readyz on mux.
func Register(mux *http.ServeMux, opts ...Option) {
	o := Options{}
	for _, opt := range opts {
		opt(&o)
	}
	if o.CheckTimeout <= 0 {
		o.CheckTimeout = defaultCheckTimeout
	}

	mux.HandleFunc("GET /livez", handleLivez)
	mux.HandleFunc("GET /readyz", handleReadyz(o))
}

func handleLivez(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

type checkResult struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

type readyResponse struct {
	Status string                 `json:"status"`
	Checks map[string]checkResult `json:"checks"`
}

func handleReadyz(o Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")

		if o.Ready != nil && !o.Ready() {
			writeJSON(w, http.StatusServiceUnavailable, readyResponse{
				Status: StatusStarting,
				Checks: runChecks(r.Context(), o),
			})
			return
		}

		checks := runChecks(r.Context(), o)
		status := StatusOK
		code := http.StatusOK
		for _, c := range checks {
			if c.Status != StatusOK {
				status = StatusUnavailable
				code = http.StatusServiceUnavailable
				break
			}
		}

		writeJSON(w, code, readyResponse{
			Status: status,
			Checks: checks,
		})
	}
}

func runChecks(ctx context.Context, o Options) map[string]checkResult {
	results := make(map[string]checkResult, len(o.Checkers))
	for _, checker := range o.Checkers {
		name := checker.Name()
		if _, exists := results[name]; exists {
			results[name] = checkResult{Status: StatusError, Error: ErrorDuplicateChecker}
			continue
		}
		checkCtx, cancel := context.WithTimeout(ctx, o.CheckTimeout)
		err := checker.Check(checkCtx)
		cancel()
		if err != nil {
			slog.Warn("readiness check failed", "check", name, "error", err)
			results[name] = checkResult{Status: StatusError, Error: publicCheckError(err)}
			continue
		}
		results[name] = checkResult{Status: StatusOK}
	}
	return results
}

// publicCheckError maps internal errors to stable public categories.
// Never expose raw dependency messages (DB DSNs, hostnames, etc.).
func publicCheckError(err error) string {
	if err == nil {
		return ErrorDependencyFailed
	}
	if errors.Is(err, errNotConfigured) {
		return ErrorNotConfigured
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return ErrorTimeout
	}
	return ErrorDependencyFailed
}

func writeJSON(w http.ResponseWriter, code int, body readyResponse) {
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}
