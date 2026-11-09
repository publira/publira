package platformsearch

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"

	"github.com/google/uuid"
)

// TenantEraser deletes a tenant's documents from the search engines a catalog
// write goes to: the one the search answers from, and the one a build is
// filling. The SQL engine keeps no index, so on it there is nothing to delete.
type TenantEraser struct {
	// DB is the maintenance role's pool, which takes the build lock.
	DB      *sql.DB
	Queries Querier
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
func (e TenantEraser) EraseTenant(ctx context.Context, tenantID uuid.UUID) error {
	if e.DB == nil {
		return errors.New("platformsearch: the tenant eraser has no database to take the build lock on")
	}
	unlock, err := lockBuild(ctx, e.DB)
	if err != nil {
		return err
	}
	defer unlock()

	// A resolver of its own, reading the row afresh, so an engine saved since
	// the last pass is the one the documents are deleted from.
	targets, err := NewResolver(ResolverConfig{Queries: e.Queries, Secrets: e.Secrets, Interval: -1, Logger: e.Logger}).Targets(ctx)
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
