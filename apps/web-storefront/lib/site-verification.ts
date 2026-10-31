import { isExpectedNullableRpcError } from "@publira/api-client/errors";
import type { TenantSiteVerification } from "@publira/api-client/public/types";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantAnalyticsSettingsTag } from "./cache-tags";

/** The codes the tenant proves the site is its own with, empty for none. */
export interface SiteVerificationCodes {
  /** Google Search Console's google-site-verification code. */
  google: string;
  /** Bing Webmaster Tools' msvalidate.01 code. */
  bing: string;
}

type RawTenantSiteVerification = Pick<
  TenantSiteVerification,
  "bingSiteVerification" | "googleSiteVerification"
>;

const toSiteVerificationCodes = (
  codes: RawTenantSiteVerification | undefined
): SiteVerificationCodes | null => {
  const google = codes?.googleSiteVerification?.trim() ?? "";
  const bing = codes?.bingSiteVerification?.trim() ?? "";

  return google || bing ? { bing, google } : null;
};

/**
 * The tenant's verification codes, or `null` for none.
 *
 * They come back from the same public read as the Google tag, and are kept
 * under the same `tenant:<id>:analytics-settings` tag, which the console's save
 * of either drops.
 *
 * An unavailable read writes no tag, and the entry is dropped so the tags come
 * back with the API: a search engine that checks while the API is down is
 * asked again, which is the cheaper failure than a page that fails over them.
 */
export const getTenantSiteVerification = async (
  tenantId: string
): Promise<SiteVerificationCodes | null> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId) {
    return null;
  }

  applyCacheTag(tenantAnalyticsSettingsTag(normalizedTenantId));

  try {
    const response = await apiClient.tenant.getTenantAnalyticsSettings({
      tenant: { tenantId: normalizedTenantId },
    });

    return toSiteVerificationCodes(response.siteVerification);
  } catch (error) {
    if (!isExpectedNullableRpcError(error)) {
      console.warn("[web-storefront] getTenantSiteVerification failed", error);
      dropFailedCacheEntry();
    }

    return null;
  }
};

/**
 * The `<meta>` tags each set code is written as, and none for a code that is
 * not set. Each code holds only letters, digits, hyphens, and underscores, as
 * the server stores it, so it is written as it is.
 */
export const siteVerificationMetadata = (
  codes: SiteVerificationCodes | null
): Metadata["verification"] => {
  if (!codes) {
    return undefined;
  }

  const verification: NonNullable<Metadata["verification"]> = {};

  if (codes.google) {
    verification.google = codes.google;
  }

  if (codes.bing) {
    verification.other = { "msvalidate.01": codes.bing };
  }

  return verification;
};
