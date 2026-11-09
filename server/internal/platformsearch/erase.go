package platformsearch

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/catalogindex"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// TenantEraser deletes a tenant's documents from the search engines a catalog
// write goes to: the one the search answers from, and the one a build is
// filling. The SQL engine keeps no index, so on it there is nothing to delete.
type TenantEraser struct {
	// DB is the maintenance role's pool. An erasure holds one connection of
	// it, which takes both locks and reads the saved engine.
	DB *sql.DB
	// Secrets decrypts a saved password, as [ResolverConfig] does.
	Secrets Decrypter
	Logger  *slog.Logger
}

// EraseTenant deletes every document of the tenant tenantID names. It answers
// [ErrBuildRunning] while a build runs, and deletes nothing then: a build
// fills indices no alias names yet from tenants it listed when it started,
// so a tenant it copied before its rows were deleted would come back into the
// search with the swap. Holding the lock through the delete keeps a build from
// starting until it is done, and one that starts after reads none of the
// tenant's rows.
//
// The tenant's write lock is held through the delete as well, which first
// waits for every write of its documents in flight, an outbox event that read
// a row before it was deleted among them, to reach the engine.
func (e TenantEraser) EraseTenant(ctx context.Context, tenantID uuid.UUID) error {
	if e.DB == nil {
		return errors.New("platformsearch: the tenant eraser has no database to take the build lock on")
	}
	conn, err := e.DB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("platformsearch: connect to erase the tenant's documents: %w", err)
	}
	defer conn.Close() //nolint:errcheck
	unlock, err := lockBuildOn(ctx, conn)
	if err != nil {
		return err
	}
	defer unlock()
	unlockWrites, err := catalogindex.LockTenantWrites(ctx, conn, tenantID)
	if err != nil {
		return err
	}
	defer unlockWrites()

	// A resolver of its own, reading the row afresh, so an engine saved since
	// the last pass is the one the documents are deleted from.
	targets, err := NewResolver(ResolverConfig{Queries: dbmodels.New(conn), Secrets: e.Secrets, Interval: -1, Logger: e.Logger}).Targets(ctx)
	if err != nil {
		return err
	}
	if targets.Serving != nil {
		if err := targets.Serving.DeleteTenant(ctx, tenantID); err != nil {
			return err
		}
	}
	if targets.Building != nil {
		if err := targets.Building.DeleteTenant(ctx, tenantID); err != nil {
			return err
		}
	}
	return nil
}
