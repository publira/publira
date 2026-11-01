package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
)

// tenantCreatorPageSettingsRevalidateTags names the public tenant read, which
// answers whether the site offers Author pages. The creator RPCs read the
// switches on each call, so they hold no cache of their own to drop.
func tenantCreatorPageSettingsRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:site", strings.TrimSpace(tenantID))}
}

func (s *adminServer) GetTenantCreatorPageSettings(
	ctx context.Context,
	req *publiraadminv1.GetTenantCreatorPageSettingsRequest,
) (*publiraadminv1.GetTenantCreatorPageSettingsResponse, error) {
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// A tenant with no config row has chosen nothing, which is what
			// the columns' own defaults say too: both switches off.
			return &publiraadminv1.GetTenantCreatorPageSettingsResponse{}, nil
		}
		return nil, s.internalDBError(ctx, "failed to get tenant creator page settings", err, "tenant_id", tenant.ID.String())
	}

	return &publiraadminv1.GetTenantCreatorPageSettingsResponse{
		CreatorPagesEnabled:   config.CreatorPagesEnabled,
		CreatorPagesShowSales: config.CreatorPagesShowSales,
	}, nil
}

func (s *adminServer) UpdateTenantCreatorPageSettings(
	ctx context.Context,
	req *publiraadminv1.UpdateTenantCreatorPageSettingsRequest,
) (*publiraadminv1.UpdateTenantCreatorPageSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	var updated dbmodels.TenantConfig
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		current, err := s.lockTenantConfig(txCtx, tenant.ID)
		if err != nil {
			return nil, err
		}
		if current.CreatorPagesEnabled == req.CreatorPagesEnabled && current.CreatorPagesShowSales == req.CreatorPagesShowSales {
			updated = current
			return nil, nil
		}
		row, err := s.queriesFor(txCtx).UpsertTenantCreatorPageSettings(txCtx, dbmodels.UpsertTenantCreatorPageSettingsParams{
			CreatorPagesEnabled:   req.CreatorPagesEnabled,
			CreatorPagesShowSales: req.CreatorPagesShowSales,
			TenantID:              tenant.ID,
		})
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to update tenant creator page settings", err, "tenant_id", tenant.ID.String())
		}
		updated = row
		if err := s.writeTenantSettingAudit(txCtx, tenant, session, "tenant_creator_page_settings_updated", "tenant_creator_page_settings"); err != nil {
			return nil, err
		}
		return tenantCreatorPageSettingsRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}

	return &publiraadminv1.UpdateTenantCreatorPageSettingsResponse{
		CreatorPagesEnabled:   updated.CreatorPagesEnabled,
		CreatorPagesShowSales: updated.CreatorPagesShowSales,
	}, nil
}
