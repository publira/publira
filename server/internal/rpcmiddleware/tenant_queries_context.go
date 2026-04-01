package rpcmiddleware

import (
	"context"

	dbmodels "github.com/publira/publira/server/internal/db"
)

type tenantQueriesContextKey struct{}

// WithTenantQueries stores a tenant-scoped querier in context.
func WithTenantQueries(ctx context.Context, queries dbmodels.Querier) context.Context {
	return context.WithValue(ctx, tenantQueriesContextKey{}, queries)
}

// TenantQueriesFromContext retrieves a tenant-scoped querier from context.
func TenantQueriesFromContext(ctx context.Context) (dbmodels.Querier, bool) {
	queries, ok := ctx.Value(tenantQueriesContextKey{}).(dbmodels.Querier)
	return queries, ok
}
