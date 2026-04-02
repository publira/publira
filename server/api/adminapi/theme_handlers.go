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
		PrimaryColor:   row.PrimaryColor,
		SecondaryColor: row.SecondaryColor,
		AccentColor:    row.AccentColor,
	}
	if row.LogoUrl.Valid {
		theme.LogoUrl = row.LogoUrl.String
	}
	return theme
}

func tenantThemeFromModel(model dbmodels.TenantTheme) *publirattypesv1.TenantTheme {
	theme := &publirattypesv1.TenantTheme{
		PrimaryColor:   model.PrimaryColor,
		SecondaryColor: model.SecondaryColor,
		AccentColor:    model.AccentColor,
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
	primaryColor, err := validateHexColorCode(theme.PrimaryColor, "theme.primary_color")
	if err != nil {
		return dbmodels.UpsertTenantThemeParams{}, err
	}
	secondaryColor, err := validateHexColorCode(theme.SecondaryColor, "theme.secondary_color")
	if err != nil {
		return dbmodels.UpsertTenantThemeParams{}, err
	}
	accentColor, err := validateHexColorCode(theme.AccentColor, "theme.accent_color")
	if err != nil {
		return dbmodels.UpsertTenantThemeParams{}, err
	}

	return dbmodels.UpsertTenantThemeParams{
		BackgroundColor:            "#f6f2e9",
		ForegroundColor:            "#1e2b38",
		SurfaceColor:               "#fbf8f2",
		SurfaceForegroundColor:     "#1e2b38",
		CardColor:                  "#fffdf8",
		CardForegroundColor:        "#1e2b38",
		PopoverColor:               "#fffdf8",
		PopoverForegroundColor:     "#1e2b38",
		PrimaryColor:               primaryColor,
		PrimaryForegroundColor:     "#f4fbfb",
		SecondaryColor:             secondaryColor,
		SecondaryForegroundColor:   "#fff6f1",
		AccentColor:                accentColor,
		AccentForegroundColor:      "#0f2a1f",
		MutedColor:                 "#e9e1d3",
		MutedForegroundColor:       "#5c6773",
		BorderColor:                "#d7ccba",
		InputColor:                 "#e3d8c7",
		RingColor:                  "#2d8d93",
		SuccessColor:               "#2f8f5b",
		SuccessForegroundColor:     "#f3fcf7",
		WarningColor:               "#c4872a",
		WarningForegroundColor:     "#fff8ea",
		DestructiveColor:           "#b54444",
		DestructiveForegroundColor: "#fff4f4",
		InfoColor:                  "#3c78c2",
		InfoForegroundColor:        "#f3f8ff",
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
