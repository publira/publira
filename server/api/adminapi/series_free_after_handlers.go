package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/catalogindex"
	"github.com/publira/publira/server/internal/clientip"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/freeafter"
	"github.com/publira/publira/server/internal/freewindows"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/revalidate"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// The column defaults of series_free_after_settings, which is what a series
// with no row answers. They are repeated here only to answer that read; every
// write states all three.
const (
	defaultFreeAfterDays int32 = 30
	// maxFreeAfterDays is the ten years the table's check bounds the wait to.
	maxFreeAfterDays int32 = 3650
)

// validateSeriesFreeAfterSettings answers what the table's checks would refuse
// as invalid_argument on the field, before the write reaches them.
func validateSeriesFreeAfterSettings(settings *publiraadminv1.SeriesFreeAfterSettings) error {
	if settings == nil {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("settings is required"), "settings")
	}
	if settings.DaysAfterPublication < 1 || settings.DaysAfterPublication > maxFreeAfterDays {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("days_after_publication must be between 1 and 3650"), "settings.days_after_publication")
	}
	if settings.ExcludedLatestCount < 0 {
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("excluded_latest_count must not be negative"), "settings.excluded_latest_count")
	}
	return nil
}

func (s *adminServer) GetSeriesFreeAfterSettings(
	ctx context.Context,
	req *publiraadminv1.GetSeriesFreeAfterSettingsRequest,
) (*publiraadminv1.GetSeriesFreeAfterSettingsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	series, err := s.waitFreeSeries(ctx, tenant.ID, req.SeriesId)
	if err != nil {
		return nil, err
	}
	row, err := s.queriesFor(ctx).GetSeriesFreeAfterSettings(ctx, dbmodels.GetSeriesFreeAfterSettingsParams{
		TenantID: tenant.ID,
		SeriesID: series.ID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return &publiraadminv1.GetSeriesFreeAfterSettingsResponse{
			Settings: &publiraadminv1.SeriesFreeAfterSettings{DaysAfterPublication: defaultFreeAfterDays},
		}, nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get series free-after settings", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	return &publiraadminv1.GetSeriesFreeAfterSettingsResponse{
		Settings: &publiraadminv1.SeriesFreeAfterSettings{
			Enabled:              row.Enabled,
			DaysAfterPublication: row.DaysAfterPublication,
			ExcludedLatestCount:  row.ExcludedLatestCount,
		},
	}, nil
}

func (s *adminServer) UpdateSeriesFreeAfterSettings(
	ctx context.Context,
	req *publiraadminv1.UpdateSeriesFreeAfterSettingsRequest,
) (*publiraadminv1.UpdateSeriesFreeAfterSettingsResponse, error) {
	sessionCtx, err := s.requireTenantEditor(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if err := validateSeriesFreeAfterSettings(req.Settings); err != nil {
		return nil, err
	}
	seriesID, err := parseRecordID(req.SeriesId, "series_id")
	if err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin update series free-after settings transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	q := dbmodels.New(tx)
	// The lock is the one the worker's pass holds while it writes the rule's
	// windows, so a pass never writes a window the rule saved here no longer
	// covers.
	series, err := q.LockSeriesByIDForTenant(ctx, dbmodels.LockSeriesByIDForTenantParams{
		TenantID: tenant.ID,
		ID:       seriesID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, rpcerrors.NewFieldViolationError(connect.CodeNotFound, errors.New("series not found"), "series_id")
		}
		return nil, s.internalDBError(ctx, "failed to lock series for free-after settings", err, "tenant_id", tenant.ID.String(), "series_id", seriesID.String())
	}
	saved, err := q.UpsertSeriesFreeAfterSettings(ctx, dbmodels.UpsertSeriesFreeAfterSettingsParams{
		TenantID:             tenant.ID,
		SeriesID:             series.ID,
		Enabled:              req.Settings.Enabled,
		DaysAfterPublication: req.Settings.DaysAfterPublication,
		ExcludedLatestCount:  req.Settings.ExcludedLatestCount,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to save series free-after settings", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}

	// Empty rather than nil when the rule is off: the query reads a NULL array
	// as keeping every window.
	kept := []uuid.UUID{}
	if saved.Enabled {
		covered, err := q.ListSeriesFreeAfterEpisodes(ctx, dbmodels.ListSeriesFreeAfterEpisodesParams{
			TenantID:             tenant.ID,
			SeriesID:             series.ID,
			DaysAfterPublication: saved.DaysAfterPublication,
			ExcludedLatestCount:  saved.ExcludedLatestCount,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list the episodes a free-after rule covers", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
		}
		kept = freeafter.KeptEpisodeIDs(covered)
	}
	removed, err := q.DeleteSeriesFreeAfterWindowsExcept(ctx, dbmodels.DeleteSeriesFreeAfterWindowsExceptParams{
		TenantID:       tenant.ID,
		SeriesID:       series.ID,
		KeptEpisodeIds: kept,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to remove the windows a free-after rule no longer covers", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}

	// Only a removed window that had started was holding a cached page open,
	// or the series' search document saying a free episode is; one still
	// ahead of its start never reached either.
	now := time.Now()
	var owed revalidate.Owed
	if slices.ContainsFunc(removed, func(window dbmodels.DeleteSeriesFreeAfterWindowsExceptRow) bool {
		return !window.StartsAt.After(now)
	}) {
		if owed, err = s.reval.Record(ctx, q, tenant.ID, freewindows.RevalidateTags(tenant.ID)); err != nil {
			return nil, s.internalDBError(ctx, "failed to record the cache invalidation for removed free-after windows", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
		}
		if err := catalogindex.Queue(ctx, q, tenant.ID, catalogindex.SeriesRef(series.ID)); err != nil {
			return nil, s.internalDBError(ctx, "failed to queue the search index sync for removed free-after windows", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit series free-after settings", err, "tenant_id", tenant.ID.String(), "series_id", series.ID.String())
	}
	s.reval.Send(ctx, owed)

	s.recorderFor(ctx).RecordTenant(ctx, auditlog.TenantEntry{
		TenantID:    tenant.ID,
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		Action:      "series_free_after_settings_updated",
		TargetType:  "series",
		TargetID:    series.PublicID,
		Outcome:     auditlog.OutcomeSuccess,
		ClientIP:    clientip.FromContext(ctx),
	})

	return &publiraadminv1.UpdateSeriesFreeAfterSettingsResponse{
		Settings: &publiraadminv1.SeriesFreeAfterSettings{
			Enabled:              saved.Enabled,
			DaysAfterPublication: saved.DaysAfterPublication,
			ExcludedLatestCount:  saved.ExcludedLatestCount,
		},
	}, nil
}
