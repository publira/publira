package adminapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// The column defaults of series_wait_free_settings, which is what a series
// with no row answers. They are repeated here only to answer that read; every
// write states all four.
const (
	defaultWaitFreeRechargeHours int32 = 23
	defaultWaitFreeAccessHours   int32 = 72
	// maxWaitFreeHours is the year the table's checks bound both periods to.
	maxWaitFreeHours int32 = 8760
)

func defaultSeriesWaitFreeSettings() *publiraadminv1.SeriesWaitFreeSettings {
	return &publiraadminv1.SeriesWaitFreeSettings{
		RechargeHours: defaultWaitFreeRechargeHours,
		AccessHours:   defaultWaitFreeAccessHours,
	}
}

// validateSeriesWaitFreeSettings answers what the table's checks would refuse
// as invalid_argument on the field, before the write reaches them.
func validateSeriesWaitFreeSettings(settings *publiraadminv1.SeriesWaitFreeSettings) error {
	if settings == nil {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("settings is required"), "settings")
	}
	if settings.RechargeHours < 1 || settings.RechargeHours > maxWaitFreeHours {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("recharge_hours must be between 1 and 8760"), "settings.recharge_hours")
	}
	if settings.AccessHours < 1 || settings.AccessHours > maxWaitFreeHours {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("access_hours must be between 1 and 8760"), "settings.access_hours")
	}
	if settings.ExcludedLatestCount < 0 {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("excluded_latest_count must not be negative"), "settings.excluded_latest_count")
	}
	return nil
}

// waitFreeSeries resolves the series a settings request names, as not_found
// on the field when the tenant has no such series.
func (s *adminServer) waitFreeSeries(ctx context.Context, tenantID uuid.UUID, raw string) (dbmodels.GetSeriesByIDForTenantRow, error) {
	seriesID, err := parseRecordID(raw, "series_id")
	if err != nil {
		return dbmodels.GetSeriesByIDForTenantRow{}, err
	}
	series, err := s.queriesFor(ctx).GetSeriesByIDForTenant(ctx, dbmodels.GetSeriesByIDForTenantParams{TenantID: tenantID, ID: seriesID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbmodels.GetSeriesByIDForTenantRow{}, rpcerrors.NewFieldViolationError(connect.CodeNotFound, errors.New("series not found"), "series_id")
		}
		return dbmodels.GetSeriesByIDForTenantRow{}, s.internalDBError(ctx, "failed to get series for wait-free settings", err, "tenant_id", tenantID.String(), "series_id", seriesID.String())
	}
	return series, nil
}

func (s *adminServer) GetSeriesWaitFreeSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetSeriesWaitFreeSettingsRequest],
) (*connect.Response[publiraadminv1.GetSeriesWaitFreeSettingsResponse], error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	series, err := s.waitFreeSeries(ctx, tenant.ID, req.Msg.SeriesId)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetSeriesWaitFreeSettings(ctx, dbmodels.GetSeriesWaitFreeSettingsParams{
		TenantID: tenant.ID,
		SeriesID: series.ID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return connect.NewResponse(&publiraadminv1.GetSeriesWaitFreeSettingsResponse{Settings: defaultSeriesWaitFreeSettings()}), nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get series wait-free settings", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetSeriesWaitFreeSettingsResponse{
		Settings: &publiraadminv1.SeriesWaitFreeSettings{
			Enabled:             row.Enabled,
			RechargeHours:       row.RechargeHours,
			AccessHours:         row.AccessHours,
			ExcludedLatestCount: row.ExcludedLatestCount,
		},
	}), nil
}

func (s *adminServer) UpdateSeriesWaitFreeSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateSeriesWaitFreeSettingsRequest],
) (*connect.Response[publiraadminv1.UpdateSeriesWaitFreeSettingsResponse], error) {
	sessionCtx, err := s.requireTenantEditor(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if err := validateSeriesWaitFreeSettings(req.Msg.Settings); err != nil {
		return nil, err
	}
	series, err := s.waitFreeSeries(ctx, tenant.ID, req.Msg.SeriesId)
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update series wait-free settings transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	saved, err := q.UpsertSeriesWaitFreeSettings(ctx, dbmodels.UpsertSeriesWaitFreeSettingsParams{
		TenantID:            tenant.ID,
		SeriesID:            series.ID,
		Enabled:             req.Msg.Settings.Enabled,
		RechargeHours:       req.Msg.Settings.RechargeHours,
		AccessHours:         req.Msg.Settings.AccessHours,
		ExcludedLatestCount: req.Msg.Settings.ExcludedLatestCount,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to save series wait-free settings", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	// GetSeriesDetail carries the rule, so the series pages cached with the old
	// one are dropped with the write that changed it.
	owed, err := s.reval.Record(ctx, q, tenant.ID, seriesRevalidateTags(tenant.ID.String(), series.PublicID))
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to record the cache invalidation for series wait-free settings", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit series wait-free settings", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "series_wait_free_settings_updated",
		TargetType:  "series",
		TargetID:    series.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
	})

	return connect.NewResponse(&publiraadminv1.UpdateSeriesWaitFreeSettingsResponse{
		Settings: &publiraadminv1.SeriesWaitFreeSettings{
			Enabled:             saved.Enabled,
			RechargeHours:       saved.RechargeHours,
			AccessHours:         saved.AccessHours,
			ExcludedLatestCount: saved.ExcludedLatestCount,
		},
	}), nil
}
