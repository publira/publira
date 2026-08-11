package imageserver

import (
	"context"
	"database/sql"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db"
)

type DBTenantScopedFactory struct {
	db *sql.DB
}

func NewDBTenantScopedFactory(db *sql.DB) *DBTenantScopedFactory {
	return &DBTenantScopedFactory{db: db}
}

func (f *DBTenantScopedFactory) ForTenant(ctx context.Context, tenantID uuid.UUID) (TenantScopedQuerier, func(), error) {
	conn, err := f.db.Conn(ctx)
	if err != nil {
		return nil, func() {}, err
	}

	if _, err := conn.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, false)", tenantID.String()); err != nil {
		_ = conn.Close()
		return nil, func() {}, err
	}

	cleanup := func() {
		_, _ = conn.ExecContext(context.Background(), "SELECT set_config('app.current_tenant_id', '', false)")
		_ = conn.Close()
	}

	return dbmodels.New(conn), cleanup, nil
}

var _ TenantScopedQuerierFactory = (*DBTenantScopedFactory)(nil)
var _ TenantScopedQuerier = (*dbmodels.Queries)(nil)
