package tenantconn

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAcquireSetsTenantAndReleaseReturnsConnectionToPool(t *testing.T) {
	t.Parallel()

	drv := newFakeDriver(nil)
	db := openFakeDB(t, drv)
	tenantID := uuid.Must(uuid.NewV7())

	_, cleanup, err := Acquire(context.Background(), db, tenantID, discardLogger())
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	first := drv.lastConn()
	if first == nil {
		t.Fatal("driver did not open a connection")
	}
	cleanup()

	if first.closed.Load() {
		t.Fatal("successful clear discarded the driver connection")
	}
	if got := drv.setCalls(); got != 1 {
		t.Fatalf("set_config(tenant) calls = %d, want 1", got)
	}
	if got := drv.clearCalls(); got != 1 {
		t.Fatalf("set_config('') calls = %d, want 1", got)
	}
	if !drv.lastClear().hasDeadline {
		t.Fatal("clear ran without a deadline")
	}

	conn2, err := db.Conn(context.Background())
	if err != nil {
		t.Fatalf("Conn after release: %v", err)
	}
	t.Cleanup(func() { _ = conn2.Close() })

	second := drv.lastConn()
	if second.id != first.id {
		t.Fatalf("pool opened a new connection (id %d), want reuse of %d", second.id, first.id)
	}
	if drv.openCount() != 1 {
		t.Fatalf("driver Open calls = %d, want 1 (reused)", drv.openCount())
	}
}

func TestReleaseDiscardsConnectionWhenClearFails(t *testing.T) {
	t.Parallel()

	drv := newFakeDriver(func(call execCall) error {
		if isClearQuery(call.query) {
			return errors.New("reset refused")
		}
		return nil
	})
	db := openFakeDB(t, drv)
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))

	_, cleanup, err := Acquire(context.Background(), db, uuid.Must(uuid.NewV7()), logger)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	first := drv.lastConn()
	cleanup()

	if !first.closed.Load() {
		t.Fatal("failed clear returned the driver connection to the pool")
	}
	if !bytes.Contains(logs.Bytes(), []byte("failed to clear app.current_tenant_id; discarding connection")) {
		t.Fatalf("clear failure was not logged:\n%s", logs.String())
	}

	conn2, err := db.Conn(context.Background())
	if err != nil {
		t.Fatalf("Conn after discard: %v", err)
	}
	t.Cleanup(func() { _ = conn2.Close() })

	second := drv.lastConn()
	if second.id == first.id {
		t.Fatal("pool reused the connection that failed to clear")
	}
	if drv.openCount() != 2 {
		t.Fatalf("driver Open calls = %d, want 2 (discarded then replaced)", drv.openCount())
	}
}

func TestReleaseDiscardsConnectionWhenClearTimesOut(t *testing.T) {
	t.Parallel()

	started := make(chan struct{})
	drv := newFakeDriver(func(call execCall) error {
		if !isClearQuery(call.query) {
			return nil
		}
		close(started)
		<-call.ctx.Done()
		return call.ctx.Err()
	})
	db := openFakeDB(t, drv)
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))

	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatalf("Conn: %v", err)
	}
	if _, err := conn.ExecContext(context.Background(), setTenantSQL, uuid.Must(uuid.NewV7()).String()); err != nil {
		t.Fatalf("set tenant: %v", err)
	}
	first := drv.lastConn()

	timeout := 40 * time.Millisecond
	done := make(chan struct{})
	go func() {
		defer close(done)
		release(conn, logger, timeout)
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("clear did not start")
	}

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("release did not return after the clear timeout")
	}

	if !first.closed.Load() {
		t.Fatal("timed-out clear returned the driver connection to the pool")
	}
	if !bytes.Contains(logs.Bytes(), []byte("failed to clear app.current_tenant_id; discarding connection")) {
		t.Fatalf("timeout was not logged:\n%s", logs.String())
	}
	if clear := drv.lastClear(); !clear.hasDeadline {
		t.Fatal("timed-out clear ran without a deadline")
	}

	conn2, err := db.Conn(context.Background())
	if err != nil {
		t.Fatalf("Conn after timeout discard: %v", err)
	}
	t.Cleanup(func() { _ = conn2.Close() })
	if drv.lastConn().id == first.id {
		t.Fatal("pool reused the connection that timed out while clearing")
	}
}

