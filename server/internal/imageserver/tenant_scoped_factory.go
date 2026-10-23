package imageserver

import (
	"context"
	"database/sql"
	"log/slog"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/readreplica"
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

// ReplicaTenantScopedFactory opens the tenant-scoped queries on the read
// replica of its pools when the replica has replayed everything the primary had
// committed when the route asked, and on the primary otherwise, so an image
// read there is never one the primary has already replaced or withdrawn.
type ReplicaTenantScopedFactory struct {
	pools readreplica.Pools
}

// NewReplicaTenantScopedFactory answers on pools.Primary alone when
// pools.Replica is nil.
func NewReplicaTenantScopedFactory(pools readreplica.Pools) *ReplicaTenantScopedFactory {
	return &ReplicaTenantScopedFactory{pools: pools}
}

func (f *ReplicaTenantScopedFactory) ForTenant(ctx context.Context, tenantID uuid.UUID) (TenantScopedQuerier, func(), error) {
	conn, cleanup, _, err := f.pools.Acquire(ctx, tenantID)
	if err != nil {
		return nil, func() {}, err
	}
	return dbmodels.New(conn), cleanup, nil
}

var _ TenantScopedQuerierFactory = (*DBTenantScopedFactory)(nil)
var _ TenantScopedQuerierFactory = (*ReplicaTenantScopedFactory)(nil)
var _ TenantScopedQuerier = (*dbmodels.Queries)(nil)
