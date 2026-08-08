package health_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"

	"github.com/publira/publira/server/internal/health"
)

func TestLivezAlwaysOK(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(nil))

	req := httptest.NewRequest(http.MethodGet, "/livez", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); body != "ok" {
		t.Fatalf("body = %q, want %q", body, "ok")
	}
	if got := rec.Header().Get("Content-Type"); got != "text/plain; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
}

func TestLivezMethodNotAllowed(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	health.Register(mux)

	req := httptest.NewRequest(http.MethodPost, "/livez", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestReadyzDBOK(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectPing()

	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(db))

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v", err)
	}
	if body["status"] != health.StatusOK {
		t.Fatalf("status field = %v, want %q", body["status"], health.StatusOK)
	}
	checks, _ := body["checks"].(map[string]any)
	dbCheck, _ := checks["db"].(map[string]any)
	if dbCheck["status"] != health.StatusOK {
		t.Fatalf("db status = %v", dbCheck["status"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
}

func TestReadyzDBFailure(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectPing().WillReturnError(errors.New("connection refused"))

	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(db))

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
	var body struct {
		Status string `json:"status"`
		Checks map[string]struct {
			Status string `json:"status"`
			Error  string `json:"error"`
		} `json:"checks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v", err)
	}
	if body.Status != health.StatusUnavailable {
		t.Fatalf("status = %q, want %q", body.Status, health.StatusUnavailable)
	}
	if body.Checks["db"].Status != health.StatusError {
		t.Fatalf("db status = %q", body.Checks["db"].Status)
	}
	if body.Checks["db"].Error != health.ErrorDependencyFailed {
		t.Fatalf("db error = %q, want %q", body.Checks["db"].Error, health.ErrorDependencyFailed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
}

func TestReadyzNilDB(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(nil))

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	raw, _ := io.ReadAll(rec.Body)
	var body struct {
		Status string `json:"status"`
		Checks map[string]struct {
			Status string `json:"status"`
			Error  string `json:"error"`
		} `json:"checks"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("json: %v body=%s", err, raw)
	}
	if body.Status != health.StatusUnavailable {
		t.Fatalf("status = %q", body.Status)
	}
	if body.Checks["db"].Error != health.ErrorNotConfigured {
		t.Fatalf("db error = %q", body.Checks["db"].Error)
	}
}

func TestReadyzStarting(t *testing.T) {
	t.Parallel()

	var ready atomic.Bool
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectPing()

	mux := http.NewServeMux()
	health.Register(mux, health.WithDB(db), health.WithReady(ready.Load))

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v", err)
	}
	if body["status"] != health.StatusStarting {
		t.Fatalf("status = %v, want %q", body["status"], health.StatusStarting)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sqlmock: %v", err)
	}

	ready.Store(true)
	mock.ExpectPing()
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req)
	if rec2.Code != http.StatusOK {
		t.Fatalf("after ready: status = %d body=%s", rec2.Code, rec2.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
}

func TestReadyzCustomChecker(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	health.Register(mux, health.WithChecker(staticChecker{name: "storage", err: errors.New("bucket missing")}))

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Checks map[string]struct {
			Error string `json:"error"`
		} `json:"checks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v", err)
	}
	if body.Checks["storage"].Error != health.ErrorDependencyFailed {
		t.Fatalf("storage error = %q, want %q", body.Checks["storage"].Error, health.ErrorDependencyFailed)
	}
}

func TestReadyzDuplicateCheckerName(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	health.Register(
		mux,
		health.WithChecker(staticChecker{name: "db", err: errors.New("first failed")}),
		health.WithChecker(staticChecker{name: "db", err: nil}),
	)

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d body=%s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
	var body struct {
		Status string `json:"status"`
		Checks map[string]struct {
			Status string `json:"status"`
			Error  string `json:"error"`
		} `json:"checks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v", err)
	}
	if body.Status != health.StatusUnavailable {
		t.Fatalf("status = %q", body.Status)
	}
	if body.Checks["db"].Status != health.StatusError {
		t.Fatalf("db status = %q", body.Checks["db"].Status)
	}
	if body.Checks["db"].Error != health.ErrorDuplicateChecker {
		t.Fatalf("db error = %q, want %q", body.Checks["db"].Error, health.ErrorDuplicateChecker)
	}
}

type staticChecker struct {
	name string
	err  error
}

func (c staticChecker) Name() string { return c.name }

func (c staticChecker) Check(context.Context) error { return c.err }

// Ensure *sql.DB remains usable with sqlmock MonitorPings (compile-time sanity).
var _ interface {
	PingContext(context.Context) error
} = (*sql.DB)(nil)