func TestAcquireReturnsConnectionToPoolWhenSetFails(t *testing.T) {
	t.Parallel()

	drv := newFakeDriver(func(call execCall) error {
		if isSetQuery(call.query) {
			return errors.New("set refused")
		}
		return nil
	})
	db := openFakeDB(t, drv)

	_, cleanup, err := Acquire(context.Background(), db, uuid.Must(uuid.NewV7()), discardLogger())
	if err == nil {
		cleanup()
		t.Fatal("Acquire succeeded, want set failure")
	}

	first := drv.lastConn()
	if first.closed.Load() {
		t.Fatal("set failure discarded the connection instead of returning it to the pool")
	}
	if drv.clearCalls() != 0 {
		t.Fatalf("clear calls = %d, want 0 after a failed set", drv.clearCalls())
	}

	conn2, err := db.Conn(context.Background())
	if err != nil {
		t.Fatalf("Conn after failed set: %v", err)
	}
	t.Cleanup(func() { _ = conn2.Close() })
	if drv.lastConn().id != first.id {
		t.Fatal("pool did not reuse the connection after a failed set")
	}
}

var driverSeq atomic.Int64

func openFakeDB(t *testing.T, drv *fakeDriver) *sql.DB {
	t.Helper()

	name := fmt.Sprintf("tenantconn_fake_%d", driverSeq.Add(1))
	sql.Register(name, drv)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func isSetQuery(query string) bool {
	return query == setTenantSQL
}

func isClearQuery(query string) bool {
	return query == clearTenantSQL
}

type execCall struct {
	query       string
	ctx         context.Context
	hasDeadline bool
}

type fakeDriver struct {
	mu    sync.Mutex
	next  int
	conns []*fakeConn
	hook  func(execCall) error
}

func newFakeDriver(hook func(execCall) error) *fakeDriver {
	return &fakeDriver{hook: hook}
}

func (d *fakeDriver) Open(string) (driver.Conn, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.next++
	conn := &fakeConn{id: d.next, hook: d.hook}
	d.conns = append(d.conns, conn)
	return conn, nil
}

func (d *fakeDriver) lastConn() *fakeConn {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.conns) == 0 {
		return nil
	}
	return d.conns[len(d.conns)-1]
}

func (d *fakeDriver) openCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.next
}

func (d *fakeDriver) setCalls() int {
	return d.countQueries(isSetQuery)
}

func (d *fakeDriver) clearCalls() int {
	return d.countQueries(isClearQuery)
}

func (d *fakeDriver) lastClear() execCall {
	d.mu.Lock()
	defer d.mu.Unlock()
	for i := len(d.conns) - 1; i >= 0; i-- {
		calls := d.conns[i].snapshot()
		for j := len(calls) - 1; j >= 0; j-- {
			if isClearQuery(calls[j].query) {
				return calls[j]
			}
		}
	}
	return execCall{}
}

func (d *fakeDriver) countQueries(match func(string) bool) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	n := 0
	for _, conn := range d.conns {
		for _, call := range conn.snapshot() {
			if match(call.query) {
				n++
			}
		}
	}
	return n
}

type fakeConn struct {
	id     int
	hook   func(execCall) error
	closed atomic.Bool

	mu    sync.Mutex
	calls []execCall
}

func (c *fakeConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("Prepare is not used")
}

func (c *fakeConn) Begin() (driver.Tx, error) {
	return nil, errors.New("Begin is not used")
}

func (c *fakeConn) Close() error {
	c.closed.Store(true)
	return nil
}

func (c *fakeConn) ExecContext(ctx context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	if c.closed.Load() {
		return nil, driver.ErrBadConn
	}
	call := execCall{query: query, ctx: ctx}
	if deadline, ok := ctx.Deadline(); ok {
		call.hasDeadline = true
		_ = deadline
	}
	c.mu.Lock()
	c.calls = append(c.calls, call)
	c.mu.Unlock()
	if c.hook != nil {
		if err := c.hook(call); err != nil {
			return nil, err
		}
	}
	return driver.RowsAffected(0), nil
}

func (c *fakeConn) snapshot() []execCall {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]execCall, len(c.calls))
	copy(out, c.calls)
	return out
}
