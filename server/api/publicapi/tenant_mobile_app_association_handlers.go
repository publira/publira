package publicapi

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect"

	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

// GetTenantMobileAppAssociation answers the apps the storefront's association
// documents name. A failed config read is an error rather than "no app": the
// storefront would publish that as a missing association, which the platforms'
// verifiers cache.
func (s *apiServer) GetTenantMobileAppAssociation(
	ctx context.Context,
	req *connect.Request[publirav1.GetTenantMobileAppAssociationRequest],
) (*connect.Response[publirav1.GetTenantMobileAppAssociationResponse], error) {
	tenant, err := s.tenantByContext(ctx, req.Msg.Tenant)
	if err != nil {
		return nil, err
	}

	config, err := s.queriesFor(ctx).GetTenantConfigByTenantID(ctx, tenant.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return connect.NewResponse(&publirav1.GetTenantMobileAppAssociationResponse{}), nil
		}
		return nil, s.internalError(ctx, "failed to get tenant mobile app association", err, "tenant_id", tenant.ID.String())
	}

	resp := &publirav1.GetTenantMobileAppAssociationResponse{}
	if config.AndroidApplicationID.Valid {
		resp.Android = &publirav1.TenantAndroidAppAssociation{
			ApplicationId:          config.AndroidApplicationID.String,
			Sha256CertFingerprints: config.AndroidSha256CertFingerprints,
		}
	}
	if config.IosTeamID.Valid {
		resp.Ios = &publirav1.TenantIosAppAssociation{
			TeamId:           config.IosTeamID.String,
			BundleIdentifier: config.IosBundleIdentifier.String,
		}
	}
	return connect.NewResponse(resp), nil
}
