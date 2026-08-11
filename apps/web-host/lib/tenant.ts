import { isExpectedNullableRpcError } from "@publira/api-client/errors";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { cacheLife } from "next/cache";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantSiteTag } from "./cache-tags";

export interface TenantSiteInfo {
  copyrightText?: string;
  domain: string;
  name: string;
  publicId: string;
  siteDescription?: string;
  siteLabel: string;
  siteTagline?: string;
  theme: TenantThemeColors;
}

const buildTenantSiteLabel = (tenantName: string): string => {
  const normalizedTenantName = tenantName.trim();
  return normalizedTenantName || "サイト";
};

/**
 * `null` when the tenant does not exist, is not readable, or could not be
 * fetched at all.
 *
 * Site chrome is the only thing this feeds — the header brand, the footer, the
 * `<title>` template — and every one of those is resolved before a static shell
 * exists, in a layout or in `generateMetadata`. A throw there takes the whole
 * route down with a bare 500 that no boundary can reach (#672), so an
 * unavailable API degrades the chrome to its defaults instead. The failed entry
 * is dropped, so the header stops saying 「サイト」 as soon as the API answers
 * again.
 *
 * Callers cannot tell "no tenant" from "could not ask" — deliberately: both
 * render the same defaults, and the distinction has no reader-facing meaning.
 */
export const getTenantSiteInfo = async (
  tenantId: string
): Promise<TenantSiteInfo | null> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return null;
  }

  applyCacheTag(tenantSiteTag(normalizedTenantId));

  try {
    const response = await apiClient.tenant.getTenant({
      tenant: { tenantId: normalizedTenantId },
    });

    // Display / short code for UI — not used for internal routing.
    const publicId = response.tenantPublicId?.trim() ?? "";
    if (!publicId) {
      return null;
    }

    const name = response.tenantName?.trim() ?? "";

    return {
      copyrightText: response.copyrightText?.trim(),
      domain: response.tenantDomain?.trim() ?? "",
      name,
      publicId,
      siteDescription: response.siteDescription?.trim(),
      siteLabel: buildTenantSiteLabel(name),
      siteTagline: response.siteTagline?.trim(),
      theme: resolveTenantThemeColors(response.theme),
    };
  } catch (error) {
    if (!isExpectedNullableRpcError(error)) {
      // Not "no such tenant" but "we could not ask". Same `null` for the reader,
      // and the entry is dropped so the chrome recovers on the next request.
      console.warn("[web-host] getTenantSiteInfo failed", error);
      dropFailedCacheEntry();
    }
    return null;
  }
};

export const getTenantSiteLabel = async (tenantId: string): Promise<string> => {
  const tenant = await getTenantSiteInfo(tenantId);
  return tenant?.siteLabel ?? "サイト";
};
