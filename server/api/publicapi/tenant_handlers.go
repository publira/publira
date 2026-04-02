package publicapi

import (
	"context"
	"database/sql"

	"connectrpc.com/connect"
	publirav1 "github.com/publira/publira/server/gen/publira/v1"
)

func (s *apiServer) GetTenant(
	ctx context.Context,
	req *connect.Request[publirav1.GetTenantRequest],
) (*connect.Response[publirav1.GetTenantResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	// Fetch tenant config (optional)
	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
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

	return connect.NewResponse(&publirav1.GetTenantResponse{
		TenantPublicId:  tenant.PublicID,
		TenantName:      tenant.Name,
		TenantDomain:    tenant.Domain,
		CopyrightText:   copyrightText,
		SiteDescription: siteDescription,
		SiteTagline:     siteTagline,
	}), nil
}
