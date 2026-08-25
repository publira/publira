package outbox

import (
	"context"
	"database/sql"
	"fmt"
	"hash/fnv"

	"github.com/riverqueue/river/riverdriver/riverdatabasesql"
	"github.com/riverqueue/river/rivermigrate"
)

const migrateLockName = "publira:river_migrations"

// Migrate applies River's schema (river_job, river_leader, river_migration)
// to db. It is idempotent. The application baseline does not own these
// tables: River versions them, and the worker is the process that runs
// them. An advisory lock keeps concurrent worker boots from migrating at
// the same time.
func Migrate(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("outbox: migrate: db is nil")
	}

	lockTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("outbox: migrate lock: %w", err)
	}
	defer lockTx.Rollback() //nolint:errcheck

	if _, err := lockTx.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1)", advisoryLockID(migrateLockName)); err != nil {
		return fmt.Errorf("outbox: migrate lock: %w", err)
	}

	migrator, err := rivermigrate.New(riverdatabasesql.New(db), nil)
	if err != nil {
		return fmt.Errorf("outbox: river migrator: %w", err)
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("outbox: river migrate: %w", err)
	}
	if err := lockTx.Commit(); err != nil {
		return fmt.Errorf("outbox: migrate lock commit: %w", err)
	}
	return nil
}

func advisoryLockID(name string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(name))
	return int64(h.Sum64())
}
