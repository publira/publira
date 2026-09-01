package batchlock

import (
	"context"
	"testing"

	"github.com/publira/publira/server/internal/testutil"
)

// lockKey stands in for the "<tenant>:<batch>" keys the batches compose. What
// it says does not matter here; that two sessions agree on it does.
const lockKey = "batchlock-test:tenant"

// The wait has to be bounded before the lock is taken, and the bound has to
// leave with the transaction: a pooled connection that kept lock_timeout set
// would impose it on every statement that ran next on it.
func TestTakeTenantBoundsTheWaitForOneTransaction(t *testing.T) {
	pg := testutil.StartPostgres(t)
	db := pg.OpenPlatformDB(t)
	ctx := context.Background()

	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("Conn: %v", err)
	}
	defer conn.Close() //nolint:errcheck

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if err := TakeTenant(ctx, tx, lockKey); err != nil {
		t.Fatalf("TakeTenant: %v", err)
	}

	var setting string
	if err := tx.QueryRowContext(ctx, "SHOW lock_timeout").Scan(&setting); err != nil {
		t.Fatalf("SHOW lock_timeout inside the transaction: %v", err)
	}
	if setting != Timeout.String() {
		t.Errorf("lock_timeout inside the transaction = %q, want %q", setting, Timeout.String())
	}

	if err := tx.Rollback(); err != nil {
		t.Fatalf("Rollback: %v", err)
	}

	if err := conn.QueryRowContext(ctx, "SHOW lock_timeout").Scan(&setting); err != nil {
		t.Fatalf("SHOW lock_timeout after the transaction: %v", err)
	}
	if setting != "0" {
		t.Errorf("lock_timeout after the transaction = %q, want the server default %q", setting, "0")
	}
}

// The bound must not come at the cost of the exclusion the lock exists for:
// while one transaction holds the key, nobody else gets it.
func TestTakeTenantHoldsTheKeyUntilTheTransactionEnds(t *testing.T) {
	pg := testutil.StartPostgres(t)
	db := pg.OpenPlatformDB(t)
	ctx := context.Background()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if err := TakeTenant(ctx, tx, lockKey); err != nil {
		t.Fatalf("TakeTenant: %v", err)
	}

	// A try rather than a wait, so a regression is a failed assertion instead
	// of a test that hangs for the whole timeout.
	other, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("Conn: %v", err)
	}
	defer other.Close() //nolint:errcheck

	var acquired bool
	if err := other.QueryRowContext(ctx,
		"SELECT pg_try_advisory_lock(hashtextextended($1::text, 0))", lockKey).Scan(&acquired); err != nil {
		t.Fatalf("pg_try_advisory_lock while held: %v", err)
	}
	if acquired {
		_, _ = other.ExecContext(ctx, "SELECT pg_advisory_unlock(hashtextextended($1::text, 0))", lockKey)
		t.Fatal("a second session took the lock the transaction still holds")
	}

	if err := tx.Rollback(); err != nil {
		t.Fatalf("Rollback: %v", err)
	}

	if err := other.QueryRowContext(ctx,
		"SELECT pg_try_advisory_lock(hashtextextended($1::text, 0))", lockKey).Scan(&acquired); err != nil {
		t.Fatalf("pg_try_advisory_lock after rollback: %v", err)
	}
	if !acquired {
		t.Fatal("the lock outlived the transaction that took it")
	}
	if _, err := other.ExecContext(ctx,
		"SELECT pg_advisory_unlock(hashtextextended($1::text, 0))", lockKey); err != nil {
		t.Fatalf("pg_advisory_unlock: %v", err)
	}
}
