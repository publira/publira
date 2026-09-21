package adminapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode"

	"connectrpc.com/connect"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	publiraadminv1 "github.com/publira/publira/server/internal/proto/gen/publira/admin/v1"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
)

// tenantPurchaseSettingsRevalidateTags names the public caches that carry the
// settings: the tenant read with the store listings, and the series detail
// every cached episode read is tagged with, whose episodes carry where they
// may be bought.
func tenantPurchaseSettingsRevalidateTags(tenantID string) []string {
	normalizedTenantID := strings.TrimSpace(tenantID)
	return []string{
		fmt.Sprintf("tenant:%s:site", normalizedTenantID),
		fmt.Sprintf("tenant:%s:series:detail", normalizedTenantID),
	}
}

// normalizeStoreURL trims a store listing URL and answers NULL for an empty
// one. The listing is a link the storefront hands a reader, so it has to be an
// absolute https:// URL; a query is allowed because a Google Play listing names
// its app in one.
func normalizeStoreURL(value string) (sql.NullString, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullString{}, nil
	}
	if strings.IndexFunc(trimmed, unicode.IsSpace) >= 0 {
		return sql.NullString{}, errors.New("store URL must not contain whitespace")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return sql.NullString{}, errors.New("store URL must be an https:// URL")
	}
	return sql.NullString{String: trimmed, Valid: true}, nil
}

func tenantPurchaseSettingsFromConfig(config dbmodels.TenantConfig) (*publiraadminv1.TenantPurchaseSettings, error) {
	availability, err := protomapper.SurfaceAvailabilityFromStored(config.PurchaseAvailability)
	if err != nil {
		return nil, err
	}
	return &publiraadminv1.TenantPurchaseSettings{
		PurchaseAvailability: availability,
		AppStoreUrl:          config.AppStoreUrl.String,
		GooglePlayUrl:        config.GooglePlayUrl.String,
	}, nil
}

func (s *adminServer) GetTenantPurchaseSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.GetTenantPurchaseSettingsRequest],
) (*connect.Response[publiraadminv1.GetTenantPurchaseSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// A tenant with no config row sells on both surfaces and lists no
			// app, which is what the columns' own defaults say too.
			return connect.NewResponse(&publiraadminv1.GetTenantPurchaseSettingsResponse{
				Settings: &publiraadminv1.TenantPurchaseSettings{
					PurchaseAvailability: publirattypesv1.SurfaceAvailability_SURFACE_AVAILABILITY_ALL,
				},
			}), nil
		}
		return nil, s.internalDBError(ctx, "failed to get tenant purchase settings", err, "tenant_id", tenant.ID.String())
	}

	settings, err := tenantPurchaseSettingsFromConfig(config)
	if err != nil {
		return nil, s.internalError(ctx, "tenant purchase availability is not a supported value", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.GetTenantPurchaseSettingsResponse{Settings: settings}), nil
}

func (s *adminServer) UpdateTenantPurchaseSettings(
	ctx context.Context,
	req *connect.Request[publiraadminv1.UpdateTenantPurchaseSettingsRequest],
) (*connect.Response[publiraadminv1.UpdateTenantPurchaseSettingsResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}
	if _, err := s.requireTenantAdmin(ctx); err != nil {
		return nil, err
	}

	requested := req.Msg.GetSettings()
	availability, err := protomapper.SeriesSurfaceAvailabilityToStored(requested.GetPurchaseAvailability())
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.purchase_availability")
	}
	appStoreURL, err := normalizeStoreURL(requested.GetAppStoreUrl())
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.app_store_url")
	}
	googlePlayURL, err := normalizeStoreURL(requested.GetGooglePlayUrl())
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "settings.google_play_url")
	}

	updated, err := s.queriesFor(ctx).UpsertTenantPurchaseSettings(ctx, dbmodels.UpsertTenantPurchaseSettingsParams{
		TenantID:             tenant.ID,
		PurchaseAvailability: availability,
		AppStoreUrl:          appStoreURL,
		GooglePlayUrl:        googlePlayURL,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to update tenant purchase settings", err, "tenant_id", tenant.ID.String())
	}

	s.revalidateTags(ctx, tenant.ID, tenantPurchaseSettingsRevalidateTags(tenant.ID.String()))

	settings, err := tenantPurchaseSettingsFromConfig(updated)
	if err != nil {
		return nil, s.internalError(ctx, "tenant purchase availability is not a supported value", err, "tenant_id", tenant.ID.String())
	}
	return connect.NewResponse(&publiraadminv1.UpdateTenantPurchaseSettingsResponse{Settings: settings}), nil
}
