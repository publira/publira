package publicapi

import (
	"context"
	"errors"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/tenantorigin"
)

// imageOrigin is what the image URLs answered for tenant are rooted at: the
// origin of its image host when it has one, so the storefront loads its images
// from there, and nothing when it has none, which leaves them paths on the
// tenant's domain.
func (s *apiServer) imageOrigin(ctx context.Context, tenant dbmodels.Tenant) (protomapper.ImageOrigin, error) {
	origin, err := tenantorigin.Images(tenant)
	if errors.Is(err, tenantorigin.ErrImageDomainNotConfigured) {
		return protomapper.HostRelative, nil
	}
	if err != nil {
		return protomapper.ImageOrigin{}, s.internalError(ctx, "failed to resolve the tenant's image origin", err, "tenant_id", tenant.ID.String())
	}
	return protomapper.ImagesOn(origin), nil
}
