package adminapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/auditlog"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/paymentsettings"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/secretupdate"
	"github.com/publira/publira/server/internal/storeproduct"
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
		errors.Is(err, secretupdate.ErrInvalidMode):
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
		SecretKeyUpdateMode:     secretupdate.Mode(req.Msg.SecretKeyUpdateMode),
		WebhookSecret:           req.Msg.WebhookSecret,
		WebhookSecretUpdateMode: secretupdate.Mode(req.Msg.WebhookSecretUpdateMode),
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
	s.revalidateTags(ctx, tenant.ID, tenantPaymentRevalidateTags(tenant.ID.String()))

	return connect.NewResponse(&publiraadminv1.UpdateTenantPaymentSettingsResponse{
		Settings: tenantPaymentSettingsToProto(cfg),
	}), nil
}

func tenantStorePaymentSettingsToProto(cfg paymentsettings.StoreConfig) (*publiraadminv1.TenantStorePaymentSettings, error) {
	route, err := protomapper.AppPurchaseRouteFromStored(cfg.Route)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.TenantStorePaymentSettings{
		AppPurchaseRoute: route,
		AppStore: &publiraadminv1.TenantAppStorePaymentSettings{
			Enabled:              cfg.AppStore.Enabled,
			IssuerId:             cfg.AppStore.IssuerID,
			KeyId:                cfg.AppStore.KeyID,
			PrivateKeyConfigured: cfg.AppStore.PrivateKeyConfigured,
			PrivateKeyHint:       cfg.AppStore.PrivateKeyHint,
			BundleIdentifier:     cfg.AppStore.BundleIdentifier,
			Ready:                cfg.AppStore.Ready,
		},
		GooglePlay: &publiraadminv1.TenantGooglePlayPaymentSettings{
			Enabled:                     cfg.GooglePlay.Enabled,
			ServiceAccountEmail:         cfg.GooglePlay.ServiceAccountEmail,
			ServiceAccountKeyConfigured: cfg.GooglePlay.ServiceAccountKeyConfigured,
			ServiceAccountKeyHint:       cfg.GooglePlay.ServiceAccountKeyHint,
			PackageName:                 cfg.GooglePlay.PackageName,
			Ready:                       cfg.GooglePlay.Ready,
		},
	}, nil
}

func mapStorePaymentSettingsUpdateError(err error) error {
	switch {
	case errors.Is(err, paymentsettings.ErrInvalidAppPurchaseRoute):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "app_purchase_route")
	case errors.Is(err, paymentsettings.ErrStoreRouteRequiresReadyStore):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, paymentsettings.ErrInvalidIssuerID):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "app_store.issuer_id")
	case errors.Is(err, paymentsettings.ErrInvalidKeyID):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "app_store.key_id")
	case errors.Is(err, paymentsettings.ErrInvalidAppStorePrivateKey):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "app_store.private_key")
	case errors.Is(err, paymentsettings.ErrInvalidServiceAccountKey):
		return rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "google_play.service_account_key")
	case errors.Is(err, paymentsettings.ErrAppStoreCredentialsRequired),
		errors.Is(err, paymentsettings.ErrGooglePlayCredentialsRequired):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		return mapPaymentSettingsUpdateError(err)
	}
}

func (s *adminServer) GetTenantStorePaymentSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantStorePaymentSettingsRequest],
) (*connect.Response[publiraadminv1.GetTenantStorePaymentSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	cfg, err := paymentsettings.NewAppStores(s.queriesFor(ctx), s.encryptor).Get(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, paymentsettings.ErrUnresolvedAppPurchaseRoute) {
			return nil, s.internalError(ctx, "tenant app purchase route is not a supported value", err, "tenant_id", tenant.ID.String())
		}
		return nil, s.internalDBError(ctx, "failed to get tenant store payment settings", err, "tenant_id", tenant.ID.String())
	}
	settings, err := tenantStorePaymentSettingsToProto(cfg)
	if err != nil {
		return nil, s.internalError(ctx, "tenant app purchase route is not a supported value", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetTenantStorePaymentSettingsResponse{Settings: settings}), nil
}

// UpdateTenantStorePaymentSettings writes both stores and the route in one
// transaction, because whether the route may be the store depends on what the
// same request does to the stores.
func (s *adminServer) UpdateTenantStorePaymentSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantStorePaymentSettingsRequest],
) (*connect.Response[publiraadminv1.UpdateTenantStorePaymentSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	sessionCtx, err := s.requireTenantAdmin(ctx)
	if err != nil {
		return nil, err
	}

	route, err := protomapper.AppPurchaseRouteToStored(req.Msg.GetAppPurchaseRoute())
	if err != nil {
		return nil, mapStorePaymentSettingsUpdateError(err)
	}
	appStore := req.Msg.GetAppStore()
	googlePlay := req.Msg.GetGooglePlay()
	input := paymentsettings.StoreUpdateInput{
		Route: route,
		AppStore: paymentsettings.AppStoreUpdate{
			Enabled:              appStore.GetEnabled(),
			IssuerID:             appStore.GetIssuerId(),
			KeyID:                appStore.GetKeyId(),
			PrivateKey:           appStore.GetPrivateKey(),
			PrivateKeyUpdateMode: secretupdate.Mode(appStore.GetPrivateKeyUpdateMode()),
		},
		GooglePlay: paymentsettings.GooglePlayUpdate{
			Enabled:                     googlePlay.GetEnabled(),
			ServiceAccountKey:           googlePlay.GetServiceAccountKey(),
			ServiceAccountKeyUpdateMode: secretupdate.Mode(googlePlay.GetServiceAccountKeyUpdateMode()),
		},
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin store payment settings transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck

	cfg, err := paymentsettings.NewAppStores(dbmodels.New(tx), s.encryptor).Update(ctx, tenant.ID, input)
	if err != nil {
		if mapped := mapStorePaymentSettingsUpdateError(err); mapped != nil {
			return nil, mapped
		}
		return nil, s.internalDBError(ctx, "failed to update tenant store payment settings", err, "tenant_id", tenant.ID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit tenant store payment settings", err, "tenant_id", tenant.ID.String())
	}

	paymentsettings.RecordUpdate(ctx, s.recorderFor(ctx), tenant.ID, paymentsettings.AuditMeta{
		ActorUserID: sessionCtx.User.ID,
		ActorRole:   sessionCtx.Role,
		ClientIP:    auditlog.ClientIPFromHeader(req.Header()),
		TargetID:    tenant.PublicID,
	}, auditlog.OutcomeSuccess, "")
	s.revalidateTags(ctx, tenant.ID, tenantPaymentRevalidateTags(tenant.ID.String()))

	settings, err := tenantStorePaymentSettingsToProto(cfg)
	if err != nil {
		return nil, s.internalError(ctx, "tenant app purchase route is not a supported value", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.UpdateTenantStorePaymentSettingsResponse{Settings: settings}), nil
}

func (s *adminServer) ListTenantStoreProducts(
	ctx context.Context,
	req *connect.Request[publiraadminv1.ListTenantStoreProductsRequest],
) (*connect.Response[publiraadminv1.ListTenantStoreProductsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	rows, err := s.queriesFor(ctx).ListTenantStoreProductPrices(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list tenant store product prices", err, "tenant_id", tenant.ID.String())
	}
	products := make([]*publiraadminv1.TenantStoreProduct, 0, len(rows))
	for _, row := range rows {
		products = append(products, &publiraadminv1.TenantStoreProduct{
			ProductId:    storeproduct.ProductID(row.Price),
			Price:        row.Price,
			EpisodeCount: row.EpisodeCount,
		})
	}
	return connect.NewResponse(&publiraadminv1.ListTenantStoreProductsResponse{Products: products}), nil
}
