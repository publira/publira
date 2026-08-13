// Package tenantconn binds a pooled *sql.Conn to one tenant for the
// duration of a request.
//
// RLS policies read current_setting('app.current_tenant_id'), so the
// GUC is the isolation boundary. A borrowed connection must have the
// value set before any tenant query, and must have it cleared — or the
// connection discarded — before it goes back to database/sql. Pool-level
// queriers never set the GUC; reusing a connection that still carries a
// previous tenant would let those paths see the wrong tenant's rows.
package tenantconn

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	// ClearTimeout is how long cleanup waits for set_config to reset
	// app.current_tenant_id. The request context may already be
	// canceled, so cleanup uses a fresh one; without a deadline a hung
	// reset would never reach Close and the connection would never
	// return to the pool.
	ClearTimeout = 3 * time.Second

	setTenantSQL   = "SELECT set_config('app.current_tenant_id', $1, false)"
	clearTenantSQL = "SELECT set_config('app.current_tenant_id', '', false)"
)

// Acquire takes a connection from db, sets app.current_tenant_id, and
// returns a cleanup that clears the setting (with [ClearTimeout]) and
// returns the connection to the pool. If clearing fails, cleanup logs
// the error and discards the connection so it cannot be reused with the
// leftover tenant GUC.
func Acquire(ctx context.Context, db *sql.DB, tenantID uuid.UUID, logger *slog.Logger) (*sql.Conn, func(), error) {
	logger = loggerOrDefault(logger)

	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, func() {}, err
	}

	if _, err := conn.ExecContext(ctx, setTenantSQL, tenantID.String()); err != nil {
		if closeErr := conn.Close(); closeErr != nil {
			logger.Error("failed to return connection after tenant set failure", "error", closeErr)
		}
		return nil, func() {}, err
	}

	var once sync.Once
	return conn, func() {
		once.Do(func() { release(conn, logger, ClearTimeout) })
	}, nil
}

// Release clears app.current_tenant_id with [ClearTimeout] and returns
// conn to the pool, or discards it when the reset fails. Prefer the
// cleanup from [Acquire] at call sites that also set the GUC.
func Release(conn *sql.Conn, logger *slog.Logger) {
	release(conn, loggerOrDefault(logger), ClearTimeout)
}

func release(conn *sql.Conn, logger *slog.Logger, timeout time.Duration) {
	if conn == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if _, err := conn.ExecContext(ctx, clearTenantSQL); err != nil {
		logger.Error("failed to clear app.current_tenant_id; discarding connection", "error", err)
		discard(conn, logger)
		return
	}

	if err := conn.Close(); err != nil {
		logger.Error("failed to return tenant-scoped connection to pool", "error", err)
	}
}

// discard marks the underlying driver connection bad so database/sql
// closes it instead of putting it back in the idle pool. There is no
// public "do not reuse" API on *sql.Conn; returning driver.ErrBadConn
// from Raw is the supported signal.
func discard(conn *sql.Conn, logger *slog.Logger) {
	err := conn.Raw(func(any) error { return driver.ErrBadConn })
	if err == nil || errors.Is(err, driver.ErrBadConn) || errors.Is(err, sql.ErrConnDone) {
		return
	}
	logger.Error("failed to discard tenant-scoped connection", "error", err)
}

func loggerOrDefault(logger *slog.Logger) *slog.Logger {
	if logger == nil {
		return slog.Default()
	}
	return logger
}
