package publicapi

import (
	"context"

	"github.com/publira/publira/server/internal/crawlersettings"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

// GetTenantCrawlerSettings answers the crawlers and paths the storefront's
// robots.txt excludes. A failed read is an error rather than "nothing
// excluded": the storefront would publish that as a file that lifts every
// exclusion, which crawlers cache.
func (s *apiServer) GetTenantCrawlerSettings(
	ctx context.Context,
	req *publirav1.GetTenantCrawlerSettingsRequest,
) (*publirav1.GetTenantCrawlerSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	settings, err := crawlersettings.Get(ctx, s.queriesFor(ctx), tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to get tenant crawler settings", err, "tenant_id", tenant.ID.String())
	}
	return &publirav1.GetTenantCrawlerSettingsResponse{
		ExcludedUserAgents: settings.UserAgents,
		ExcludedPaths:      settings.Paths,
	}, nil
}
