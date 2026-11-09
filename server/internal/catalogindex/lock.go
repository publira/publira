package catalogindex

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"

	"github.com/google/uuid"
)

// tenantLockKey names the session advisory lock over the writes of one
// tenant's documents. Every write holds it shared from before it reads the rows
// until the engine has the documents, and the erasure holds it exclusively
// while it deletes them: a write that read the tenant's rows before they were
// deleted would otherwise put its documents back once the erasure was done.
func tenantLockKey(tenantID uuid.UUID) string {
	return "catalog_index_tenant:" + tenantID.String()
}

// LockTenantWrites takes the tenant's write lock on conn, which first waits for
// every write of the tenant's documents in flight to reach the engine, and
// keeps another from starting until the returned function releases it. A
// write that starts after finds the tenant marked for deletion and writes
// nothing. The caller keeps conn, and closes it once the lock is released.
func LockTenantWrites(ctx context.Context, conn *sql.Conn, tenantID uuid.UUID) (func(), error) {
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock(hashtextextended($1, 0))", tenantLockKey(tenantID)); err != nil {
		return nil, fmt.Errorf("catalogindex: take the tenant's write lock: %w", err)
	}
	return func() { unlock(ctx, conn, "SELECT pg_advisory_unlock(hashtextextended($1, 0))", tenantID) }, nil
}

// holdTenantWrite takes the tenant's write lock shared on a connection of its
// own, which the write reads the rows on, and holds it until the returned
// function releases it.
func holdTenantWrite(ctx context.Context, db *sql.DB, tenantID uuid.UUID) (*sql.Conn, func(), error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("catalogindex: connect: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock_shared(hashtextextended($1, 0))", tenantLockKey(tenantID)); err != nil {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("catalogindex: take the tenant's write lock: %w", err)
	}
	return conn, func() { release(ctx, conn, "SELECT pg_advisory_unlock_shared(hashtextextended($1, 0))", tenantID) }, nil
}

// release unlocks and returns the connection to the pool.
func release(ctx context.Context, conn *sql.Conn, statement string, tenantID uuid.UUID) {
	unlock(ctx, conn, statement, tenantID)
	_ = conn.Close()
}

// unlock runs the statement that releases the lock. A connection it fails on
// is discarded once it is closed, so the session ends and the lock with it,
// rather than a pooled connection holding it for good.
func unlock(ctx context.Context, conn *sql.Conn, statement string, tenantID uuid.UUID) {
	if _, err := conn.ExecContext(context.WithoutCancel(ctx), statement, tenantLockKey(tenantID)); err != nil {
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
	}
}
