package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	dbmodels "github.com/publira/publira/server/internal/db"
	"github.com/publira/publira/server/internal/tenanttz"
)

// tenantTimezoneRevalidateTags lists the public site caches that render tenant
// wall-clock date/time, so a time zone change is reflected right away.
func tenantTimezoneRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:site", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:list", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
		fmt.Sprintf("tenant:%s:pages", normalizedTenantID),
	}
}

func (s *adminServer) GetTenantTimezone(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantTimezoneRequest],
) (*connect.Response[publiraadminv1.GetTenantTimezoneResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&publiraadminv1.GetTenantTimezoneResponse{
		Timezone: tenanttz.Resolve(tenant.Timezone),
	}), nil
}

func (s *adminServer) UpdateTenantTimezone(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantTimezoneRequest],
) (*connect.Response[publiraadminv1.UpdateTenantTimezoneResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	timezone, err := tenanttz.Normalize(req.Msg.Timezone)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	updated, err := s.queriesFor(ctx).UpdateTenantTimezone(ctx, dbmodels.UpdateTenantTimezoneParams{
		ID:       tenant.ID,
		Timezone: timezone,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("tenant not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, tenant.ID.String(), tenant.Domain, tenantTimezoneRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after tenant timezone update", "tenant_public_id", tenant.PublicID, "error", err)
		}
	}

	return connect.NewResponse(&publiraadminv1.UpdateTenantTimezoneResponse{
		Timezone: tenanttz.Resolve(updated.Timezone),
	}), nil
}
