package adminapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
)

func normalizeTenantDarkTheme(palette *publirattypesv1.TenantThemePalette) (dbmodels.UpsertTenantDarkThemeParams, error) {
	normalized, err := normalizeThemeColors(palette, "dark_theme")
	if err != nil {
		return dbmodels.UpsertTenantDarkThemeParams{}, err
	}
	return dbmodels.UpsertTenantDarkThemeParams{
		PrimaryColor:               normalized[0],
		SecondaryColor:             normalized[1],
		AccentColor:                normalized[2],
		BackgroundColor:            normalized[3],
		ForegroundColor:            normalized[4],
		SurfaceColor:               normalized[5],
		SurfaceForegroundColor:     normalized[6],
		CardColor:                  normalized[7],
		CardForegroundColor:        normalized[8],
		PopoverColor:               normalized[9],
		PopoverForegroundColor:     normalized[10],
		PrimaryForegroundColor:     normalized[11],
		SecondaryForegroundColor:   normalized[12],
		AccentForegroundColor:      normalized[13],
		MutedColor:                 normalized[14],
		MutedForegroundColor:       normalized[15],
		BorderColor:                normalized[16],
		InputColor:                 normalized[17],
		RingColor:                  normalized[18],
		SuccessColor:               normalized[19],
		SuccessForegroundColor:     normalized[20],
		WarningColor:               normalized[21],
		WarningForegroundColor:     normalized[22],
		DestructiveColor:           normalized[23],
		DestructiveForegroundColor: normalized[24],
		InfoColor:                  normalized[25],
		InfoForegroundColor:        normalized[26],
	}, nil
}

// tenantDarkThemeParamsFromRow is the save that would store the dark palette
// as it is read, so comparing a save against it tells whether the save changes
// anything.
func tenantDarkThemeParamsFromRow(row dbmodels.TenantThemeDark) dbmodels.UpsertTenantDarkThemeParams {
	return dbmodels.UpsertTenantDarkThemeParams{
		TenantID:                   row.TenantID,
		BackgroundColor:            row.BackgroundColor,
		ForegroundColor:            row.ForegroundColor,
		SurfaceColor:               row.SurfaceColor,
		SurfaceForegroundColor:     row.SurfaceForegroundColor,
		CardColor:                  row.CardColor,
		CardForegroundColor:        row.CardForegroundColor,
		PopoverColor:               row.PopoverColor,
		PopoverForegroundColor:     row.PopoverForegroundColor,
		PrimaryColor:               row.PrimaryColor,
		PrimaryForegroundColor:     row.PrimaryForegroundColor,
		SecondaryColor:             row.SecondaryColor,
		SecondaryForegroundColor:   row.SecondaryForegroundColor,
		AccentColor:                row.AccentColor,
		AccentForegroundColor:      row.AccentForegroundColor,
		MutedColor:                 row.MutedColor,
		MutedForegroundColor:       row.MutedForegroundColor,
		BorderColor:                row.BorderColor,
		InputColor:                 row.InputColor,
		RingColor:                  row.RingColor,
		SuccessColor:               row.SuccessColor,
		SuccessForegroundColor:     row.SuccessForegroundColor,
		WarningColor:               row.WarningColor,
		WarningForegroundColor:     row.WarningForegroundColor,
		DestructiveColor:           row.DestructiveColor,
		DestructiveForegroundColor: row.DestructiveForegroundColor,
		InfoColor:                  row.InfoColor,
		InfoForegroundColor:        row.InfoForegroundColor,
	}
}

// tenantDarkTheme reads the tenant's dark palette, or nil for a tenant that has
// saved none.
func (s *adminServer) tenantDarkTheme(ctx context.Context, tenantID uuid.UUID) (*publirattypesv1.TenantThemePalette, error) {
	row, err := s.queriesFor(ctx).GetTenantDarkThemeByTenantID(ctx, tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant dark theme", err, "tenant_id", tenantID.String())
	}
	return protomapper.TenantThemePaletteFromDarkRow(row), nil
}

func (s *adminServer) GetTenantDarkTheme(
	ctx context.Context,
	req *publiraadminv1.GetTenantDarkThemeRequest,
) (*publiraadminv1.GetTenantDarkThemeResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}

	darkTheme, err := s.tenantDarkTheme(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	return &publiraadminv1.GetTenantDarkThemeResponse{DarkTheme: darkTheme}, nil
}

func (s *adminServer) UpsertTenantDarkTheme(
	ctx context.Context,
	req *publiraadminv1.UpsertTenantDarkThemeRequest,
) (*publiraadminv1.UpsertTenantDarkThemeResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if req.DarkTheme == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "dark_theme is required")
	}

	params, err := normalizeTenantDarkTheme(req.DarkTheme)
	if err != nil {
		return nil, err
	}
	params.TenantID = tenant.ID

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		if _, err := s.queriesFor(txCtx).LockTenantForUpdate(txCtx, tenant.ID); err != nil {
			return nil, s.internalDBError(ctx, "failed to lock tenant for dark theme change", err, "tenant_id", tenant.ID.String())
		}
		current, err := s.queriesFor(txCtx).GetTenantDarkThemeByTenantID(txCtx, tenant.ID)
		switch {
		case err == nil:
			if tenantDarkThemeParamsFromRow(current) == params {
				return nil, nil
			}
		case !errors.Is(err, sql.ErrNoRows):
			return nil, s.internalDBError(ctx, "failed to get tenant dark theme", err, "tenant_id", tenant.ID.String())
		}
		if _, err := s.queriesFor(txCtx).UpsertTenantDarkTheme(txCtx, params); err != nil {
			return nil, s.internalDBError(ctx, "failed to upsert tenant dark theme", err, "tenant_id", tenant.ID.String())
		}
		if err := s.writeTenantSettingAudit(txCtx, tenant, session, "tenant_dark_theme_updated", "tenant_branding"); err != nil {
			return nil, err
		}
		return themeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}

	darkTheme, err := s.tenantDarkTheme(ctx, tenant.ID)
	if err != nil {
		return nil, err
	}

	return &publiraadminv1.UpsertTenantDarkThemeResponse{DarkTheme: darkTheme}, nil
}

func (s *adminServer) DeleteTenantDarkTheme(
	ctx context.Context,
	req *publiraadminv1.DeleteTenantDarkThemeRequest,
) (*publiraadminv1.DeleteTenantDarkThemeResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		deleted, err := s.queriesFor(txCtx).DeleteTenantDarkTheme(txCtx, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to delete tenant dark theme", err, "tenant_id", tenant.ID.String())
		}
		if deleted == 0 {
			return nil, nil
		}
		if err := s.writeTenantSettingAudit(txCtx, tenant, session, "tenant_dark_theme_deleted", "tenant_branding"); err != nil {
			return nil, err
		}
		return themeRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}

	return &publiraadminv1.DeleteTenantDarkThemeResponse{}, nil
}
