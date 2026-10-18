import { isExpectedNullableRpcError } from "@publira/api-client/errors";
import type { CampaignBanner } from "@publira/api-client/public/catalog";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantCampaignBannersTag } from "./cache-tags";
import { toEyeCatchImageVariants } from "./catalog";
import type { EyeCatchImageVariant } from "./catalog";
import { toSafeOperatorLinkUrl } from "./operator-link";

/** One banner of the band, and where it takes the reader. */
export interface CampaignBannerItem {
  publicId: string;
  /** A path on this site without a locale prefix, or an absolute http(s) URL. */
  linkUrl: string;
  imageVariants: EyeCatchImageVariant[];
}

/** The generated `CampaignBanner` fields {@link toCampaignBannerItem} reads. */
type RawCampaignBanner = Pick<
  CampaignBanner,
  "imageVariants" | "linkUrl" | "publicId"
>;

/**
 * A banner is a picture that is a link, so one that has lost either half is
 * dropped rather than drawn: a link this site may not follow, or an image with
 * no variant left to draw.
 */
const toCampaignBannerItem = (
  banner: RawCampaignBanner
): CampaignBannerItem | null => {
  const linkUrl = toSafeOperatorLinkUrl(banner.linkUrl ?? "");
  const imageVariants = toEyeCatchImageVariants(banner.imageVariants);
  if (!(linkUrl && imageVariants)) {
    return null;
  }

  return { imageVariants, linkUrl, publicId: banner.publicId ?? "" };
};

/**
 * The banners showing on the tenant's site now, in the operator's order, or an
 * empty list when there are none.
 *
 * The read names no reader, so one entry serves every visitor of a tenant. What
 * makes it stale is a change in the console or a window opening or closing, and
 * each of those drops {@link tenantCampaignBannersTag} from the side that knows
 * it happened.
 *
 * A read that fails answers an empty list, the way the pinned announcement
 * does: the band is an addition to the top page rather than part of it, and a
 * site that cannot say which campaigns are on should show the catalog rather
 * than an apology above it. An unexpected failure is reported in the log
 * rather than thrown, because past the cache boundary it could no longer be
 * classified.
 */
export const listCampaignBanners = async (
  tenantId: string
): Promise<CampaignBannerItem[]> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return [];
  }
  applyCacheTag(tenantCampaignBannersTag(normalizedTenantId));

  try {
    const response = await apiClient.catalog.listCampaignBanners({
      tenant: { tenantId: normalizedTenantId },
    });

    return (response.banners ?? []).flatMap((banner) => {
      const mapped = toCampaignBannerItem(banner);
      return mapped ? [mapped] : [];
    });
  } catch (error) {
    if (!isExpectedNullableRpcError(error)) {
      console.warn("[web-storefront] listCampaignBanners failed", error);
    }
    dropFailedCacheEntry();
    return [];
  }
};
