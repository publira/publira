package adminapi

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

// writeTenantSettingAudit records a tenant admin's save of one tenant setting
// on the querier txCtx carries, so the setting and its entry commit together.
//
// The handlers call it only once they know the save changes something: a save
// that leaves every value as it was is not a change anyone needs to answer for,
// and an entry for it would bury the ones that are.
func (s *adminServer) writeTenantSettingAudit(
	txCtx context.Context,
	tenant dbmodels.Tenant,
	session rpcmiddleware.SessionContext,
	action string,
	targetType string,
) error {
	if err := auditlog.WriteTenant(txCtx, s.queriesFor(txCtx), s.logger, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: session.User.ID,
		ActorRole:   session.Role,
		Action:      action,
		TargetType:  targetType,
		TargetID:    tenant.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    clientip.FromContext(txCtx),
	}); err != nil {
		return s.internalDBError(txCtx, "failed to record the audit entry of a tenant setting change", err, "tenant_id", tenant.ID.String(), "action", action)
	}
	return nil
}

// tenantConfigColumnDefaults is the config row a tenant without one is treated
// as having: the row an INSERT naming only the tenant would produce. A save is
// compared against it to tell whether it changes anything, so it has to say
// what the console showed before the save, which is what those column defaults
// say too. TestDBTenantConfigColumnDefaults holds the two together.
func tenantConfigColumnDefaults(tenantID uuid.UUID) dbmodels.TenantConfig {
	return dbmodels.TenantConfig{
		TenantID:                       tenantID,
		CommentMode:                    "disabled",
		CommentAutoHideReportThreshold: int32(defaultCommentAutoHideReportThreshold),
		EpisodeRatingMode:              "single",
		AgeVerification:                "none",
		PurchaseAvailability:           "all",
		AppPurchaseRoute:               "external_checkout",
		AndroidSha256CertFingerprints:  []string{},
		ReaderIconPolicy:               "upload",
	}
}

// lockTenantConfig locks the tenant's config row in the transaction txCtx
// carries and answers it, or tenantConfigColumnDefaults when the tenant has no
// row yet.
//
// The lock is what lets a save compare against the row and skip writing it:
// without it, a concurrent save could change the row between the comparison
// and the commit, and a save skipped as unchanged would answer a value the row
// no longer holds. A tenant with no row has nothing to lock, and its first save
// inserts the row, which the upsert does safely on its own.
func (s *adminServer) lockTenantConfig(txCtx context.Context, tenantID uuid.UUID) (dbmodels.TenantConfig, error) {
	row, err := s.queriesFor(txCtx).LockTenantConfigByTenantID(txCtx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return tenantConfigColumnDefaults(tenantID), nil
	}
	if err != nil {
		return dbmodels.TenantConfig{}, s.internalDBError(txCtx, "failed to lock tenant config", err, "tenant_id", tenantID.String())
	}
	return row, nil
}
