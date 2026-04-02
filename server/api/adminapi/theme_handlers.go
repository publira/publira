package adminapi

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
)

var hexColorCodePattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func tenantThemeFromGetRow(row dbmodels.GetTenantThemeByTenantIDRow) *publirattypesv1.TenantTheme {
	theme := &publirattypesv1.TenantTheme{
		PrimaryColor:               row.PrimaryColor,
		SecondaryColor:             row.SecondaryColor,
		AccentColor:                row.AccentColor,
		BackgroundColor:            row.BackgroundColor,
		ForegroundColor:            row.ForegroundColor,
		SurfaceColor:               row.SurfaceColor,
		SurfaceForegroundColor:     row.SurfaceForegroundColor,
		CardColor:                  row.CardColor,
		CardForegroundColor:        row.CardForegroundColor,
		PopoverColor:               row.PopoverColor,
		PopoverForegroundColor:     row.PopoverForegroundColor,
		PrimaryForegroundColor:     row.PrimaryForegroundColor,
		SecondaryForegroundColor:   row.SecondaryForegroundColor,
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
	if row.LogoUrl.Valid {
		theme.LogoUrl = row.LogoUrl.String
	}
	return theme
}

func tenantThemeFromModel(model dbmodels.TenantTheme) *publirattypesv1.TenantTheme {
	theme := &publirattypesv1.TenantTheme{
		PrimaryColor:               model.PrimaryColor,
		SecondaryColor:             model.SecondaryColor,
		AccentColor:                model.AccentColor,
		BackgroundColor:            model.BackgroundColor,
		ForegroundColor:            model.ForegroundColor,
		SurfaceColor:               model.SurfaceColor,
		SurfaceForegroundColor:     model.SurfaceForegroundColor,
		CardColor:                  model.CardColor,
		CardForegroundColor:        model.CardForegroundColor,
		PopoverColor:               model.PopoverColor,
		PopoverForegroundColor:     model.PopoverForegroundColor,
		PrimaryForegroundColor:     model.PrimaryForegroundColor,
		SecondaryForegroundColor:   model.SecondaryForegroundColor,
		AccentForegroundColor:      model.AccentForegroundColor,
		MutedColor:                 model.MutedColor,
		MutedForegroundColor:       model.MutedForegroundColor,
		BorderColor:                model.BorderColor,
		InputColor:                 model.InputColor,
		RingColor:                  model.RingColor,
		SuccessColor:               model.SuccessColor,
		SuccessForegroundColor:     model.SuccessForegroundColor,
		WarningColor:               model.WarningColor,
		WarningForegroundColor:     model.WarningForegroundColor,
		DestructiveColor:           model.DestructiveColor,
		DestructiveForegroundColor: model.DestructiveForegroundColor,
		InfoColor:                  model.InfoColor,
		InfoForegroundColor:        model.InfoForegroundColor,
	}
	if model.LogoUrl.Valid {
		theme.LogoUrl = model.LogoUrl.String
	}
	return theme
}

func validateHexColorCode(value string, fieldName string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if !hexColorCodePattern.MatchString(trimmed) {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New(fieldName+" must be a hex color code in #RRGGBB format"))
	}
	return strings.ToLower(trimmed), nil
}

func normalizeTenantTheme(theme *publirattypesv1.TenantTheme) (dbmodels.UpsertTenantThemeParams, error) {
	type colorField struct {
		value string
		name  string
	}
	fields := []colorField{
		{theme.PrimaryColor, "theme.primary_color"},
		{theme.SecondaryColor, "theme.secondary_color"},
		{theme.AccentColor, "theme.accent_color"},
		{theme.BackgroundColor, "theme.background_color"},
		{theme.ForegroundColor, "theme.foreground_color"},
		{theme.SurfaceColor, "theme.surface_color"},
		{theme.SurfaceForegroundColor, "theme.surface_foreground_color"},
		{theme.CardColor, "theme.card_color"},
		{theme.CardForegroundColor, "theme.card_foreground_color"},
		{theme.PopoverColor, "theme.popover_color"},
		{theme.PopoverForegroundColor, "theme.popover_foreground_color"},
		{theme.PrimaryForegroundColor, "theme.primary_foreground_color"},
		{theme.SecondaryForegroundColor, "theme.secondary_foreground_color"},
		{theme.AccentForegroundColor, "theme.accent_foreground_color"},
		{theme.MutedColor, "theme.muted_color"},
		{theme.MutedForegroundColor, "theme.muted_foreground_color"},
		{theme.BorderColor, "theme.border_color"},
		{theme.InputColor, "theme.input_color"},
		{theme.RingColor, "theme.ring_color"},
		{theme.SuccessColor, "theme.success_color"},
		{theme.SuccessForegroundColor, "theme.success_foreground_color"},
		{theme.WarningColor, "theme.warning_color"},
		{theme.WarningForegroundColor, "theme.warning_foreground_color"},
		{theme.DestructiveColor, "theme.destructive_color"},
		{theme.DestructiveForegroundColor, "theme.destructive_foreground_color"},
		{theme.InfoColor, "theme.info_color"},
		{theme.InfoForegroundColor, "theme.info_foreground_color"},
	}
	normalized := make([]string, len(fields))
	for i, f := range fields {
		v, err := validateHexColorCode(f.value, f.name)
		if err != nil {
			return dbmodels.UpsertTenantThemeParams{}, err
		}
		normalized[i] = v
	}
	return dbmodels.UpsertTenantThemeParams{
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
		LogoUrl:                    nullableString(theme.LogoUrl),
	}, nil
}

func (s *adminServer) GetTenantTheme(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantThemeRequest],
) (*connect.Response[publiraadminv1.GetTenantThemeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	theme, err := s.queriesFor(ctx).GetTenantThemeByTenantID(ctx, tenant.ID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publiraadminv1.GetTenantThemeResponse{
		Theme: tenantThemeFromGetRow(theme),
	}), nil
}

func (s *adminServer) UpsertTenantTheme(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpsertTenantThemeRequest],
) (*connect.Response[publiraadminv1.UpsertTenantThemeResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}
	if req.Msg.Theme == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("theme is required"))
	}

	params, err := normalizeTenantTheme(req.Msg.Theme)
	if err != nil {
		return nil, err
	}
	params.TenantID = tenant.ID

	updated, err := s.queriesFor(ctx).UpsertTenantTheme(ctx, params)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&publiraadminv1.UpsertTenantThemeResponse{
		Theme: tenantThemeFromModel(updated),
	}), nil
}
