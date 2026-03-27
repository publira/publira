import { cacheLife } from "next/cache";

import { apiClient } from "./api-client";

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

export const getTenantSiteInfo = async (
  tenantPublicId: string
): Promise<TenantSiteInfo | null> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalizedTenantPublicId = tenantPublicId.trim();
  if (!normalizedTenantPublicId) {
    return null;
  }

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
  } catch {
    return null;
  }
};

export const getTenantSiteLabel = async (
  tenantPublicId: string
): Promise<string> => {
  const tenant = await getTenantSiteInfo(tenantPublicId);
  return tenant?.siteLabel ?? "サイト";
};
