package adminapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect/v2"

	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/signupsettings"
)

// tenantSignUpSettingsRevalidateTags names the public tenant read, which
// answers whether the storefront renders its sign-up form or the message.
func tenantSignUpSettingsRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:site", strings.TrimSpace(tenantID))}
}

func tenantSignUpSettingsToProto(settings signupsettings.Settings) *publiraadminv1.TenantSignUpSettings {
	return &publiraadminv1.TenantSignUpSettings{
		SignUpOpen:    settings.Open,
		ClosedMessage: settings.ClosedMessage,
	}
}

func (s *adminServer) GetTenantSignUpSettings(
	ctx context.Context,
	req *publiraadminv1.GetTenantSignUpSettingsRequest,
) (*publiraadminv1.GetTenantSignUpSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAuditor(ctx); err != nil {
		return nil, err
	}
	settings, err := signupsettings.Get(ctx, s.queriesFor(ctx), tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant sign-up settings", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.GetTenantSignUpSettingsResponse{
		Settings: tenantSignUpSettingsToProto(settings),
	}, nil
}

func (s *adminServer) UpdateTenantSignUpSettings(
	ctx context.Context,
	req *publiraadminv1.UpdateTenantSignUpSettingsRequest,
) (*publiraadminv1.UpdateTenantSignUpSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	session, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if req.Settings == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "settings is required")
	}
	requested, err := signupsettings.Normalize(signupsettings.Settings{
		Open:          req.Settings.GetSignUpOpen(),
		ClosedMessage: req.Settings.GetClosedMessage(),
	})
	if errors.Is(err, signupsettings.ErrClosedMessageTooLong) {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.closed_message")
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}

	var stored signupsettings.Settings
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		q := s.queriesFor(txCtx)
		current, err := signupsettings.Get(txCtx, q, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to get tenant sign-up settings", err, "tenant_id", tenant.ID.String())
		}
		if current == requested {
			stored = current
			return nil, nil
		}
		stored, err = signupsettings.Update(txCtx, q, tenant.ID, requested)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to update tenant sign-up settings", err, "tenant_id", tenant.ID.String())
		}
		if err := s.writeTenantSettingAudit(txCtx, tenant, session, signupsettings.ActionSettingsUpdated, signupsettings.AuditTargetType); err != nil {
			return nil, err
		}
		return tenantSignUpSettingsRevalidateTags(tenant.ID.String()), nil
	}); err != nil {
		return nil, err
	}

	return &publiraadminv1.UpdateTenantSignUpSettingsResponse{
		Settings: tenantSignUpSettingsToProto(stored),
	}, nil
}
