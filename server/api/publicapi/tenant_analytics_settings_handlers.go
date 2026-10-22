package publicapi

import (
	"context"

	"github.com/publira/publira/server/api/protomapper"
	"github.com/publira/publira/server/internal/googletag"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

// GetTenantAnalyticsSettings answers the Google tag the storefront loads, with
// only the values its serving mode uses. A failed read is an error rather than
// "no tag": the storefront would cache it, and the tenant's measurement would
// go dark until the entry expired.
func (s *apiServer) GetTenantAnalyticsSettings(
	ctx context.Context,
	req *publirav1.GetTenantAnalyticsSettingsRequest,
) (*publirav1.GetTenantAnalyticsSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	settings, err := googletag.Get(ctx, s.queriesFor(ctx), tenant.ID)
	if err != nil {
		return nil, s.internalError(ctx, "failed to get tenant analytics settings", err, "tenant_id", tenant.ID.String())
	}
	if !settings.Measures() {
		return &publirav1.GetTenantAnalyticsSettingsResponse{}, nil
	}
	mode, err := protomapper.GoogleTagServingModeFromStored(settings.ServingMode)
	if err != nil {
		return nil, s.internalError(ctx, "tenant analytics serving mode is not a supported mode", err, "tenant_id", tenant.ID.String())
	}

	tag := &publirav1.TenantGoogleTag{
		Ga4MeasurementId: settings.GA4MeasurementID,
		GtmContainerId:   settings.GTMContainerID,
		ServingMode:      mode,
	}
	switch settings.ServingMode {
	case googletag.ServingModeServerContainer:
		tag.ServerContainerUrl = settings.ServerContainerURL
	case googletag.ServingModeGateway:
		tag.ServerContainerUrl = settings.ServerContainerURL
		tag.GatewayPath = settings.GatewayPath
	}
	return &publirav1.GetTenantAnalyticsSettingsResponse{GoogleTag: tag}, nil
}
