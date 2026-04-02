import { cacheLife } from "next/cache";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantPublicSiteTag } from "./cache-tags";

export interface TenantSiteInfo {
  copyrightText?: string;
  domain: string;
  name: string;
  publicId: string;
  siteDescription?: string;
  siteLabel: string;
  siteTagline?: string;
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
  tenantPublicId: string
): Promise<TenantSiteInfo | null> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalizedTenantPublicId = tenantPublicId.trim();
  if (!normalizedTenantPublicId) {
    return null;
  }

  applyCacheTag(tenantPublicSiteTag(normalizedTenantPublicId));

  try {
    const response = await apiClient.tenant.getTenant({
      tenant: { tenantPublicId: normalizedTenantPublicId },
    });

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
    };
  } catch (error) {
    if (isExpectedNullableError(error)) {
      return null;
    }
    throw error;
  }
};

export const getTenantSiteLabel = async (
  tenantPublicId: string
): Promise<string> => {
  const tenant = await getTenantSiteInfo(tenantPublicId);
  return tenant?.siteLabel ?? "サイト";
};
