package adminapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/dberr"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/retention"
)

// errTenantRetentionConflict is what a save based on a revision the stored row
// has moved past reports.
var errTenantRetentionConflict = errors.New("retention settings have changed since they were read")

func retentionPeriodsToProto(periods retention.Periods) *publirattypesv1.RetentionPeriods {
	return &publirattypesv1.RetentionPeriods{
		WithdrawnCommentDays:      int32(periods.WithdrawnCommentDays),
		ContentEventDays:          int32(periods.ContentEventDays),
		DailyRankingSnapshotDays:  int32(periods.DailyRankingSnapshotDays),
		WeeklyRankingSnapshotDays: int32(periods.WeeklyRankingSnapshotDays),
	}
}

func overrideDaysToProto(days *int) *int32 {
	if days == nil {
		return nil
	}
	return new(int32(*days))
}

func overrideDaysFromProto(days *int32) *int {
	if days == nil {
		return nil
	}
	return new(int(*days))
}

func retentionOverridesToProto(overrides retention.Overrides) *publiraadminv1.TenantRetentionOverrides {
	return &publiraadminv1.TenantRetentionOverrides{
		WithdrawnCommentDays:      overrideDaysToProto(overrides.WithdrawnCommentDays),
		ContentEventDays:          overrideDaysToProto(overrides.ContentEventDays),
		DailyRankingSnapshotDays:  overrideDaysToProto(overrides.DailyRankingSnapshotDays),
		WeeklyRankingSnapshotDays: overrideDaysToProto(overrides.WeeklyRankingSnapshotDays),
	}
}

func retentionOverridesFromProto(overrides *publiraadminv1.TenantRetentionOverrides) retention.Overrides {
	return retention.Overrides{
		WithdrawnCommentDays:      overrideDaysFromProto(overrides.WithdrawnCommentDays),
		ContentEventDays:          overrideDaysFromProto(overrides.ContentEventDays),
		DailyRankingSnapshotDays:  overrideDaysFromProto(overrides.DailyRankingSnapshotDays),
		WeeklyRankingSnapshotDays: overrideDaysFromProto(overrides.WeeklyRankingSnapshotDays),
	}
}

func (s *adminServer) GetTenantRetentionSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantRetentionSettingsRequest],
) (*connect.Response[publiraadminv1.GetTenantRetentionSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	settings, err := retention.ReadTenant(ctx, s.queriesFor(ctx), tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read retention settings", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetTenantRetentionSettingsResponse{
		Overrides:        retentionOverridesToProto(settings.Overrides),
		PlatformDefaults: retentionPeriodsToProto(settings.Defaults),
		Effective:        retentionPeriodsToProto(settings.Effective()),
		Revision:         settings.Revision,
	}), nil
}

// writeTenantRetention locks the tenant's row, compares its revision with the
// one the request states, and writes only when they match. The audit entry
// commits with the write, so a change to how long the tenant's data is kept
// never goes unrecorded. The platform defaults the response reports are read
// in the same transaction, so a failed read cannot report a committed save as
// an error.
func (s *adminServer) writeTenantRetention(
	ctx context.Context,
	tenant dbmodels.Tenant,
	overrides retention.Overrides,
	expectedRevision int64,
	audit auditlog.TenantEntry,
) (retention.Settings, error) {
	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return retention.Settings{}, s.internalDBError(ctx, "failed to begin update retention settings transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	txq := dbmodels.New(tx)
	var updated dbmodels.TenantRetentionSetting
	current, err := txq.LockTenantRetentionSettings(ctx, tenant.ID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Any revision but zero was read from a row that has since been
		// deleted, and creating one would resurrect values nobody confirmed.
		if expectedRevision != 0 {
			return retention.Settings{}, connect.NewError(connect.CodeFailedPrecondition, errTenantRetentionConflict)
		}
		updated, err = txq.InsertTenantRetentionSettings(ctx, overrides.TenantSettingsInsertParams(tenant.ID))
		if err != nil {
			// Two first saves both find nothing to lock; the primary key
			// settles which one wins.
			if dberr.IsUniqueViolation(err) {
				return retention.Settings{}, connect.NewError(connect.CodeFailedPrecondition, errTenantRetentionConflict)
			}
			return retention.Settings{}, s.internalDBError(ctx, "failed to create retention settings", err, "tenant_id", tenant.ID.String())
		}
	case err != nil:
		return retention.Settings{}, s.internalDBError(ctx, "failed to lock retention settings", err, "tenant_id", tenant.ID.String())
	default:
		if expectedRevision != current.Revision {
			return retention.Settings{}, connect.NewError(connect.CodeFailedPrecondition, errTenantRetentionConflict)
		}
		updated, err = txq.UpdateTenantRetentionSettings(ctx, overrides.TenantSettingsParams(tenant.ID))
		if err != nil {
			return retention.Settings{}, s.internalDBError(ctx, "failed to update retention settings", err, "tenant_id", tenant.ID.String())
		}
	}

	defaults, _, err := retention.ReadDefaults(ctx, txq)
	if err != nil {
		return retention.Settings{}, s.internalDBError(ctx, "failed to read retention defaults", err, "tenant_id", tenant.ID.String())
	}
	if err := auditlog.WriteTenant(ctx, txq, s.logger, audit); err != nil {
		return retention.Settings{}, s.internalDBError(ctx, "failed to audit retention settings", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return retention.Settings{}, s.internalDBError(ctx, "failed to commit retention settings", err, "tenant_id", tenant.ID.String())
	}
	return retention.Settings{
		Overrides: retention.FromTenantSettings(updated),
		Defaults:  defaults,
		Revision:  updated.Revision,
	}, nil
}

func (s *adminServer) UpdateTenantRetentionSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantRetentionSettingsRequest],
) (*connect.Response[publiraadminv1.UpdateTenantRetentionSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	// Every override is written, so a missing message would clear all of them
	// rather than change nothing.
	if req.Msg.GetOverrides() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("overrides is required"))
	}
	overrides := retentionOverridesFromProto(req.Msg.GetOverrides())
	if err := overrides.Validate(); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if req.Msg.ExpectedRevision < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("expected_revision must not be negative"))
	}

	settings, err := s.writeTenantRetention(ctx, tenant, overrides, req.Msg.ExpectedRevision, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "tenant_retention_updated",
		TargetType:  "tenant_retention",
		TargetID:    tenant.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.UpdateTenantRetentionSettingsResponse{
		Overrides:        retentionOverridesToProto(settings.Overrides),
		PlatformDefaults: retentionPeriodsToProto(settings.Defaults),
		Effective:        retentionPeriodsToProto(settings.Effective()),
		Revision:         settings.Revision,
	}), nil
}
