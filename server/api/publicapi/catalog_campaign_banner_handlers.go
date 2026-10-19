package publicapi

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
)

// campaignBannerImagePath is the image route a banner's image is served from,
// the one the admin API files it under.
const campaignBannerImagePath = "campaign-banners"

func (s *apiServer) ListCampaignBanners(
	ctx context.Context,
	req *publirav1.ListCampaignBannersRequest,
) (*publirav1.ListCampaignBannersResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}

	rows, err := s.queriesFor(ctx).ListShowingCampaignBannersForTenant(ctx, tenant.ID)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list showing campaign banners", err, "tenant_id", tenant.ID.String())
	}

	imageIDs := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		imageIDs = append(imageIDs, row.ImageID.UUID)
	}
	variants, err := s.campaignBannerImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, err
	}

	banners := make([]*publirav1.CampaignBanner, 0, len(rows))
	for _, row := range rows {
		banners = append(banners, &publirav1.CampaignBanner{
			PublicId:       row.PublicID,
			LinkUrl:        row.LinkUrl,
			AltText:        row.AltText,
			ImageUpdatedAt: row.ImageUpdatedAt.UTC().Format(time.RFC3339),
			ImageVariants:  variants[row.ImageID.UUID],
		})
	}
	return &publirav1.ListCampaignBannersResponse{Banners: banners}, nil
}

// campaignBannerImageVariantsByImageIDs fetches the variants of the given
// banner images.
func (s *apiServer) campaignBannerImageVariantsByImageIDs(
	ctx context.Context,
	imageIDs []uuid.UUID,
) (map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, error) {
	if len(imageIDs) == 0 {
		return map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant{}, nil
	}

	rows, err := s.queriesFor(ctx).ListCampaignBannerImageVariantsByImageIDs(ctx, imageIDs)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list campaign banner image variants", err, "image_count", len(imageIDs))
	}

	mapped := make(map[uuid.UUID][]*publirattypesv1.SeriesEyeCatchVariant, len(imageIDs))
	for _, row := range rows {
		mapped[row.CampaignBannerImageID] = append(mapped[row.CampaignBannerImageID], &publirattypesv1.SeriesEyeCatchVariant{
			Label:         row.Label,
			VariantType:   row.VariantType,
			Url:           protomapper.EyeCatchVariantURL(campaignBannerImagePath, row.CampaignBannerImageID, row.VariantType, row.Width, row.ID),
			ContentType:   row.ContentType,
			Width:         row.Width,
			Height:        row.Height,
			FileSizeBytes: row.FileSizeBytes,
		})
	}
	return mapped, nil
}
