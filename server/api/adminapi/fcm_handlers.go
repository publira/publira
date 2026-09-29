package adminapi

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/fcmsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
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
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, fcmsettings.ErrSecretManagerUnavailable):
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("secret encryption is not configured"))
	default:
		return nil
	}
}

func (s *adminServer) fcmAuditMeta(ctx context.Context, req connect.AnyRequest, tenantPublicID string) (fcmsettings.AuditMeta, error) {
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return fcmsettings.AuditMeta{}, err
	}
	return fcmsettings.AuditMeta{
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		TargetID:    tenantPublicID,
	}, nil
}

func (s *adminServer) GetTenantFcmSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantFcmSettingsRequest],
) (*connect.Response[publiraadminv1.GetTenantFcmSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
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
	return connect.NewResponse(&publiraadminv1.GetTenantFcmSettingsResponse{
		Settings: tenantFcmSettingsToProto(settings),
	}), nil
}

func (s *adminServer) SaveTenantFcmCredentials(
	ctx context.Context,
	req *connect.Request[publiraadminv1.SaveTenantFcmCredentialsRequest],
) (*connect.Response[publiraadminv1.SaveTenantFcmCredentialsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	audit, err := s.fcmAuditMeta(ctx, req, tenant.PublicID)
	if err != nil {
		return nil, err
	}

	settings, err := s.fcmStore(ctx).Save(ctx, tenant.ID, req.Msg.ProjectId, req.Msg.ServiceAccountJson, audit)
	if err != nil {
		if mapped := mapFcmSettingsSaveError(err); mapped != nil {
			return nil, mapped
		}
		return nil, s.internalDBError(ctx, "failed to save tenant fcm credentials", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.SaveTenantFcmCredentialsResponse{
		Settings: tenantFcmSettingsToProto(settings),
	}), nil
}

func (s *adminServer) DeleteTenantFcmCredentials(
	ctx context.Context,
	req *connect.Request[publiraadminv1.DeleteTenantFcmCredentialsRequest],
) (*connect.Response[publiraadminv1.DeleteTenantFcmCredentialsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	audit, err := s.fcmAuditMeta(ctx, req, tenant.PublicID)
	if err != nil {
		return nil, err
	}

	if err := s.fcmStore(ctx).Delete(ctx, tenant.ID, audit); err != nil {
		return nil, s.internalDBError(ctx, "failed to delete tenant fcm credentials", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.DeleteTenantFcmCredentialsResponse{
		Settings: tenantFcmSettingsToProto(fcmsettings.Settings{}),
	}), nil
}
