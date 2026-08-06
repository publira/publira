import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { cacheLife } from "next/cache";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantSiteTag } from "./cache-tags";

export type { TenantThemeColors } from "@publira/utils/theme-css-variables";

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

const isExpectedNullableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("not_found") ||
    message.includes("not found") ||
    message.includes("unauthenticated") ||
    message.includes("permission_denied")
  );
};

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
    if (isExpectedNullableError(error)) {
      return null;
    }
    throw error;
  }
};

export const getTenantSiteLabel = async (tenantId: string): Promise<string> => {
  const tenant = await getTenantSiteInfo(tenantId);
  return tenant?.siteLabel ?? "サイト";
};
