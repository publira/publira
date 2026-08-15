package rpcmiddleware

import (
	"context"
	"database/sql"

	dbmodels "github.com/publira/publira/server/internal/db"
)

type tenantQueriesContextKey struct{}

type tenantConnContextKey struct{}

// WithTenantQueries stores a tenant-scoped querier in context.
func WithTenantQueries(ctx context.Context, queries dbmodels.Querier) context.Context {
	return context.WithValue(ctx, tenantQueriesContextKey{}, queries)
}

// TenantQueriesFromContext retrieves a tenant-scoped querier from context.
func TenantQueriesFromContext(ctx context.Context) (dbmodels.Querier, bool) {
	queries, ok := ctx.Value(tenantQueriesContextKey{}).(dbmodels.Querier)
	return queries, ok
}

// WithTenantConn stores the request's tenant-scoped *sql.Conn. Handlers that
// need a transaction must begin it on this connection: db.BeginTx would
// borrow a different pool connection that has never set app.current_tenant_id.
func WithTenantConn(ctx context.Context, conn *sql.Conn) context.Context {
	return context.WithValue(ctx, tenantConnContextKey{}, conn)
}

// TenantConnFromContext retrieves the request's tenant-scoped *sql.Conn.
func TenantConnFromContext(ctx context.Context) (*sql.Conn, bool) {
	conn, ok := ctx.Value(tenantConnContextKey{}).(*sql.Conn)
	return conn, ok
}
