package adminapi

import (
	"context"
	"errors"

	"connectrpc.com/connect/v2"

	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/clientip"
	"github.com/publira/publira/server/internal/inboundemail"
	"github.com/publira/publira/server/internal/inboundprovider"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/secretupdate"
)

func tenantInboundEmailSettingsToProto(cfg inboundemail.PublicConfig) *publiraadminv1.TenantInboundEmailSettings {
	fields := make([]*publiraadminv1.InboundEmailCredentialFieldState, 0, len(cfg.Fields))
	for _, field := range cfg.Fields {
		fields = append(fields, &publiraadminv1.InboundEmailCredentialFieldState{
			Name:       field.Name,
			Configured: field.Configured,
			Hint:       field.Hint,
		})
	}
	return &publiraadminv1.TenantInboundEmailSettings{
		Provider: cfg.Provider,
		Enabled:  cfg.Enabled,
		Domain:   cfg.Domain,
		Ready:    cfg.Ready,
		Fields:   fields,
	}
}

func inboundEmailProviderToProto(provider inboundprovider.Provider) *publiraadminv1.InboundEmailProvider {
	declaration := provider.Declaration()
	fields := make([]*publiraadminv1.InboundEmailCredentialField, 0, len(declaration.Fields))
	for _, field := range declaration.Fields {
		fields = append(fields, &publiraadminv1.InboundEmailCredentialField{
			Name:     field.Name,
			Secret:   field.Secret,
			Required: field.Required,
		})
	}
	return &publiraadminv1.InboundEmailProvider{
		Id:          declaration.ID,
		DisplayName: declaration.DisplayName,
		Fields:      fields,
		WebhookPath: inboundprovider.WebhookPath(declaration.ID),
	}
}

func mapInboundEmailSettingsUpdateError(err error) error {
	switch {
	case errors.Is(err, inboundemail.ErrInvalidDomain),
		errors.Is(err, inboundemail.ErrDomainRequired):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "domain")
	case errors.Is(err, inboundemail.ErrInvalidProvider):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "provider")
	case errors.Is(err, inboundemail.ErrUnknownField),
		errors.Is(err, inboundemail.ErrDuplicateField),
		errors.Is(err, inboundemail.ErrSecretRequired),
		errors.Is(err, inboundemail.ErrFieldsRequired),
		errors.Is(err, secretupdate.ErrInvalidMode):
		return connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	case errors.Is(err, inboundemail.ErrSecretManagerUnavailable):
		return connect.NewError(connect.CodeFailedPrecondition, "inbound email secret encryption is not configured")
	default:
		return nil
	}
}

func (s *adminServer) ListInboundEmailProviders(
	ctx context.Context,
	req *publiraadminv1.ListInboundEmailProvidersRequest,
) (*publiraadminv1.ListInboundEmailProvidersResponse, error) {
	if _, err := s.tenantByContext(ctx, req.Tenant); err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	registered := s.inboundProviders.Providers()
	providers := make([]*publiraadminv1.InboundEmailProvider, 0, len(registered))
	for _, provider := range registered {
		providers = append(providers, inboundEmailProviderToProto(provider))
	}
	return &publiraadminv1.ListInboundEmailProvidersResponse{
		Providers: providers,
	}, nil
}

func (s *adminServer) GetTenantInboundEmailSettings(
	ctx context.Context,
	req *publiraadminv1.GetTenantInboundEmailSettingsRequest,
) (*publiraadminv1.GetTenantInboundEmailSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	cfg, err := inboundemail.New(s.queriesFor(ctx), s.encryptor, s.inboundProviders, nil, s.logger).GetPublic(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant inbound email settings", err, "tenant_id", tenant.ID.String())
	}
	return &publiraadminv1.GetTenantInboundEmailSettingsResponse{
		Settings: tenantInboundEmailSettingsToProto(cfg),
	}, nil
}

func (s *adminServer) UpdateTenantInboundEmailSettings(
	ctx context.Context,
	req *publiraadminv1.UpdateTenantInboundEmailSettingsRequest,
) (*publiraadminv1.UpdateTenantInboundEmailSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	fields := make([]inboundemail.FieldUpdate, 0, len(req.Fields))
	for _, field := range req.Fields {
		fields = append(fields, inboundemail.FieldUpdate{
			Name:  field.Name,
			Mode:  secretupdate.Mode(field.Mode),
			Value: field.Value,
		})
	}
	var cfg inboundemail.PublicConfig
	if err := s.writeAndRevalidate(ctx, tenant.ID, func(txCtx context.Context) ([]string, error) {
		// The audit row is written on the transaction so it commits with the
		// save; the process's recorder writes on a connection of its own.
		txQueries := s.queriesFor(txCtx)
		store := inboundemail.New(txQueries, s.encryptor, s.inboundProviders, auditlog.New(txQueries, s.logger), s.logger)
		saved, err := store.Upsert(txCtx, tenant.ID, inboundemail.UpdateInput{
			Provider: req.Provider,
			Enabled:  req.Enabled,
			Domain:   req.Domain,
			Fields:   fields,
		}, inboundemail.AuditMeta{
			ActorUserID: sessionCtx.User.ID,
			ActorRole:   sessionCtx.Role,
			ClientIP:    clientip.FromContext(txCtx),
			TargetID:    tenant.PublicID,
		})
		if err != nil {
			if mapped := mapInboundEmailSettingsUpdateError(err); mapped != nil {
				return nil, mapped
			}
			return nil, s.internalDBError(ctx, "failed to upsert tenant inbound email settings", err, "tenant_id", tenant.ID.String())
		}
		cfg = saved
		// Nothing a storefront caches reads these settings.
		return nil, nil
	}); err != nil {
		return nil, err
	}

	return &publiraadminv1.UpdateTenantInboundEmailSettingsResponse{
		Settings: tenantInboundEmailSettingsToProto(cfg),
	}, nil
}
