package platformsearch

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
)

// TenantEraser deletes a tenant's documents from the search engines a catalog
// write goes to: the one the search answers from, and the one a build is
// filling. The SQL engine keeps no index, so on it there is nothing to delete.
type TenantEraser struct {
	Queries Querier
	// Secrets decrypts a saved password, as [ResolverConfig] does.
	Secrets Decrypter
	Logger  *slog.Logger
}

// EraseTenant deletes every document of the tenant tenantID names.
func (e TenantEraser) EraseTenant(ctx context.Context, tenantID uuid.UUID) error {
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
