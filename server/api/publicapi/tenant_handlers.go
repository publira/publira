package publicapi

import (
	"context"
	"database/sql"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/api/protomapper"
	publirattypesv1 "github.com/publira/publira/server/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
	"github.com/publira/publira/server/internal/platformconfig"
	"github.com/publira/publira/server/internal/tenanttz"
)

func (s *apiServer) GetTenant(
	ctx context.Context,
	req *connect.Request[publirav1.GetTenantRequest],
) (*connect.Response[publirav1.GetTenantResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)

	// Fetch tenant config (optional)
	config, err := queries.GetTenantConfigByTenantID(ctx, tenant.ID)
	copyrightText := ""
	siteDescription := ""
	siteTagline := ""

	if err == nil {
		if config.CopyrightText.Valid {
			copyrightText = config.CopyrightText.String
		}
		if config.SiteDescription.Valid {
			siteDescription = config.SiteDescription.String
		}
		if config.SiteTagline.Valid {
			siteTagline = config.SiteTagline.String
		}
	} else if err != sql.ErrNoRows {
		// Log error but don't fail the request
		_ = err
	}

	var theme *publirattypesv1.TenantTheme
	themeRow, themeErr := queries.GetTenantThemeByTenantID(ctx, tenant.ID)
	if themeErr == nil {
		theme = protomapper.TenantThemeFromGetRow(themeRow)
	} else if themeErr != sql.ErrNoRows {
		// Theme is branding only; keep GetTenant available even if theme load fails.
		_ = themeErr
	}

	return connect.NewResponse(&publirav1.GetTenantResponse{
		TenantPublicId:  tenant.PublicID,
		TenantName:      tenant.Name,
		TenantDomain:    tenant.Domain,
		CopyrightText:   copyrightText,
		SiteDescription: siteDescription,
		SiteTagline:     siteTagline,
		Theme:           theme,
		Timezone:        tenanttz.Resolve(tenant.Timezone, platformconfig.DefaultTimeZoneFunc(ctx, queries)),
	}), nil
}
