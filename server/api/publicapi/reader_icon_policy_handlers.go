package publicapi

import (
	"context"

	"github.com/publira/publira/server/api/protomapper"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/usericon"
)

// GetTenantReaderIconPolicy answers what a reader of the tenant may show as an
// icon, with the presets to pick from when that is a preset.
func (s *apiServer) GetTenantReaderIconPolicy(
	ctx context.Context,
	req *publirav1.GetTenantReaderIconPolicyRequest,
) (*publirav1.GetTenantReaderIconPolicyResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	queries := s.queriesFor(ctx)
	stored, err := s.readerIconPolicy(ctx, queries, tenant.ID)
	if err != nil {
		return nil, err
	}
	policy, err := protomapper.ReaderIconPolicyFromStored(stored)
	if err != nil {
		return nil, s.internalError(ctx, "tenant reader icon policy is not a supported policy", err, "tenant_id", tenant.ID.String())
	}

	presets := []*publirattypesv1.ReaderIconPreset{}
	if stored == usericon.PolicyPreset {
		rows, err := queries.ListReaderIconPresetVariants(ctx, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list reader icon presets", err, "tenant_id", tenant.ID.String())
		}
		presets = protomapper.ReaderIconPresets(rows)
	}

	return &publirav1.GetTenantReaderIconPolicyResponse{
		Policy:  policy,
		Presets: presets,
	}, nil
}
