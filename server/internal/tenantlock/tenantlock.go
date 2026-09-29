// Package tenantlock guards a job's rewrite of one tenant's rows with a
// transaction-scoped advisory lock that gives up instead of waiting forever.
//
// Every job that replaces a tenant's rows takes the same kind of lock, and
// they share one bound: the value lives here rather than in each job, so two
// jobs cannot drift onto different numbers.
package tenantlock

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Timeout bounds how long one tenant waits for the advisory lock. A manual
// publiractl run has no deadline of its own, so without this an overlapping run
// would block forever with a transaction open instead of exiting.
const Timeout = 30 * time.Second

// Take takes the advisory lock named by key for the rest of tx, waiting
// at most Timeout for whoever holds it. The lock is transaction scoped, so the
// commit or rollback that ends tx releases it.
//
// key names what the lock protects rather than only which tenant: two jobs
// that rebuild different tables for the same tenant pass different keys and so
// never wait for each other.
func Take(ctx context.Context, tx *sql.Tx, key string) error {
	// Local to this transaction, so the setting leaves with it instead of
	// riding a pooled connection into whatever runs next on it.
	if _, err := tx.ExecContext(ctx, "SELECT set_config('lock_timeout', $1, true)", Timeout.String()); err != nil {
		return fmt.Errorf("set lock timeout: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))
	`, key); err != nil {
		return fmt.Errorf("lock tenant (waited up to %s): %w", Timeout, err)
	}
	return nil
}
