package imageserver

import (
	"context"
	"database/sql"
	"log/slog"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantconn"
)

type DBTenantScopedFactory struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewDBTenantScopedFactory(db *sql.DB, logger *slog.Logger) *DBTenantScopedFactory {
	if logger == nil {
		logger = slog.Default()
	}
	return &DBTenantScopedFactory{db: db, logger: logger}
}

func (f *DBTenantScopedFactory) ForTenant(ctx context.Context, tenantID uuid.UUID) (TenantScopedQuerier, func(), error) {
	conn, cleanup, err := tenantconn.Acquire(ctx, f.db, tenantID, f.logger)
	if err != nil {
		return nil, func() {}, err
	}
	return dbmodels.New(conn), cleanup, nil
}

var _ TenantScopedQuerierFactory = (*DBTenantScopedFactory)(nil)
var _ TenantScopedQuerier = (*dbmodels.Queries)(nil)
