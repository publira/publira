package adminapi

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/fcmsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

func (s *adminServer) fcmStore(ctx context.Context) *fcmsettings.Store {
	return fcmsettings.New(s.queriesFor(ctx), s.encryptor, s.recorderFor(ctx))
}

func tenantFcmSettingsToProto(settings fcmsettings.Settings) *publiraadminv1.TenantFcmSettings {
	if !settings.Configured {
		return &publiraadminv1.TenantFcmSettings{}
	}
	return &publiraadminv1.TenantFcmSettings{
		Configured:  true,
		ProjectId:   settings.ProjectID,
		ClientEmail: settings.ClientEmail,
		UpdatedAt:   settings.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// mapFcmSettingsSaveError answers a refusal the caller can act on. The
// messages are the package's own, which name a field and never a value.
func mapFcmSettingsSaveError(err error) error {
	switch {
	case errors.Is(err, fcmsettings.ErrProjectIDRequired),
		errors.Is(err, fcmsettings.ErrProjectMismatch),
		errors.Is(err, fcmsettings.ErrInvalidCredentials):
		return connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	case errors.Is(err, fcmsettings.ErrSecretManagerUnavailable):
		return connect.NewError(connect.CodeFailedPrecondition, "secret encryption is not configured")
	default:
		return nil
	}
}

func fcmAuditMeta(ctx context.Context, sessionCtx rpcmiddleware.SessionContext, tenantPublicID string) fcmsettings.AuditMeta {
	return fcmsettings.AuditMeta{
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		ClientIP:    auditlog.ClientIPFromHeader(rpcmiddleware.RequestHeader(ctx)),
		TargetID:    tenantPublicID,
	}
}

func (s *adminServer) GetTenantFcmSettings(
	ctx context.Context,
	req *publiraadminv1.GetTenantFcmSettingsRequest,
) (*publiraadminv1.GetTenantFcmSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	settings, err := s.fcmStore(ctx).Get(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant fcm settings", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.GetTenantFcmSettingsResponse{
		Settings: tenantFcmSettingsToProto(settings),
	}, nil
}

func (s *adminServer) SaveTenantFcmCredentials(
	ctx context.Context,
	req *publiraadminv1.SaveTenantFcmCredentialsRequest,
) (*publiraadminv1.SaveTenantFcmCredentialsResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	audit := fcmAuditMeta(ctx, sessionCtx, tenant.PublicID)

	settings, err := s.fcmStore(ctx).Save(ctx, tenant.ID, req.ProjectId, req.ServiceAccountJson, audit)
	if err != nil {
		if mapped := mapFcmSettingsSaveError(err); mapped != nil {
			return nil, mapped
		}
		return nil, s.internalDBError(ctx, "failed to save tenant fcm credentials", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.SaveTenantFcmCredentialsResponse{
		Settings: tenantFcmSettingsToProto(settings),
	}, nil
}

func (s *adminServer) DeleteTenantFcmCredentials(
	ctx context.Context,
	req *publiraadminv1.DeleteTenantFcmCredentialsRequest,
) (*publiraadminv1.DeleteTenantFcmCredentialsResponse, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	audit := fcmAuditMeta(ctx, sessionCtx, tenant.PublicID)

	if err := s.fcmStore(ctx).Delete(ctx, tenant.ID, audit); err != nil {
		return nil, s.internalDBError(ctx, "failed to delete tenant fcm credentials", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.DeleteTenantFcmCredentialsResponse{
		Settings: tenantFcmSettingsToProto(fcmsettings.Settings{}),
	}, nil
}
