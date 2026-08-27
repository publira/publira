package adminapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	publiraadminv1 "github.com/publira/publira/server/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/auditlog"
	"github.com/publira/publira/server/internal/paymentsettings"
)

// tenantPaymentRevalidateTags lists the cached public tenant response that
// controls whether the reader-facing Checkout CTA is rendered.
func tenantPaymentRevalidateTags(tenantID string) []string {
	return []string{fmt.Sprintf("tenant:%s:site", strings.TrimSpace(tenantID))}
}

func (s *adminServer) paymentStore(ctx context.Context) *paymentsettings.Store {
	return paymentsettings.New(s.queriesFor(ctx), s.encryptor, s.recorderFor(ctx), s.logger)
}

func tenantPaymentSettingsToProto(cfg paymentsettings.PublicConfig) *publiraadminv1.TenantPaymentSettings {
	return &publiraadminv1.TenantPaymentSettings{
		Provider:                cfg.Provider,
		Enabled:                 cfg.Enabled,
		SecretKeyConfigured:     cfg.SecretKeyConfigured,
		WebhookSecretConfigured: cfg.WebhookSecretConfigured,
		SecretKeyHint:           cfg.SecretKeyHint,
		WebhookSecretHint:       cfg.WebhookSecretHint,
		Ready:                   cfg.Ready,
	}
}

func mapPaymentSettingsUpdateError(err error) error {
	switch {
	case errors.Is(err, paymentsettings.ErrInvalidProvider),
		errors.Is(err, paymentsettings.ErrSecretRequired),
		errors.Is(err, paymentsettings.ErrSecretsRequired),
		errors.Is(err, paymentsettings.ErrInvalidSecretUpdateMode):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, paymentsettings.ErrSecretManagerUnavailable):
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("payment secret encryption is not configured"))
	default:
		return nil
	}
}

func (s *adminServer) GetTenantPaymentSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantPaymentSettingsRequest],
) (*connect.Response[publiraadminv1.GetTenantPaymentSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	cfg, err := s.paymentStore(ctx).GetPublic(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant payment settings", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetTenantPaymentSettingsResponse{
		Settings: tenantPaymentSettingsToProto(cfg),
	}), nil
}

func (s *adminServer) UpdateTenantPaymentSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantPaymentSettingsRequest],
) (*connect.Response[publiraadminv1.UpdateTenantPaymentSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	cfg, err := s.paymentStore(ctx).Upsert(ctx, tenant.ID, paymentsettings.UpdateInput{
		Provider:                req.Msg.Provider,
		Enabled:                 req.Msg.Enabled,
		SecretKey:               req.Msg.SecretKey,
		SecretKeyUpdateMode:     int32(req.Msg.SecretKeyUpdateMode),
		WebhookSecret:           req.Msg.WebhookSecret,
		WebhookSecretUpdateMode: int32(req.Msg.WebhookSecretUpdateMode),
	}, paymentsettings.AuditMeta{
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		TargetID:    tenant.PublicID,
	})
	if err != nil {
		if mapped := mapPaymentSettingsUpdateError(err); mapped != nil {
			return nil, mapped
		}
		return nil, s.internalDBError(ctx, "failed to upsert tenant payment settings", err, "tenant_id", tenant.ID.String())
	}
	if s.reval != nil {
		if err := s.reval.RevalidateTags(ctx, tenantPaymentRevalidateTags(tenant.ID.String())); err != nil {
			s.logger.Warn("failed to request next revalidate after tenant payment settings update", "tenant_public_id", tenant.PublicID, "error", err)
		}
	}

	return connect.NewResponse(&publiraadminv1.UpdateTenantPaymentSettingsResponse{
		Settings: tenantPaymentSettingsToProto(cfg),
	}), nil
}
